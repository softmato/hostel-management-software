/**
 * Expo push delivery.
 *
 * Until this file existed, `POST /api/v1/mobile/device-token` wrote a
 * `DeviceToken` row and nothing ever read it — every "push notification"
 * deliverable in PHASES.md §6 was half a feature. This is the other half.
 *
 * Delivery is best-effort by design. The `Notification` row is already
 * committed before we get here, so a dead Expo endpoint costs the recipient a
 * buzz, not the message: they still see it in the bell, and the socket push
 * still fired. Nothing in this module is allowed to throw into a caller.
 *
 * Expo's contract (https://docs.expo.dev/push-notifications/sending-notifications):
 *   - at most 100 messages per request;
 *   - the response is one *ticket* per message, in order;
 *   - a ticket with `details.error === "DeviceNotRegistered"` means that token
 *     is dead — the app was uninstalled or the token rotated — and Expo will
 *     start rate-limiting us if we keep sending to it.
 */

import { DeviceTokenModel } from "@hostel/db/models/DeviceToken";

import { connectToDatabase } from "@/lib/db";
import { filterPushRecipients } from "@/modules/notifications/notification-preference.service";
import { deepLinkForNotification } from "@/modules/notifications/push-routing";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo's documented per-request cap. */
const MAX_MESSAGES_PER_REQUEST = 100;

const REQUEST_TIMEOUT_MS = 10_000;

type ExpoPushMessage = {
  body: string;
  channelId?: string;
  data: Record<string, unknown>;
  richContent?: { image: string };
  priority: "default" | "high";
  sound: "default" | null;
  title: string;
  to: string;
};

type ExpoPushTicket = {
  details?: { error?: string };
  id?: string;
  message?: string;
  status: "ok" | "error";
};

export type PushPayload = {
  /** A hand-picked destination for this row; overrides the category default. */
  actionUrl?: string;
  body: string;
  category: string;
  data?: Record<string, unknown>;
  hostelId?: string;
  imageUrl?: string;
  notificationId?: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  title: string;
};

export type PushResult = {
  /** Tokens Expo told us are dead; already marked REVOKED. */
  revoked: number;
  sent: number;
  skipped: boolean;
};

const EMPTY: PushResult = { revoked: 0, sent: 0, skipped: true };

/**
 * An Expo access token is only required once the project enables "enhanced
 * push security". Without it Expo still accepts the request, so this is
 * optional rather than a hard requirement — but when it is set we must send it
 * or every push 401s.
 */
