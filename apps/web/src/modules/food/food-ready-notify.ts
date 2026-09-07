import type { Types } from "mongoose";

import { HOSTEL_TIME_ZONE } from "@/modules/food/food-photo-days";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { sendPushToUsers } from "@/modules/notifications/push.service";
import {
  getHostelName,
  resolveHostelStaffUserIds,
} from "@/modules/residents/resident-notify";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * Everybody who has to hear that the food is out — and the two different things
 * they are told.
 *
 * ## Why this is its own module
 *
 * `announceFoodReady` used to do the fan-out inline, as a `for` loop awaiting
 * `createInAppNotification` once per resident. That is the wrong shape for this
 * event in two separate ways, and both of them were costing deliveries.
 *
 * **One push, not N.** Every `createInAppNotification` fires its own
 * `dispatchPush([oneUser])`, and each of those is a preference query, a token
 * query and an HTTP round trip to Expo, handed to `after()`. A hostel of forty
 * therefore scheduled forty of them for a single announcement. `after()` keeps
 * the invocation alive, but not without limit — so the residents at the end of
 * the list were the ones whose phones stayed silent, and nothing anywhere
 * reported it, because the request that wrote their notification row had
 * already returned 201. `sendPushToUsers` takes the whole audience, filters
 * preferences once, looks tokens up once, and posts to Expo in batches of a
 * hundred. The durable bell rows are still written one at a time, because they
 * are per-recipient documents; only the buzz is batched.
 *
 * **`HIGH`, not default.** Food goes cold. `isHighPriority` is what puts
 * `priority: "high"` on the Expo message, which is what lets it wake a dozing
 * Android handset rather than waiting for that handset's next maintenance
 * window. Nothing else on this portal is time-critical; this is, and it was
 * going out at the same priority as a monthly statement.
 *
 * Quiet hours are still respected — see `notification-quiet-hours.ts`. A
 * resident who set 22:00–07:00 and does not want a 06:50 breakfast ping has
 * asked for exactly that, and `HIGH` is not `URGENT`: that exemption is
 * reserved for safety, and a meal is not a safety event.
 *
 * ## The office is told too, and told something different
 *
 * A warden's question is not "is there food" — they are not queuing for it. It
 * is *did the kitchen call the meal, when, and did it reach anybody*, which is
 * the one thing about this portal an office cannot otherwise see: the account is
 * shared, effectively static, and its only attribution is the handset stamped on
 * the log row (`cook_app_portal.md` §0). So staff get the count, the clock time
 * and the handset; residents get the menu. One message to both audiences would
 * have meant telling a warden their dinner was ready.
 *
 * ## The audience is not the mailing list
 *
 * This used to fan out over `resolveActiveResidentRecipients`, which is an
 * **email** resolver: it returns `null` for a resident with no address on their
 * record and none on their linked account, and its own doc says why — "residents
 * can be registered phone-only". In Nepal that is not the edge case, it is the
 * common one. So a resident who had installed the app, signed in and left a live
 * device token was dropped from the fan-out because the hostel had never taken
 * an email address off them — and the only symptom was a number in a toast that
 * nobody could check against anything.
 *
 * A push audience is every ACTIVE resident holding an account, which is what
 * this asks the collection for. It is also what finally makes `residentCount`
 * and `notifiedCount` comparable on the cook's own screen: both count residents
 * now, and the gap between them is exactly "has not installed the app yet"
 * rather than "has no email on file".
 */

export type FoodReadyNotifyResult = {
  /** Residents with an account — the number the cook's toast reports. */
  notifiedCount: number;
  /** Owner, hostel admins and wardens, which is what `resolveHostelStaffUserIds` returns. */
  staffNotifiedCount: number;
};

function timeOfDay(at: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: HOSTEL_TIME_ZONE,
  }).format(at);
}

/**
 * The handset, as the office would recognise it.
 *
 * `deviceInfo` is `z.record(z.string(), z.unknown())` — free-form, written by
 * whatever client announced — so every read is guarded and the whole thing is
 * allowed to come back empty. A missing label drops its clause rather than
 * printing "undefined" to a warden.
 */
