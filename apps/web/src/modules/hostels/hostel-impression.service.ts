import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { nepalDayKey } from "@hostel/shared/food/meal-window";
import { HostelListingImpressionModel } from "@hostel/db/models/HostelListingImpression";

/**
 * Search appearances — how often a hostel's card was in a public result list.
 *
 * Counted where the list is served (`GET /public/hostels`), which is the browse
 * and search surface for both the app and the website. The server-rendered home
 * page is not counted: it is cached, so a render is not a person seeing it.
 */

export async function recordListingAppearances(
  hostelIds: string[],
  now: Date = new Date(),
): Promise<void> {
  const ids = [...new Set(hostelIds)].filter((id) => Types.ObjectId.isValid(id));

  if (ids.length === 0) {
    return;
  }

  await connectToDatabase();

  const day = nepalDayKey(now);

  await HostelListingImpressionModel.bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { day, hostelId: new Types.ObjectId(id) },
        update: { $inc: { count: 1 } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** Appearances across `[from, to]`, both Nepal days inclusive. */
export async function countListingAppearances(
  hostelIds: Types.ObjectId[],
  from: Date,
  to: Date,
): Promise<number> {
  if (hostelIds.length === 0) {
    return 0;
  }

  const [row] = await HostelListingImpressionModel.aggregate<{ total: number }>([
    {
      $match: {
        day: { $gte: nepalDayKey(from), $lte: nepalDayKey(to) },
        hostelId: { $in: hostelIds },
      },
    },
    { $group: { _id: null, total: { $sum: "$count" } } },
  ]);

  return row?.total ?? 0;
}