function authHeaders(): Record<string, string> {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();

  return {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

/**
 * Android notification channel, which decides the sound and whether the
 * notification can interrupt. Created client-side in `lib/push-notifications.ts`
 * and the ids must match that file exactly — an id the phone has no channel for
 * is not an error and not a dropped notification, but it does land on
 * expo-notifications' own fallback channel, which is IMPORTANCE_HIGH with the
 * system sound. So a mismatch shows up as ordinary notifications suddenly
 * buzzing like alerts, on the phones that have not updated yet.
 *
 * `default_v2` and `food_v2` carry the app's own notification tone. The suffix
 * is not decoration: a channel's sound is frozen when Android creates it, so
 * giving those two a sound meant giving them new ids. `cart` is deliberately
 * quiet, and `urgent` keeps the phone's own alert sound and therefore keeps its
 * id.
 */
function androidChannel(category: string, priority: PushPayload["priority"]) {
  if (category === "SOS" || category === "URGENT" || priority === "URGENT") {
    return "urgent";
  }

  if (category === "FOOD") {
    return "food_v2";
  }

  return "default_v2";
}

function isHighPriority(payload: PushPayload) {
  return (
    payload.priority === "HIGH" ||
    payload.priority === "URGENT" ||
    payload.category === "SOS" ||
    payload.category === "URGENT"
  );
}

async function activeTokensFor(userIds: string[]) {
  await connectToDatabase();

  const rows = await DeviceTokenModel.find({
    status: "ACTIVE",
    userId: { $in: userIds },
  })
    .select({ token: 1 })
    .lean<{ token: string }[]>();

  // One person can hold several devices, and a reinstall can leave two rows
  // pointing at the same token before the old one is pruned. De-duplicate, or
  // that phone buzzes twice for one event.
  return [...new Set(rows.map((row) => row.token).filter(Boolean))];
}

async function revokeTokens(tokens: string[]) {
  if (tokens.length === 0) {
    return 0;
  }

  // REVOKED rather than deleted: the row is the record that this device once
  // existed, and `account-purge` is what actually removes it. Deleting here
  // would also race a re-registration that is already in flight.
  const result = await DeviceTokenModel.updateMany(
    { token: { $in: tokens } },
    { $set: { status: "REVOKED" } },
  );

  return result?.modifiedCount ?? tokens.length;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function postBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      body: JSON.stringify(messages),
      headers: authHeaders(),
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { data?: ExpoPushTicket[] };

    return payload?.data ?? [];
  } catch {
    // Timeout, DNS, Expo outage. The notification row is already saved.
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send one notification to every active device of every listed user.
 *
 * Callers do not await the result for correctness — see `dispatchPush` — but it
 * is returned so tests and the cron can assert on it.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<PushResult> {
  const everyone = [...new Set(userIds.filter(Boolean))];

  if (everyone.length === 0) {
    return EMPTY;
  }

  // Declared here rather than beside its other use below, because the
  // preference filter needs it first — and one source for "is this urgent"
  // keeps the exemption and the Expo priority from ever disagreeing.
  const high = isHighPriority(payload);

  /*
   * Notification preferences and quiet hours, applied **before** the token
   * lookup so a muted account costs one array filter rather than a query.
   *
   * `high` is what exempts SOS and anything URGENT from the whole mechanism —
   * a preference screen that can silence a safety alert is a setting whose worst
   * case is somebody not being found. See `notification-quiet-hours.ts`.
   *
   * A lookup failure returns the full audience: over-delivering during a
   * database blip is recoverable, and silence is the failure nobody reports.
   */
  const recipients = await filterPushRecipients(everyone, {
    category: payload.category,
    isUrgent: high,
  });

  if (recipients.length === 0) {
    return EMPTY;
  }

  const tokens = await activeTokensFor(recipients);

  if (tokens.length === 0) {
    return EMPTY;
  }

  const data = {
    ...payload.data,
    category: payload.category,
    hostelId: payload.hostelId,
    notificationId: payload.notificationId,
    /*
     * The tap target is decided here, on the server, not guessed by the app.
     * That way a new notification category ships its own destination and old
     * app builds still route somewhere sensible.
     */
    path: deepLinkForNotification(payload),
  };

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    body: payload.body,
    channelId: androidChannel(payload.category, payload.priority),
    data,
    priority: high ? "high" : "default",
    ...(payload.imageUrl ? { richContent: { image: payload.imageUrl } } : {}),
    sound: "default",
    title: payload.title,
    to: token,
  }));

  let sent = 0;
  const dead: string[] = [];

  for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
    const tickets = await postBatch(batch);

    // Tickets come back positionally, so index i answers for batch[i]. An
    // empty tickets array means the whole request failed; nothing to prune.
    batch.forEach((message, index) => {
      const ticket = tickets[index];

      if (!ticket) {
        return;
      }

      if (ticket.status === "ok") {
        sent += 1;
        return;
      }

      if (ticket.details?.error === "DeviceNotRegistered") {
        dead.push(message.to);
      }
    });
  }

  const revoked = await revokeTokens(dead).catch(() => 0);

  return { revoked, sent, skipped: false };
}

/**
 * Fire-and-forget wrapper used by the notification service.
 *
 * Notification creation happens inside request handlers that a user is waiting
 * on. Blocking a complaint submission for up to ten seconds so a phone can buzz
 * a moment sooner is the wrong trade, so this deliberately does not await —
 * and swallows everything, because an unhandled rejection here would take down
 * a request that already succeeded.
 */
export function dispatchPush(userIds: string[], payload: PushPayload) {
  void sendPushToUsers(userIds, payload).catch(() => {
    // Best-effort. The durable row is already written.
  });
}
