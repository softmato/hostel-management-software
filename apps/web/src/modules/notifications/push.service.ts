/**
 * Push delivery, to every surface a person has registered.
 *
 * Until this file existed, `POST /api/v1/mobile/device-token` wrote a
 * `DeviceToken` row and nothing ever read it — every "push notification"
 * deliverable in PHASES.md §6 was half a feature. This is the other half.
 *
 * ## Two transports, one audience
 *
 * A recipient can be holding a phone with the app installed, sitting at a
 * laptop with the tab closed, or both. Those need different wire protocols —
 * Expo for the app, Web Push for the browser — but they must never need
 * different *callers*. Everything upstream (all eighteen notification
 * producers, the campaign dispatcher, the crons) hands this one audience and
 * one payload, and the split happens here, once.
 *
 * That is the whole reason browser push was a change to this file and not to
 * eighteen others.
 *
 * Delivery is best-effort by design on both sides. The `Notification` row is
 * already committed before we get here, so a dead endpoint costs the recipient
 * a buzz, not the message: they still see it in the bell, and the socket push
 * still fired. Nothing in this module is allowed to throw into a caller.
 *
 * Expo's contract (https://docs.expo.dev/push-notifications/sending-notifications):
 *   - at most 100 messages per request;
 *   - the response is one *ticket* per message, in order;
 *   - a ticket with `details.error === "DeviceNotRegistered"` means that token
 *     is dead — the app was uninstalled or the token rotated — and Expo will
 *     start rate-limiting us if we keep sending to it.
 *
 * The Web Push half lives in `web-push.service.ts`; see there for why a
 * subscription is encrypted per-endpoint and what `404`/`410` mean.
 */

import { DeviceTokenModel } from "@hostel/db/models/DeviceToken";
import { PushTicketModel } from "@hostel/db/models/PushTicket";
import { UserModel } from "@hostel/db/models/User";

import { connectToDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { filterPushRecipients } from "@/modules/notifications/notification-preference.service";
import { afterResponse } from "@/lib/after-response";
import { deepLinkForNotification } from "@/modules/notifications/push-routing";
import { sendWebPush, type WebPushTarget } from "@/modules/notifications/web-push.service";
import { webLinkForNotification } from "@/modules/notifications/web-routing";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo's documented per-request cap. */
const MAX_MESSAGES_PER_REQUEST = 100;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The capability an install declares when its JavaScript draws a data-only
 * message itself, buttons included. Must equal `APP_DRAWS_CATEGORY_PUSHES` in
 * `apps/mobile/src/lib/night-status-actions.ts`; see `drawnByTheApp` below for
 * why the message has to be sent that way at all.
 */
export const APP_DRAWS_CATEGORY_PUSHES = "draws-category-pushes";

type ExpoPushMessage = {
  /** Absent on a data-only message — see `drawnByTheApp`. */
  body?: string;
  /**
   * The notification category the handset should render this under — which is
   * what puts **buttons** on it.
   *
   * The identifier names a category the app registered with
   * `setNotificationCategoryAsync`; the OS then draws that category's actions
   * under the notification. So the server decides *that* a message is
   * answerable and the app decides *what the buttons say*, which is the right
   * split: a build that has never heard of `night-status` simply renders an
   * ordinary notification and the tap opens the screen instead.
   *
   * Expo passes it to APNs as the category and to FCM as the data key the
   * client reads at build time. Both ends therefore have to agree on the exact
   * string, and `NIGHT_STATUS_CATEGORY` in the app is the one that matters.
   */
  categoryId?: string;
  channelId?: string;
  data: Record<string, unknown>;
  richContent?: { image: string };
  priority: "default" | "high";
  /**
   * iOS only — Android takes its tone from `channelId`. Either `"default"`, the
   * phone's own tone, or the filename of a sound the app bundles (the `sounds`
   * array in the mobile `app.json`), extension included.
   */
  sound?: string | null;
  title?: string;
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
  /**
   * Draw this one with its category's action buttons — see `categoryId` on
   * `ExpoPushMessage`. Only the nightly night-status prompt sets it today.
   */
  categoryId?: string;
  data?: Record<string, unknown>;
  /**
   * Extra data for one recipient's phones only, keyed by user id — for what
   * must not be shared across an audience, like the night-status answer token.
   * Never sent to browsers.
   */
  dataByUser?: Record<string, Record<string, unknown>>;
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

  /*
   * Notices and announcements are the pushes a hostel sends *to be seen*. On
   * `default_v2` (IMPORTANCE_DEFAULT) Android files them in the shade without a
   * heads-up banner, so all anybody noticed was the in-app toast. `notices_v1`
   * is IMPORTANCE_HIGH; a build that predates it falls back to expo's own HIGH
   * channel, so old installs get the banner too.
   */
  if (category === "NOTICE" || category === "ANNOUNCEMENT" || category === "PLATFORM") {
    return "notices_v1";
  }

  return "default_v2";
}

/**
 * The app's own tone, named for iOS.
 *
 * Android already plays it: `default_v2` and `food_v2` were created with it. iOS
 * has no channels and plays whatever each message names, so it was being told
 * `"default"` and played the system tone on every notification.
 *
 * A WAV, not the MP3 the Android channels were first given — iOS will not play
 * an MP3 as a notification sound. A build that predates the file plays the
 * default tone in its place, so older installs are unchanged rather than silent.
 */
const APP_NOTIFICATION_SOUND = "water_drop.wav";

function isHighPriority(payload: PushPayload) {
  return (
    payload.priority === "HIGH" ||
    payload.priority === "URGENT" ||
    payload.category === "SOS" ||
    payload.category === "URGENT"
  );
}

type DeviceRow = {
  capabilities?: string[] | null;
  expirationTime?: number | null;
  keys?: { auth?: string; p256dh?: string } | null;
  platform?: string;
  token: string;
  userId?: unknown;
};

/**
 * Everything registered against this audience, split by transport.
 *
 * One query for both, because they live in one collection — see the long note
 * on the `DeviceToken` model for why that is deliberate rather than lazy.
 *
 * A row with no `platform` is treated as a phone. The column is required by the
 * schema so this should not arise in the database, but the unit tests build
 * bare `{ token }` rows and, more to the point, "unknown platform" defaulting
 * to the transport that has existed the whole time is the safe direction: the
 * worst case is an Expo request that comes back with an error ticket, whereas
 * the reverse would try to encrypt against keys that were never there.
 */
async function activeDevicesFor(userIds: string[]) {
  await connectToDatabase();

  const rows = await DeviceTokenModel.find({
    status: "ACTIVE",
    userId: { $in: userIds },
  })
    .select({
      capabilities: 1,
      expirationTime: 1,
      keys: 1,
      platform: 1,
      token: 1,
      userId: 1,
    })
    .lean<DeviceRow[]>();

  // One person can hold several devices, and a reinstall can leave two rows
  // pointing at the same token before the old one is pruned. De-duplicate, or
  // that phone buzzes twice for one event.
  const seen = new Set<string>();
  const expo: ExpoDevice[] = [];
  const web: (WebPushTarget & { userId: string })[] = [];

  for (const row of rows ?? []) {
    if (!row?.token || seen.has(row.token)) {
      continue;
    }

    seen.add(row.token);

    if (row.platform === "WEB") {
      web.push({
        expirationTime: row.expirationTime,
        keys: row.keys,
        token: row.token,
        userId: String(row.userId ?? ""),
      });
      continue;
    }

    expo.push({
      capabilities: row.capabilities ?? [],
      platform: row.platform,
      token: row.token,
      userId: String(row.userId ?? ""),
    });
  }

  return { expo, web };
}

type ExpoDevice = {
  capabilities: string[];
  platform?: string;
  token: string;
  userId: string;
};

/**
 * Whether this message has to be drawn by the app rather than by the OS.
 *
 * ## Why an Android message with buttons cannot carry a title
 *
 * Expo sends a message with a title to FCM as a *notification message*. While
 * the app is backgrounded or killed — which is every night at eight — the
 * Firebase SDK draws that itself, straight into the shade, and never calls
 * `expo-notifications`. The Firebase SDK knows nothing about the categories the
 * app registered, so the resident gets the question with no way to answer it.
 * `ExpoHandlingDelegate` says as much: "when the app is in background, only
 * data-only notifications reach this point".
 *
 * So on Android the title and body travel inside `data`, the message goes out
 * data-only, and the app's background task draws it as a local notification
 * with the category attached — the one path on which Android does look the
 * buttons up.
 *
 * iOS is untouched: APNs draws the category's buttons from `aps.category`
 * itself, and a data-only push there is a throttled background wake that a
 * force-quit app never receives.
 *
 * Only rows that declared {@link APP_DRAWS_CATEGORY_PUSHES}: an older build
 * would take the data-only message and show nothing.
 */
function drawnByTheApp(device: ExpoDevice, payload: PushPayload) {
  return (
    Boolean(payload.categoryId) &&
    device.platform === "ANDROID" &&
    device.capabilities.includes(APP_DRAWS_CATEGORY_PUSHES)
  );
}

/**
 * Which portal each recipient lives in.
 *
 * Needed only by the browser transport: `/resident/payments` and
 * `/hostel-admin/payments` are two different URLs on the website, and sending
 * somebody to the other one lands them on a portal guard. The phone app has no
 * such problem — Expo Router resolves `/(resident)/payments` against whichever
 * role stack that build is showing — which is why this query is skipped
 * entirely when nobody in the audience has a browser subscribed.
 *
 * Failure returns an empty map rather than throwing: the routing then falls
 * back to the public destination, which is a worse link but still a link, and a
 * notification that arrives pointing at the wrong list beats one that never
 * arrives.
 */
async function rolesFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  try {
    const rows = await UserModel.find({ _id: { $in: userIds } })
      .select({ role: 1 })
      .lean<{ _id: unknown; role?: string }[]>();

    return new Map(
      (rows ?? []).map((row) => [String(row._id), row.role ?? ""] as const),
    );
  } catch {
    return new Map();
  }
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
      /*
       * Logged rather than swallowed. A 401 here is what an Expo project with
       * "enhanced push security" turned on and no `EXPO_ACCESS_TOKEN` looks
       * like, and a silent return made that indistinguishable from a quiet
       * evening with nothing to send.
       */
      logger.error("Expo rejected a push batch", {
        action: "push_batch_http_error",
        body: (await response.text().catch(() => "")).slice(0, 400),
        count: messages.length,
        status: response.status,
      });

      return [];
    }

    const payload = (await response.json()) as { data?: ExpoPushTicket[] };

    return payload?.data ?? [];
  } catch (error) {
    // Timeout, DNS, Expo outage. The notification row is already saved.
    logger.error("Expo push request failed", {
      action: "push_batch_request_failed",
      count: messages.length,
      error,
    });

    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The browser half of the fan-out.
 *
 * Grouped by role rather than sent one at a time, because the *only* thing that
 * varies between two recipients of the same notification is where clicking it
 * should take them — and on the website that is decided by which portal the
 * person can open. Everyone in one role shares a payload; the encryption is
 * per-endpoint regardless, so the grouping costs nothing and saves rebuilding
 * the JSON per device.
 *
 * `tag` collapses repeats in the tray: a second "food is ready" replaces the
 * first rather than stacking under it. Keyed on the notification id when there
 * is one — batched rows (`createOrUpdateBatchedNotification`) reuse an id
 * deliberately, so "5 people reacted" quietly replaces "4 people reacted" on
 * the desktop exactly as it does in the bell.
 */
async function sendToBrowsers(
  targets: (WebPushTarget & { userId: string })[],
  payload: PushPayload,
  high: boolean,
) {
  if (targets.length === 0) {
    return { revoked: [] as string[], sent: 0 };
  }

  const roles = await rolesFor([...new Set(targets.map((target) => target.userId))]);
  const byRole = new Map<string, (WebPushTarget & { userId: string })[]>();

  for (const target of targets) {
    const role = roles.get(target.userId) ?? "";
    const group = byRole.get(role);

    if (group) {
      group.push(target);
    } else {
      byRole.set(role, [target]);
    }
  }

  const revoked: string[] = [];
  let sent = 0;

  for (const [role, group] of byRole) {
    const result = await sendWebPush(group, {
      badge: "/notification-badge.png",
      body: payload.body,
      category: payload.category,
      icon: "/notification-icon.png",
      ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
      notificationId: payload.notificationId,
      tag: payload.notificationId ?? `${payload.category}:${payload.hostelId ?? ""}`,
      title: payload.title,
      url: webLinkForNotification({
        actionUrl: payload.actionUrl,
        category: payload.category,
        data: payload.data,
        role,
      }),
      urgent: high,
    });

    sent += result.sent;
    revoked.push(...result.revoked);
  }

  return { revoked, sent };
}

/**
 * Send one notification to every active device of every listed user — phones
 * through Expo, browsers through Web Push, from the same audience and the same
 * payload.
 *
 * Callers do not await the result for correctness — see `dispatchPush` — but it
 * is returned so tests and the cron can assert on it. `sent` and `revoked`
 * count both transports together: a caller asking "did this reach anybody"
 * does not care which wire it went down.
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

  const devices = await activeDevicesFor(recipients);

  if (devices.expo.length === 0 && devices.web.length === 0) {
    return EMPTY;
  }

  const tokens = devices.expo;
  const channelId = androidChannel(payload.category, payload.priority);

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
    /*
     * Whether this went down the urgent channel. A foregrounded app has no other
     * way to tell, and needs to: it shows a push silently when the socket has
     * already chimed for the same row, and an SOS must never be the one it
     * quietens. See `setNotificationHandler` in the app.
     */
    urgent: channelId === "urgent",
  };

  const messages: ExpoPushMessage[] = tokens.map((device) => {
    const deviceData = { ...data, ...payload.dataByUser?.[device.userId] };

    return drawnByTheApp(device, payload)
      ? {
          data: {
            ...deviceData,
            draw: {
              body: payload.body,
              categoryId: payload.categoryId,
              channelId,
              title: payload.title,
            },
          },
          /*
           * `high` whatever the payload's priority. Android holds back a
           * normal-priority data message while the phone dozes, and unlike a
           * notification message there is nothing for the OS to show meanwhile —
           * an eight o'clock question would surface whenever the phone next
           * woke. FCM allows high priority for a message that ends in a visible
           * notification, which this always does. The channel above is still
           * the ordinary one, so it does not buzz like an alert.
           */
          priority: "high",
          to: device.token,
        }
      : {
          body: payload.body,
          ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
          channelId,
          data: deviceData,
          /*
           * High for every channel that is meant to interrupt, not only for
           * urgent payloads: FCM holds a normal-priority message while the phone
           * dozes, and a meal-ready or a notice that lands an hour late is the
           * same as one that never came. Preferences are untouched — `high`
           * still decides that.
           */
          priority: high || channelId !== "default_v2" ? "high" : "default",
          ...(payload.imageUrl ? { richContent: { image: payload.imageUrl } } : {}),
          // The urgent channel keeps the phone's own alert tone on Android, so
          // iOS keeps it too: a soft chime is the wrong noise for an SOS.
          sound: channelId === "urgent" ? "default" : APP_NOTIFICATION_SOUND,
          title: payload.title,
          to: device.token,
        };
  });

  let sent = 0;
  const dead: string[] = [];

  /*
   * Accepted tickets, to be asked about later.
   *
   * `status: "ok"` only means Expo queued the message — FCM and APNS have not
   * seen it yet, and their verdict arrives in a receipt minutes later. Keeping
   * the ids is what makes that verdict reachable at all; see
   * `push-receipts.service.ts` for the outage this was written after.
   */
  const accepted: { category: string; ticketId: string; token: string }[] = [];
  const ticketErrors: Record<string, number> = {};

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

        if (ticket.id) {
          accepted.push({
            category: payload.category,
            ticketId: ticket.id,
            token: message.to,
          });
        }

        return;
      }

      /*
       * Every error code, not just the one we act on.
       *
       * `DeviceNotRegistered` was the only ticket error this loop had ever
       * looked at, so `MismatchSenderId`, `InvalidCredentials` and
       * `MessageTooBig` all landed here and vanished — the send reported zero
       * sent and nobody was told why.
       */
      const code = ticket.details?.error ?? "Unknown";

      ticketErrors[code] = (ticketErrors[code] ?? 0) + 1;

      if (code === "DeviceNotRegistered") {
        dead.push(message.to);
      }
    });
  }

  if (Object.keys(ticketErrors).length > 0) {
    logger.error("Expo refused push messages", {
      action: "push_ticket_errors",
      category: payload.category,
      codes: ticketErrors,
    });
  }

  /*
   * Best-effort, and never in the caller's way: a failure to write these costs
   * the receipt check for one send, not the send itself.
   */
  if (accepted.length > 0) {
    await PushTicketModel.insertMany(accepted, { ordered: false }).catch(
      () => undefined,
    );
  }

  const web = await sendToBrowsers(devices.web, payload, high);

  sent += web.sent;
  dead.push(...web.revoked);

  const revoked = await revokeTokens(dead).catch(() => 0);

  return { revoked, sent, skipped: false };
}

/**
 * Send without making the caller wait — used by the notification service.
 *
 * Notification creation happens inside request handlers that a user is waiting
 * on. Blocking a complaint submission for up to ten seconds so a phone can buzz
 * a moment sooner is the wrong trade, so this does not await.
 *
 * **It used to be a bare `void`, and that meant it never sent at all.** On a
 * serverless platform the invocation is frozen the moment the response is
 * written, so an un-awaited round trip to Expo is discarded — with no error
 * anywhere, because the request it belonged to succeeded. Proven on production
 * data: a registration wrote its `Notification` row, Pusher delivered it (the
 * bell badge appeared), the recipient had a live `DeviceToken` from ten minutes
 * earlier, and no push was ever delivered. The Pusher call was awaited; this one
 * was not. That was the only difference.
 *
 * `afterResponse` keeps both halves of the trade: the response is not held up,
 * and the platform keeps the invocation alive until Expo has answered. See
 * `lib/after-response.ts`.
 */
export function dispatchPush(userIds: string[], payload: PushPayload) {
  afterResponse(() => sendPushToUsers(userIds, payload));
}