function deviceLabel(deviceInfo: Record<string, unknown>): string | null {
  const parts = ["brand", "model"]
    .map((key) => deviceInfo[key])
    .filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    .map((value) => value.trim());

  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  // `Redmi Redmi Note 12` is what the two fields concatenate to on most Xiaomi
  // handsets, because the model already carries the brand.
  const [brand, model] = parts;

  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

export async function notifyFoodReady(input: {
  announcedAt: Date;
  /** The cook's shared account, recorded as the author of every row. */
  createdBy?: string;
  /** Free-form, straight off the request. May be empty. */
  deviceInfo: Record<string, unknown>;
  hostelId: Types.ObjectId | string;
  /** `lunch` — already lowercased by the caller that built the message. */
  mealLabel: string;
  mealType: string;
  /** The resident-facing line, already built from the menu or hand-written. */
  message: string;
}): Promise<FoodReadyNotifyResult> {
  const hostelId = input.hostelId.toString();

  const [residents, staffUserIds, hostelName] = await Promise.all([
    ResidentModel.find({
      hostelId: input.hostelId,
      isDeleted: false,
      status: "ACTIVE",
      userId: { $ne: null },
    })
      .select({ userId: 1 })
      .lean<{ userId?: Types.ObjectId }[]>(),
    // Staff are an addition to this announcement, not a precondition for it.
    resolveHostelStaffUserIds(input.hostelId).catch(() => [] as string[]),
    getHostelName(input.hostelId),
  ]);

  const residentUserIds = [
    ...new Set(
      residents
        .map((resident) => resident.userId?.toString())
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];

  const data = { mealType: input.mealType };

  /*
   * The durable rows, with their own push suppressed — the batched send below
   * covers this whole audience at once. `push: false` no longer takes the live
   * bell with it (see `notification.service.ts`), so a resident with the app
   * already open still sees the count move without waiting for Expo.
   */
  for (const userId of residentUserIds) {
    await createInAppNotification({
      body: input.message,
      category: "FOOD",
      createdBy: input.createdBy,
      data,
      hostelId,
      priority: "HIGH",
      push: false,
      title: "Food is ready",
      userId,
    });
  }

  const label = deviceLabel(input.deviceInfo);
  const staffTitle = `Kitchen announced ${input.mealLabel}`;
  const staffBody = [
    `${hostelName} · ${timeOfDay(input.announcedAt)} · ${residentUserIds.length} resident(s) notified.`,
    label ? `Announced from ${label}.` : null,
    `“${input.message}”`,
  ]
    .filter(Boolean)
    .join(" ");

  const staffData = { ...data, audience: "STAFF" };

  for (const userId of staffUserIds) {
    await createInAppNotification({
      body: staffBody,
      category: "FOOD",
      createdBy: input.createdBy,
      /*
       * `audience` is what `deepLinkForNotification` reads to send a warden to
       * `(admin)/today` rather than to `(resident)/food`, which is the FOOD
       * default and is a route group this account cannot open. Carried in
       * `data` rather than as an `actionUrl` on purpose: `actionUrl` is also
       * what the *web* bell links to, and a mobile route group is not a web URL.
       */
      data: staffData,
      hostelId,
      /*
       * NORMAL, and explicitly so on both counts. Staff are being kept
       * informed, not summoned — this must not wake a warden's phone the way
       * the residents' copy does, and it must not sit in the bell as an
       * unresolved ACTION row waiting to be dealt with.
       */
      kind: "NORMAL",
      priority: "NORMAL",
      push: false,
      title: staffTitle,
      userId,
    });
  }

  /*
   * Two sends rather than one, because the two audiences are being told
   * different things at different priorities. Awaited — this runs inside a
   * request a cook is standing still for, and a push that is merely scheduled
   * is the failure this module exists to remove.
   */
  await Promise.all([
    residentUserIds.length > 0
      ? sendPushToUsers(residentUserIds, {
          body: input.message,
          category: "FOOD",
          data,
          hostelId,
          priority: "HIGH",
          title: "Food is ready",
        })
      : null,
    staffUserIds.length > 0
      ? sendPushToUsers(staffUserIds, {
          body: staffBody,
          category: "FOOD",
          data: staffData,
          hostelId,
          priority: "NORMAL",
          title: staffTitle,
        })
      : null,
  ]);

  return {
    notifiedCount: residentUserIds.length,
    staffNotifiedCount: staffUserIds.length,
  };
}
