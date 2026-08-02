import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { geocodeAddress } from "@/lib/maps/geocoding";
import { fetchNearbyPlaces } from "@/lib/maps/nearby";
import type { LocationSource } from "@/lib/maps/types";
import { HostelModel } from "@hostel/db/models/Hostel";

type HostelGeoRecord = {
  _id: Types.ObjectId;
  location?: {
    address?: string;
    area?: string;
    city?: string;
    lat?: number;
    lng?: number;
    locationSource?: LocationSource;
    province?: string;
  };
};

/**
 * Geocode a hostel's address (if needed) and refresh its cached nearby places.
 * Best-effort: returns null and leaves the document untouched on any failure so
 * callers (profile save, cron) never break on a flaky map provider.
 *
 * A MANUAL pin is authoritative: the admin placed that marker on their own
 * building, so we keep the coordinates and only refresh the nearby-places cache
 * around them. Re-geocoding a hand-placed pin is what silently drags a hostel
 * back to the middle of its neighbourhood.
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

  const pinned =
    hostel.location.locationSource === "MANUAL" &&
    typeof hostel.location.lat === "number" &&
    typeof hostel.location.lng === "number"
      ? { lat: hostel.location.lat, lng: hostel.location.lng }
      : null;

  const geocoded = pinned ? null : await geocodeAddress(hostel.location);
  const coords = pinned ?? geocoded?.coordinates ?? null;
  if (!coords) {
    return null;
  }

  const nearby = await fetchNearbyPlaces(coords);

  await HostelModel.updateOne(
    { _id: hostel._id },
    {
      $set: {
        // Leave location.* untouched for a manual pin so a concurrent admin
        // edit is never clobbered by a background refresh.
        ...(pinned
          ? {}
          : {
              "location.lat": coords.lat,
              "location.lng": coords.lng,
              "location.locationSource": "GEOCODED",
            }),
        // null means every provider failed. Writing it — and the timestamp —
        // would mark the hostel fresh for the whole stale window, so one bad
        // Overpass response would blank its nearby list for a week. Leave the
        // previous cache in place and let the next sweep pick it up instead.
        ...(nearby ? { nearbyPlaces: nearby, nearbyPlacesLastUpdated: new Date() } : {}),
      },
    },
  );

  return {
    coordinates: coords,
    nearbyCount: nearby?.length ?? 0,
    nearbyRefreshed: nearby != null,
    precision: pinned ? ("exact" as const) : (geocoded?.precision ?? "approximate"),
    source: pinned ? ("MANUAL" as const) : ("GEOCODED" as const),
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
