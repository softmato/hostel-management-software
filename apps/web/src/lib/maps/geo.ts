import type { Coordinates } from "./types";

/**
 * The coordinate helpers the map screen needs, and nothing else.
 *
 * ## There are two copies of this arithmetic, on purpose
 *
 * The twin is `apps/mobile/src/lib/geo.ts`. `apps/mobile` is **not** an npm
 * workspace — the root `workspaces` are `apps/web`, `packages/db` and
 * `packages/shared` — so the web cannot import from it, and pulling mobile into
 * the workspace to share three functions is a far larger change than the map
 * screen this exists for (`WEB_MAP_PLAN.md` §4.4). Anything corrected here
 * should be corrected there.
 *
 * What is *not* duplicated is `haversineMeters`: it already lives in
 * `./nearby.ts` on this side, and two earth radii is exactly how a distance on
 * the phone drifts from the same distance on the website.
 */

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

  // Null Island. Not a hostel, not a browser.
  return !(lat === 0 && lng === 0);
}

/**
 * A hostel's position, from either field the payload might carry it in.
 *
 * `serializePublicHostel` sets `coordinates` from `location.lat`/`lng` **and**
 * spreads the whole `location` subdocument into the response, so the raw
 * lat/lng are on the wire too even though `PublicHostel` does not declare them.
 * Hence the structural parameter rather than `PublicHostel`: this reads what
 * the server sends, not what the hand-written type says it sends.
 *
 * An un-geocoded listing has neither, which is a hostel with no distance rather
 * than a hostel at distance zero.
 */
export function hostelCoordinates(hostel: {
  coordinates?: { lat?: number | null; lng?: number | null } | null;
  /**
   * `unknown`, and that is the point: `PublicHostel` declares this as the four
   * address strings, so there is no type here to read `lat`/`lng` off. They are
   * on the wire all the same, and the runtime check below is what establishes
   * that — which is the correct shape for "the server sends more than the type
   * admits", rather than widening the type to a lie in the other direction.
   */
  location?: unknown;
}): Coordinates | null {
  if (isUsableCoordinate(hostel.coordinates)) {
    return hostel.coordinates;
  }

  const fallback =
    typeof hostel.location === "object" && hostel.location !== null
      ? (hostel.location as { lat?: number | null; lng?: number | null })
      : null;

  return isUsableCoordinate(fallback) ? fallback : null;
}

/**
 * The map's starting view: a centre and a zoom that fits every marker.
 *
 * Computed from the points rather than hard-coded to Kathmandu — the product
 * covers all of Nepal, and a map that opens on the wrong valley makes the
 * reader pan before they can read it. Falls back to Kathmandu only when there
 * is nothing at all to show.
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

/**
 * A distance, as a reader reads it.
 *
 * The same function as `formatDistance` in `apps/mobile/src/lib/hostel-display.ts`,
 * so a hostel is not 900 m away on the phone and 850 m away on the website.
 *
 * Rounded to 50 m under a kilometre: a walking distance quoted to the metre is
 * false precision from a geocoded centroid. The countdown to a *turn* needs
 * finer steps than this and has its own formatter — `formatManeuverDistance` in
 * `./navigation.ts`.
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) {
    return "—";
  }

  if (metres < 1_000) {
    return `${Math.round(metres / 50) * 50} m`;
  }

  return `${(Math.round(metres / 100) / 10).toFixed(1)} km`;
}
