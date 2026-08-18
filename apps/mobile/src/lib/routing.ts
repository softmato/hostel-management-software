import type { Coordinates } from "@/lib/geo";
import { isUsableCoordinate } from "@/lib/geo";

/**
 * The road between the device and a hostel, as a line to draw.
 *
 * ## Why a third party at all
 *
 * `haversineMeters` is the distance a bird flies. It is the right number for
 * *sorting* — two hostels 400m apart in a straight line are 400m apart in any
 * ranking — and the wrong one for "how far is it": the Bagmati is 30 metres wide
 * and the nearest bridge is a kilometre away. Tracing an actual path means
 * asking something that holds a road graph, and nothing in this product does.
 *
 * ## What is sent, and to whom
 *
 * Two coordinate pairs go to **OSRM's public demo server** — the device's
 * position and the hostel's. That is the one place in this app where the user's
 * position leaves the phone, so it is worth stating plainly:
 *
 * - It happens **only** on the directions screen, which is opened by tapping a
 *   distance, never on a list or a home screen.
 * - Nothing is stored, here or there: no account, no cookie, no id. The request
 *   carries two points and nothing that says whose they are.
 * - Every other distance in the app stays local arithmetic (`lib/geo.ts`).
 *
 * ## Which router, and why not the OSRM demo
 *
 * `router.project-osrm.org` is the obvious address and the wrong one: it hosts
 * a **car graph under every profile name**, so `/route/v1/foot/` there returns a
 * driving route with a driving duration and calls it walking. Between the two
 * hostels in the live catalogue it answers 4,850m in 7 minutes for both.
 *
 * The FOSSGIS instances below are the ones openstreetmap.org's own directions
 * use, and they are one deployment per profile — `routed-foot` really is a
 * pedestrian graph. The same pair of points comes back as 5,252m in 70 minutes
 * on foot and 4,850m in 7 by car, which is the difference the toggle on the map
 * is offering.
 *
 * They are still somebody else's free service. A keyed provider
 * (OpenRouteService, GraphHopper, Mapbox) is a drop-in replacement for
 * `ROUTERS` and nothing else: the app talks to this module, not to a URL.
 *
 * ## Every failure is a `null`, never a throw
 *
 * The caller is a map with two points already on it. A rejected promise there
 * would take out a screen that can perfectly well draw a dashed straight line
 * and say so, which is exactly what it does.
 */

export const ROUTE_MODES = ["car", "foot"] as const;

export type RouteMode = (typeof ROUTE_MODES)[number];

/** One OSRM deployment per profile — see the note above about why. */
const ROUTERS: Record<RouteMode, string> = {
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
};

/** Longer than this and the straight line is the better answer. */
const TIMEOUT_MS = 8_000;

/** Below two points there is no line to draw. */
const MIN_POINTS = 2;

export type RoadRoute = {
  /** Metres along the road, which is always ≥ the straight-line distance. */
  distanceMeters: number;
  durationSeconds: number;
  /** In order, device first. Every point is `{ lat, lng }`, not OSRM's pairs. */
  points: Coordinates[];
};

/**
 * **`lng,lat`, in that order, semicolon-separated.**
 *
 * OSRM takes longitude first — the GeoJSON convention — and every other
 * coordinate in this codebase is written latitude first. Swapping them does not
 * fail: it returns a perfectly good route between two points in the wrong
 * hemisphere. Hence a builder with a test rather than a template literal at the
 * call site.
 */
export function routeUrl(from: Coordinates, to: Coordinates, mode: RouteMode): string {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;

  return `${ROUTERS[mode]}/${path}?overview=full&geometries=geojson`;
}

/**
 * The parts of an OSRM response this app draws, or `null`.
 *
 * Written against a real reply from the endpoint above rather than an invented
 * one — see `routing.test.ts`. `code` is checked because OSRM answers `200 OK`
 * with `{"code":"NoRoute"}` when the two points are on graphs that do not
 * connect, which is a real case here: a hostel geocoded into the middle of a
 * field has no road to it.
 */
export function parseRoadRoute(payload: unknown): RoadRoute | null {
  if (!isRecord(payload) || payload.code !== "Ok") {
    return null;
  }

  const route = Array.isArray(payload.routes) ? payload.routes[0] : null;

  if (!isRecord(route)) {
    return null;
  }

  const { distance, duration, geometry } = route;

  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    return null;
  }

  const coordinates =
    isRecord(geometry) && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];

  const points = coordinates.flatMap((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) {
      return [];
    }

    // GeoJSON order, unpicked here so nothing downstream has to remember it.
    const point = { lat: Number(pair[1]), lng: Number(pair[0]) };

    return isUsableCoordinate(point) ? [point] : [];
  });

  if (points.length < MIN_POINTS) {
    return null;
  }

  return {
    distanceMeters: Math.round(distance),
    durationSeconds:
      typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : 0,
    points,
  };
}

/**
 * One request, one route, `null` for everything else.
 *
 * `AbortController` rather than a `Promise.race`: a race leaves the request
 * running and its response parsed into a screen that has already given up,
 * where an abort ends it. The timeout is cleared on both paths so a resolved
 * request does not hold a timer for eight seconds.
 */
export async function fetchRoadRoute(
  from: Coordinates,
  to: Coordinates,
  mode: RouteMode = "car",
): Promise<RoadRoute | null> {
  if (!isUsableCoordinate(from) || !isUsableCoordinate(to)) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(routeUrl(from, to, mode), { signal: controller.signal });

    if (!response.ok) {
      return null;
    }

    return parseRoadRoute(await response.json());
  } catch {
    // Offline, aborted, or a body that was not JSON. All the same to the caller.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
