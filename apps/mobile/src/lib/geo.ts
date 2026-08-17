import type { PublicHostel } from "@/lib/public-api";

/**
 * Distance arithmetic for "hostels near me".
 *
 * ## Why this is done on the client
 *
 * There is no geospatial query on the server: `publicHostelListQuerySchema` has
 * no `lat`/`lng`/`radius`, and `Hostel` has **no `2dsphere` index** —
 * `location.lat`/`lng` are plain numbers, not a GeoJSON `Point`. But
 * `/public/hostels` already returns `coordinates` on every row and caps the list
 * at 60, so sorting 60 points in JavaScript is correct, costs one pass, and
 * needs nothing from the server. When the dataset outgrows that cap it becomes a
 * real server change — a `Point` mirror field, a `2dsphere` index, `$geoNear`,
 * and a backfill migration for existing hostels — not a patch to this file.
 *
 * ## Why it is in `lib/` with tests
 *
 * This is exactly the arithmetic that looks right and is out by a factor of
 * 1,000. `formatDistance` in `hostel-display.ts` nearly printed metres as
 * kilometres, and a sort that is silently wrong is worse than no sort: the list
 * still looks ordered, so nobody checks it.
 *
 * ## Coordinates are never stored
 *
 * Nothing here writes to Redux or to disk. The device's position is passed in as
 * an argument and lives only in the calling screen's state — a lat/lng that
 * `redux-persist` writes to disk is a location history, and `apps/web` already
 * has a test enforcing the same line for attendance pings.
 */

export type Coordinates = { lat: number; lng: number };

/**
 * Metres between two points, mirroring `haversineMeters` in
 * `apps/web/src/lib/maps/nearby.ts` — same earth radius, same rounding — so a
 * distance shown on the phone matches the one shown on the web.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Whether a pair of numbers is a location rather than a placeholder.
 *
 * `0, 0` is in the Gulf of Guinea and is what an unfilled form saves. A hostel
 * carrying it would otherwise sort ~5,000 km from Kathmandu — harmless — or, if
 * the *device* reported it, would push every real hostel to the same absurd
 * distance and reorder the whole list. Both are rejected here.
 */
export function isUsableCoordinate(
  point: { lat?: number | null; lng?: number | null } | null | undefined,
): point is Coordinates {
  if (!point) return false;

  const { lat, lng } = point;

  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;

  // Null Island. Not a hostel, not a phone.
  return !(lat === 0 && lng === 0);
}

/**
 * A hostel's position, from either field the payload might carry it in.
 *
 * `serializePublicHostel` fills `coordinates` *and* `location.lat`/`lng`, but
 * only for hostels that have been geocoded — an un-geocoded listing has
 * `coordinates: null`, which is a hostel with no distance rather than a hostel
 * at distance zero.
 */
export function hostelCoordinates(hostel: PublicHostel): Coordinates | null {
  if (isUsableCoordinate(hostel.coordinates)) {
    return hostel.coordinates;
  }

  const fallback = { lat: hostel.location.lat, lng: hostel.location.lng };

  return isUsableCoordinate(fallback) ? fallback : null;
}

export type HostelWithDistance = {
  /** Metres from the device, or null when the hostel has no coordinates. */
  distanceMeters: number | null;
  hostel: PublicHostel;
};

/**
 * The list, nearest first.
 *
 * Hostels with no coordinates keep their server order and go **last** rather
 * than being dropped: an un-geocoded listing is still a real hostel someone can
 * ring, and silently removing rows when a sort is applied reads as the filter
 * having done something it did not do.
 *
 * With no device position this returns the list untouched — same order, every
 * distance null — so a screen can call it unconditionally.
 */
export function sortByDistance(
  hostels: PublicHostel[],
  from: Coordinates | null,
): HostelWithDistance[] {
  const measured = hostels.map((hostel) => {
    const point = from ? hostelCoordinates(hostel) : null;

    return {
      distanceMeters: point && from ? haversineMeters(from, point) : null,
      hostel,
    };
  });

  if (!from) {
    return measured;
  }

  // `sort` is stable in every engine the app runs on (Hermes included), so
  // equal-distance and undistanced rows keep the server's cheapest-first order.
  return [...measured].sort((a, b) => {
    if (a.distanceMeters === null && b.distanceMeters === null) return 0;
    if (a.distanceMeters === null) return 1;
    if (b.distanceMeters === null) return -1;

    return a.distanceMeters - b.distanceMeters;
  });
}

/**
 * The map's starting view: a centre and a zoom that fits every marker.
 *
 * Computed from the points rather than hard-coded to Kathmandu — the product
 * covers all of Nepal, and a map that opens on the wrong valley makes the user
 * pan before they can read it. Falls back to Kathmandu only when there is
 * nothing at all to show.
 */
export const KATHMANDU: Coordinates = { lat: 27.7172, lng: 85.324 };

export function boundsCenter(points: Coordinates[]): {
  center: Coordinates;
  /** Rough Leaflet zoom level, 5 (all of Nepal) to 15 (one street). */
  zoom: number;
} {
  if (points.length === 0) {
    return { center: KATHMANDU, zoom: 12 };
  }

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const span = Math.max(maxLat - minLat, maxLng - minLng);

  // Degrees of span → zoom. One marker (span 0) would be infinite zoom, so the
  // ladder is a table rather than a logarithm, and it stops at 15: a single
  // hostel framed at street level is a map with no context around it.
  const zoom =
    span === 0 ? 15 : span > 4 ? 6 : span > 1 ? 8 : span > 0.4 ? 10 : span > 0.1 ? 12 : 14;

  return { center, zoom };
}
