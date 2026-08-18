import { describe, expect, it } from "vitest";

import { parseRoadRoute, ROUTE_MODES, routeUrl } from "@/lib/routing";

/**
 * Trimmed from a **real** reply, taken on 2026-08-18 by asking the endpoint in
 * `routing.ts` for the road between the two hostels in the live catalogue
 * (Ghattekulo → Baneshwor). The distance, the duration and the first three
 * geometry points are exactly as they came back; the other 211 points are cut
 * because they say nothing new about the parsing.
 *
 * An invented fixture is how a parser ships passing its tests and failing on the
 * first real payload — `statement-parsers` in this repo learned that four times
 * over. The two shapes worth having verbatim are the coordinate order and the
 * fact that `distance` is metres as a float, not an integer.
 */
const REAL_RESPONSE = {
  code: "Ok",
  routes: [
    {
      distance: 4850,
      duration: 423.6,
      geometry: {
        coordinates: [
          [85.329578, 27.698822],
          [85.329547, 27.698747],
          [85.329477, 27.698601],
        ],
        type: "LineString",
      },
      legs: [],
      weight: 423.6,
      weight_name: "routability",
    },
  ],
  waypoints: [{ name: "Shanti Marg" }, { name: "" }],
};

describe("routeUrl", () => {
  it("puts longitude before latitude, which is the order OSRM reads", () => {
    const url = routeUrl({ lat: 27.7, lng: 85.3 }, { lat: 27.6, lng: 85.4 }, "car");

    expect(url).toContain("/85.3,27.7;85.4,27.6");
  });

  it("asks for the full geometry as GeoJSON, which is what the parser reads", () => {
    const url = routeUrl({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, "car");

    expect(url).toContain("overview=full");
    expect(url).toContain("geometries=geojson");
  });

  /*
   * The whole point of the toggle. A host that serves a car graph under the foot
   * profile answers both modes identically, which looks like the feature working
   * — so the test pins the deployment, not just the profile name.
   */
  it("sends each mode to its own routing deployment", () => {
    const from = { lat: 27.7, lng: 85.3 };
    const to = { lat: 27.6, lng: 85.4 };

    expect(routeUrl(from, to, "foot")).toContain("routed-foot/route/v1/foot");
    expect(routeUrl(from, to, "car")).toContain("routed-car/route/v1/driving");
  });
});

describe("ROUTE_MODES", () => {
  it("is the pair the map toggles between", () => {
    expect([...ROUTE_MODES]).toEqual(["car", "foot"]);
  });
});

describe("parseRoadRoute", () => {
  it("reads distance, duration and the line out of a real reply", () => {
    const route = parseRoadRoute(REAL_RESPONSE);

    expect(route).toEqual({
      distanceMeters: 4850,
      durationSeconds: 424,
      points: [
        { lat: 27.698822, lng: 85.329578 },
        { lat: 27.698747, lng: 85.329547 },
        { lat: 27.698601, lng: 85.329477 },
      ],
    });
  });

  it("rejects a 200 that carries no route — OSRM says NoRoute in the body", () => {
    expect(parseRoadRoute({ code: "NoRoute", routes: [] })).toBeNull();
  });

  it("rejects a line of one point, which cannot be drawn", () => {
    expect(
      parseRoadRoute({
        code: "Ok",
        routes: [
          { distance: 10, duration: 5, geometry: { coordinates: [[85.3, 27.7]] } },
        ],
      }),
    ).toBeNull();
  });

  it("drops a broken pair rather than plotting it at Null Island", () => {
    const route = parseRoadRoute({
      code: "Ok",
      routes: [
        {
          distance: 10,
          duration: 5,
          geometry: {
            coordinates: [
              [85.3, 27.7],
              [0, 0],
              [85.4, 27.8],
              ["x", "y"],
            ],
          },
        },
      ],
    });

    expect(route?.points).toEqual([
      { lat: 27.7, lng: 85.3 },
      { lat: 27.8, lng: 85.4 },
    ]);
  });

  it("keeps the route when only the duration is missing", () => {
    const route = parseRoadRoute({
      code: "Ok",
      routes: [
        {
          distance: 120,
          geometry: {
            coordinates: [
              [85.3, 27.7],
              [85.31, 27.71],
            ],
          },
        },
      ],
    });

    expect(route?.durationSeconds).toBe(0);
    expect(route?.distanceMeters).toBe(120);
  });

  it("returns null for anything that is not a response", () => {
    expect(parseRoadRoute(null)).toBeNull();
    expect(parseRoadRoute("Ok")).toBeNull();
    expect(parseRoadRoute({ routes: [{ distance: 5 }] })).toBeNull();
  });
});
