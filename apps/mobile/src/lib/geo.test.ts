import { describe, expect, it } from "vitest";

import {
  boundsCenter,
  haversineMeters,
  hostelCoordinates,
  isUsableCoordinate,
  KATHMANDU,
  sortByDistance,
} from "@/lib/geo";
import type { PublicHostel } from "@/lib/public-api";

/**
 * The unit is the whole test.
 *
 * A haversine that returns kilometres instead of metres still produces a sorted
 * list — just one that is silently wrong everywhere it is shown next to
 * `formatDistance`, which expects metres. So the first assertions here pin the
 * magnitude against distances that can be checked on a map.
 */

const POKHARA = { lat: 28.2096, lng: 83.9856 };

function hostel(
  partial: {
    coordinates?: { lat: number; lng: number } | null;
    id: string;
    lat?: number;
    lng?: number;
  },
): PublicHostel {
  return {
    coordinates: partial.coordinates ?? null,
    id: partial.id,
    location: { area: "Test", lat: partial.lat, lng: partial.lng },
    name: partial.id,
  } as unknown as PublicHostel;
}

describe("haversineMeters", () => {
  it("returns metres, not kilometres", () => {
    // One degree of latitude is ~111 km anywhere on earth. If this comes back
    // as ~111, every distance in the app is out by a factor of 1,000.
    const oneDegree = haversineMeters({ lat: 27, lng: 85 }, { lat: 28, lng: 85 });

    expect(oneDegree).toBeGreaterThan(110_000);
    expect(oneDegree).toBeLessThan(112_000);
  });

  it("matches a distance that can be checked on a map", () => {
    // Kathmandu to Pokhara is ~140 km as the crow flies.
    const distance = haversineMeters(KATHMANDU, POKHARA);

    expect(distance).toBeGreaterThan(135_000);
    expect(distance).toBeLessThan(150_000);
  });

  it("is zero for the same point and symmetric between two", () => {
    expect(haversineMeters(KATHMANDU, KATHMANDU)).toBe(0);
    expect(haversineMeters(KATHMANDU, POKHARA)).toBe(
      haversineMeters(POKHARA, KATHMANDU),
    );
  });

  it("resolves distances small enough to matter in a city", () => {
    // ~1 km apart within Kathmandu — the scale the sort actually operates at.
    const distance = haversineMeters(
      { lat: 27.7172, lng: 85.324 },
      { lat: 27.7262, lng: 85.324 },
    );

    expect(distance).toBeGreaterThan(950);
    expect(distance).toBeLessThan(1_050);
  });
});

describe("isUsableCoordinate", () => {
  it("rejects Null Island, which is what an unfilled form saves", () => {
    expect(isUsableCoordinate({ lat: 0, lng: 0 })).toBe(false);
  });

  it("accepts a real coordinate that happens to have a zero component", () => {
    // 0° latitude with a real longitude is Ecuador, not a placeholder.
    expect(isUsableCoordinate({ lat: 0, lng: 85.324 })).toBe(true);
  });

  it("rejects nothing, missing fields and out-of-range values", () => {
    expect(isUsableCoordinate(null)).toBe(false);
    expect(isUsableCoordinate(undefined)).toBe(false);
    expect(isUsableCoordinate({})).toBe(false);
    expect(isUsableCoordinate({ lat: 27.7 })).toBe(false);
    expect(isUsableCoordinate({ lat: Number.NaN, lng: 85 })).toBe(false);
    expect(isUsableCoordinate({ lat: 91, lng: 85 })).toBe(false);
    expect(isUsableCoordinate({ lat: 27, lng: 181 })).toBe(false);
  });
});

describe("hostelCoordinates", () => {
  it("prefers `coordinates` and falls back to the flat location fields", () => {
    expect(hostelCoordinates(hostel({ coordinates: KATHMANDU, id: "a" }))).toEqual(
      KATHMANDU,
    );
    expect(
      hostelCoordinates(hostel({ id: "b", lat: 27.7172, lng: 85.324 })),
    ).toEqual(KATHMANDU);
  });

  it("returns null for an un-geocoded hostel rather than a point at zero", () => {
    // The difference matters: null means "no distance", (0,0) would mean
    // "5,000 km away" and would sort the hostel last on merit it never had.
    expect(hostelCoordinates(hostel({ id: "c" }))).toBeNull();
    expect(hostelCoordinates(hostel({ id: "d", lat: 0, lng: 0 }))).toBeNull();
  });
});

describe("sortByDistance", () => {
  const near = hostel({ coordinates: { lat: 27.72, lng: 85.325 }, id: "near" });
  const far = hostel({ coordinates: POKHARA, id: "far" });
  const middle = hostel({ coordinates: { lat: 27.9, lng: 85.0 }, id: "middle" });
  const unplaced = hostel({ id: "unplaced" });

  it("orders nearest first and attaches the distance", () => {
    const sorted = sortByDistance([far, near, middle], KATHMANDU);

    expect(sorted.map((row) => row.hostel.id)).toEqual(["near", "middle", "far"]);
    expect(sorted[0].distanceMeters).toBeLessThan(1_000);
  });

  it("keeps un-geocoded hostels in the list, last, in server order", () => {
    // Dropping them would make the sort look like a filter that removed
    // results, and they are still hostels someone can ring.
    const sorted = sortByDistance([unplaced, far, near], KATHMANDU);

    expect(sorted.map((row) => row.hostel.id)).toEqual(["near", "far", "unplaced"]);
    expect(sorted[2].distanceMeters).toBeNull();
  });

  it("leaves the order untouched when there is no device position", () => {
    // Permission denied, or never asked. The screen calls this unconditionally,
    // so the no-location path has to be the server's cheapest-first order.
    const sorted = sortByDistance([far, near, unplaced], null);

    expect(sorted.map((row) => row.hostel.id)).toEqual(["far", "near", "unplaced"]);
    expect(sorted.every((row) => row.distanceMeters === null)).toBe(true);
  });

  it("does not mutate the array it was given", () => {
    const input = [far, near];

    sortByDistance(input, KATHMANDU);

    expect(input.map((row) => row.id)).toEqual(["far", "near"]);
  });
});

describe("boundsCenter", () => {
  it("falls back to Kathmandu when there is nothing to show", () => {
    expect(boundsCenter([])).toEqual({ center: KATHMANDU, zoom: 12 });
  });

  it("frames a single point at street level without infinite zoom", () => {
    expect(boundsCenter([KATHMANDU])).toEqual({ center: KATHMANDU, zoom: 15 });
  });

  it("centres between two points and zooms out as the span grows", () => {
    const tight = boundsCenter([
      { lat: 27.71, lng: 85.32 },
      { lat: 27.73, lng: 85.34 },
    ]);
    const wide = boundsCenter([KATHMANDU, POKHARA]);

    expect(tight.center.lat).toBeCloseTo(27.72, 5);
    expect(tight.zoom).toBeGreaterThan(wide.zoom);
    expect(wide.center.lng).toBeCloseTo((85.324 + 83.9856) / 2, 5);
  });
});
