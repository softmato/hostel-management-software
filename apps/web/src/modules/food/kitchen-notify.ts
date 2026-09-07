import type { Types } from "mongoose";

import { createInAppNotification } from "@/modules/notifications/notification.service";
import {
  getHostelName,
  resolveHostelStaffUserIds,
} from "@/modules/residents/resident-notify";
import { CookAccountModel } from "@hostel/db/models/CookAccount";

/**
 * The two things the kitchen needs to be told, and never was.
 *
 * `food-ready-notify.ts` covers the direction the cook *sends* — "food is
 * ready" out to residents and the desk. Nothing came back the other way. A
 * hostel could rewrite the week's menu and the cook would find out by opening
 * the app; a resident could rate last night's dinner one star and the person
 * who cooked it would never know it happened.
 *
 * ## No `actionUrl` on a cook's row
 *
 * Every other notifier sets one, because `actionUrl` is a website path and
 * every other role has a website portal. A cook does not — `roleLandingPath`
 * sends the role to `/`, and `/hostel-admin` refuses their account — so an
 * `actionUrl` on a cook's notification would be a click that lands on a guard.
 * The audience is carried in `data` instead, exactly as `food-ready-notify.ts`
 * does for staff, and each surface's routing table decides where that goes.
 */

/**
 * Cooks on the roster who can actually receive something.
 *
 * `status: "ACTIVE"` and a `userId`, both required: a removed cook keeps their
 * row (frozen under a "Previous <hostel> cook" label so their work stays
 * attributed) and an invited-but-not-accepted cook has no account yet. Neither
 * is a recipient.
 */
export async function resolveHostelCookUserIds(
  hostelId: Types.ObjectId | string,
): Promise<string[]> {
  const cooks = await CookAccountModel.find({
    hostelId,
    status: "ACTIVE",
    userId: { $ne: null },
  })
    .select({ userId: 1 })
    .lean<{ userId?: Types.ObjectId }[]>();

  return [
    ...new Set(
      (cooks ?? [])
        .map((cook) => cook.userId?.toString())
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ];
}

/**
 * The hostel changed what the kitchen cooks.
 *
 * The routine *is* the cook's instructions — meals, items and serving times —
 * so a change to it made from the admin portal is a change to somebody else's
 * work, decided while they were not in the room. Sending it is the difference
 * between a cook who knows Friday's dinner moved to 8pm and one who serves at 7
 * to an empty hall.
 */
export async function notifyKitchenOfRoutineChange(input: {
  actorUserId?: string;
  hostelId: Types.ObjectId | string;
}) {
  try {
    const cooks = await resolveHostelCookUserIds(input.hostelId);

    if (cooks.length === 0) {
      return;
    }

    const hostelName = await getHostelName(input.hostelId);

    await Promise.all(
      cooks
        .filter((userId) => userId !== input.actorUserId)
        .map((userId) =>
          createInAppNotification({
            body: `${hostelName} has updated the weekly menu and serving times. Check today's meals before you start.`,
            category: "FOOD",
            createdBy: input.actorUserId,
            data: { audience: "COOK" },
            hostelId: String(input.hostelId),
            title: "The menu changed",
            userId,
          }),
        ),
    );
  } catch {
    // The routine is saved; this is delivery, not record.
  }
}

/**
 * A resident rated a meal.
 *
 * Goes to the kitchen *and* to the desk, because they act on it differently:
 * the cook can change tonight's dal, the admin is the one who has to answer for
 * a pattern of them. One low rating is not an incident, so only ratings of two
 * or below are sent at all — the analytics panel is where the averages live,
 * and a push per plate of food would be the fastest way to get this whole
 * category muted.
 */
export async function notifyKitchenOfFoodFeedback(input: {
  comment?: string;
  hostelId: Types.ObjectId | string;
  mealType: string;
  rating: number;
  residentName?: string;
}) {
  try {
    if (input.rating > 2) {
      return;
    }

    const [cooks, staff, hostelName] = await Promise.all([
      resolveHostelCookUserIds(input.hostelId),
      resolveHostelStaffUserIds(input.hostelId).catch(() => [] as string[]),
      getHostelName(input.hostelId),
    ]);

    const meal = input.mealType.toLowerCase();
    const comment = input.comment?.trim();
    const body = comment
      ? `${input.rating}/5 for ${meal} — “${comment.length > 140 ? `${comment.slice(0, 137)}…` : comment}”`
      : `${input.rating}/5 for ${meal}, with no comment left.`;

    await Promise.all([
      ...cooks.map((userId) =>
        createInAppNotification({
          body,
          category: "FOOD",
          data: { audience: "COOK" },
          hostelId: String(input.hostelId),
          title: "A resident rated your food",
          userId,
        }),
      ),
      ...staff.map((userId) =>
        createInAppNotification({
          actionUrl: "/hostel-admin/food",
          body: `${input.residentName ?? "A resident"} at ${hostelName} — ${body}`,
          category: "FOOD",
          data: { audience: "STAFF" },
          hostelId: String(input.hostelId),
          title: "Low food rating",
          userId,
        }),
      ),
    ]);
  } catch {
    // Best effort; the rating is stored and counted either way.
  }
}
