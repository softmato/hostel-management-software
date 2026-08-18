import { NotificationPreferenceModel } from "@hostel/db/models/NotificationPreference";

import { connectToDatabase } from "@/lib/db";
import {
  type PushPreference,
  shouldPush,
} from "@/modules/notifications/notification-quiet-hours";

/**
 * Reading and writing "what do you want to be interrupted by".
 *
 * The decision itself lives in `notification-quiet-hours.ts`, which is pure.
 * This file is only the storage around it.
 */

export type NotificationPreference = {
  mutedCategories: string[];
  pushEnabled: boolean;
  quietHoursEnabled: boolean;
  /** Minutes past local midnight, 0–1439. */
  quietHoursEnd: number;
  /** Minutes past local midnight, 0–1439. */
  quietHoursStart: number;
  timeZone: string;
};

export const DEFAULT_NOTIFICATION_PREFERENCE: NotificationPreference = {
  mutedCategories: [],
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursEnd: 7 * 60,
  quietHoursStart: 22 * 60,
  timeZone: "Asia/Kathmandu",
};

type PreferenceRecord = Partial<NotificationPreference> & { userId?: unknown };

function serialize(row: PreferenceRecord | null): NotificationPreference {
  // Field by field rather than a spread, so a column added to the schema and
  // not to the API type cannot leak out of the route by accident.
  return {
    mutedCategories: row?.mutedCategories ?? DEFAULT_NOTIFICATION_PREFERENCE.mutedCategories,
    pushEnabled: row?.pushEnabled ?? DEFAULT_NOTIFICATION_PREFERENCE.pushEnabled,
    quietHoursEnabled:
      row?.quietHoursEnabled ?? DEFAULT_NOTIFICATION_PREFERENCE.quietHoursEnabled,
    quietHoursEnd: row?.quietHoursEnd ?? DEFAULT_NOTIFICATION_PREFERENCE.quietHoursEnd,
    quietHoursStart:
      row?.quietHoursStart ?? DEFAULT_NOTIFICATION_PREFERENCE.quietHoursStart,
    timeZone: row?.timeZone || DEFAULT_NOTIFICATION_PREFERENCE.timeZone,
  };
}

/**
 * The account's preference, or the defaults.
 *
 * **Does not create a row.** Reading a settings screen is not a statement of
 * intent, and a `GET` that writes makes "how many people changed this?"
 * unanswerable. The row appears on the first `PATCH`.
 */
export async function getNotificationPreference(
  userId: string,
): Promise<NotificationPreference> {
  await connectToDatabase();

  const row = await NotificationPreferenceModel.findOne({ userId })
    .lean<PreferenceRecord | null>();

  return serialize(row);
}

export async function updateNotificationPreference(
  userId: string,
  patch: Partial<NotificationPreference>,
): Promise<NotificationPreference> {
  await connectToDatabase();

  const row = await NotificationPreferenceModel.findOneAndUpdate(
    { userId },
    { $set: { ...patch, userId } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<PreferenceRecord | null>();

  return serialize(row);
}

/**
 * Narrows a push audience to the accounts that actually want it.
 *
 * ## One query for the whole batch
 *
 * A notification can fan out to every resident in a hostel, so this reads all
 * the preferences in a single `$in` rather than once per recipient. Accounts
 * with no row do not come back at all and are simply kept — which is both the
 * correct default and the cheap path, since most accounts never open the screen.
 *
 * ## Failure keeps everyone
 *
 * If the lookup throws, the whole audience is returned unfiltered. A database
 * blip must not turn into silence: an undelivered payment reminder is a support
 * ticket, and an undelivered alert is worse. Over-delivering during an outage is
 * the recoverable direction.
 */
export async function filterPushRecipients(
  userIds: string[],
  options: { category?: string; isUrgent?: boolean; now?: Date } = {},
): Promise<string[]> {
  if (userIds.length === 0 || options.isUrgent) {
    // Urgent bypasses the whole mechanism — see `shouldPush`. Short-circuited
    // here as well so an SOS never waits on this query.
    return userIds;
  }

  try {
    await connectToDatabase();

    const rows = await NotificationPreferenceModel.find({ userId: { $in: userIds } })
      .lean<(PushPreference & { userId: unknown })[]>();

    if (!rows || rows.length === 0) {
      return userIds;
    }

    const byUser = new Map(rows.map((row) => [String(row.userId), row]));

    return userIds.filter(
      (userId) =>
        shouldPush({
          category: options.category,
          isUrgent: options.isUrgent,
          now: options.now,
          preference: byUser.get(userId) ?? null,
        }).allowed,
    );
  } catch {
    return userIds;
  }
}
