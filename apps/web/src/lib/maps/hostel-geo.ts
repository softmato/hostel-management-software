import { geocodeAddress } from "@/lib/maps/geocoding";
import { fetchNearbyPlaces } from "@/lib/maps/nearby";
import type { LocationSource } from "@/lib/maps/types";

/** The slice of a hostel document this needs. Kept structural, not a model. */
export type HostelGeoLocation = {
  address?: string;
  area?: string;
  city?: string;
  lat?: number;
  lng?: number;
  locationSource?: LocationSource;
  province?: string;
};

/**
 * Work out where a hostel sits and what is around it, and return the `$set`
 * that records the answer. Null when there is nothing to write.
 *
 * A MANUAL pin is authoritative: somebody placed that marker on their own
 * building, so we keep the coordinates and only refresh the nearby-places cache
 * around them. Re-geocoding a hand-placed pin is what silently drags a hostel
 * back to the middle of its neighbourhood.
 *
 * Split out from the write below so the backfill script can apply the same rule
 * through the raw driver — it cannot import a mongoose model, because Node's
 * ESM loader does not see `models` among mongoose's CommonJS exports. One copy
 * of the rule, two writers.
 */
export async function resolveHostelGeo(location: HostelGeoLocation | undefined) {
  if (!location) {
    return null;
  }

  const pinned =
    location.locationSource === "MANUAL" &&
    typeof location.lat === "number" &&
    typeof location.lng === "number"
      ? { lat: location.lat, lng: location.lng }
      : null;

  const geocoded = pinned ? null : await geocodeAddress(location);
  const coords = pinned ?? geocoded?.coordinates ?? null;

  if (!coords) {
    return null;
  }

  const nearby = await fetchNearbyPlaces(coords);

  return {
    coordinates: coords,
    nearbyCount: nearby?.length ?? 0,
    nearbyRefreshed: nearby != null,
    precision: pinned ? ("exact" as const) : (geocoded?.precision ?? "approximate"),
    set: {
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
    } as Record<string, unknown>,
    source: pinned ? ("MANUAL" as const) : ("GEOCODED" as const),
  };
}

