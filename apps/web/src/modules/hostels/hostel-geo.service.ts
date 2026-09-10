import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { resolveHostelGeo, type HostelGeoLocation } from "@/lib/maps/hostel-geo";
import { HostelModel } from "@hostel/db/models/Hostel";

type HostelGeoRecord = {
  _id: Types.ObjectId;
  location?: HostelGeoLocation;
};

/**
 * Geocode a hostel's address (if needed) and refresh its cached nearby places.
 * Best-effort: returns null and leaves the document untouched on any failure so
 * callers (registration, profile save, cron) never break on a flaky map
 * provider.
 */
export async function geocodeAndCacheHostel(hostelId: string) {
  await connectToDatabase();

  const hostel = await HostelModel.findOne({
    _id: new Types.ObjectId(hostelId),
    isDeleted: false,
  })
    .select("location")
    .lean<HostelGeoRecord | null>();

  if (!hostel?.location) {
    return null;
  }

  const resolved = await resolveHostelGeo(hostel.location);

  if (!resolved) {
    return null;
  }

  await HostelModel.updateOne({ _id: hostel._id }, { $set: resolved.set });

  return {
    coordinates: resolved.coordinates,
    nearbyCount: resolved.nearbyCount,
    nearbyRefreshed: resolved.nearbyRefreshed,
    precision: resolved.precision,
    source: resolved.source,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Background sweep (Vercel/cron): refresh hostels whose nearby-places cache is
 * missing or stale. Serial with a delay to respect the Nominatim usage policy
 * (≤1 req/sec — ARCHITECTURE.md §4.7).
 */
export async function refreshStaleNearbyPlaces(options?: {
  limit?: number;
  maxAgeDays?: number;
}) {
  await connectToDatabase();

  const limit = options?.limit ?? 5;
  const maxAgeDays = options?.maxAgeDays ?? 7;
  const threshold = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const hostels = await HostelModel.find({
    isDeleted: false,
    status: { $in: ["APPROVED", "PUBLISHED"] },
    $or: [
      { nearbyPlacesLastUpdated: { $exists: false } },
      { nearbyPlacesLastUpdated: { $lt: threshold } },
    ],
  })
    .select("_id")
    .limit(limit)
    .lean<{ _id: Types.ObjectId }[]>();

  let refreshed = 0;

  for (let index = 0; index < hostels.length; index += 1) {
    const result = await geocodeAndCacheHostel(String(hostels[index]._id)).catch(
      () => null,
    );
    // Only count a run that actually replaced the nearby cache — a hostel whose
    // provider lookup failed is still stale and will be picked up next sweep.
    if (result?.nearbyRefreshed) {
      refreshed += 1;
    }
    // Space calls out: respects Nominatim's ≤1 req/sec policy and reduces
    // throttling from the shared public Overpass endpoint.
    if (index < hostels.length - 1) {
      await sleep(2000);
    }
  }

  return { refreshed, scanned: hostels.length };
}
