import { describe, expect, it } from "vitest";

import {
  averageRating,
  cityCount,
  homeStats,
  vacantBeds,
  verifiedCount,
} from "@/lib/home-stats";
import type { PublicHostel } from "@/lib/public-api";

function hostel(overrides: Partial<PublicHostel> = {}): PublicHostel {
  return {
    capacitySummary: { vacantBeds: 0 },
    contact: {},
    coordinates: null,
    demoDataLabel: "",
    description: "",
    facilities: [],
    food: {},
    hostelType: "BOYS",
    id: "1",
    isDemoData: false,
    location: { area: "Lazimpat", city: "Kathmandu" },
    name: "A hostel",
    nearbyPlaces: [],
    photos: [],
    pricing: {},
    ratingSummary: {
      averageRating: 0,
      cleanlinessRating: 0,
      foodRating: 0,
      safetyRating: 0,
      total: 0,
    },
    roomConfigurations: [],
    roomTypes: [],
    rules: [],
    slug: "a-hostel",
    verificationStatus: "VERIFIED",
    ...overrides,
  } as PublicHostel;
}

describe("verifiedCount", () => {
  it("counts only verified hostels", () => {
    expect(
      verifiedCount([
        hostel({ verificationStatus: "VERIFIED" }),
        hostel({ verificationStatus: "PENDING" }),
        hostel({ verificationStatus: "UNVERIFIED" }),
      ]),
    ).toBe(1);
  });
});

describe("cityCount", () => {
  it("counts each city once, case-insensitively", () => {
    expect(
      cityCount([
        hostel({ location: { area: "a", city: "Kathmandu" } }),
        hostel({ location: { area: "b", city: "kathmandu" } }),
        hostel({ location: { area: "c", city: "Pokhara" } }),
      ]),
    ).toBe(2);
  });

  it("falls back to area when a hostel has no city", () => {
    expect(cityCount([hostel({ location: { area: "Dhulikhel" } })])).toBe(1);
  });

  it("ignores a hostel with neither", () => {
    expect(cityCount([hostel({ location: { area: "  " } })])).toBe(0);
  });
});

describe("vacantBeds", () => {
  it("sums vacancies, treating a missing count as zero", () => {
    expect(
      vacantBeds([
        hostel({ capacitySummary: { vacantBeds: 12 } }),
        hostel({ capacitySummary: {} }),
        hostel({ capacitySummary: { vacantBeds: 3 } }),
      ]),
    ).toBe(15);
  });
});

describe("averageRating", () => {
  it("weights by review count, so one review cannot outweigh two hundred", () => {
    const rated = averageRating([
      hostel({
        ratingSummary: {
          averageRating: 5,
          cleanlinessRating: 0,
          foodRating: 0,
          safetyRating: 0,
          total: 1,
        },
      }),
      hostel({
        ratingSummary: {
          averageRating: 4,
          cleanlinessRating: 0,
          foodRating: 0,
          safetyRating: 0,
          total: 99,
        },
      }),
    ]);

    // A plain mean of the two averages would be 4.5.
    expect(rated).toBeCloseTo(4.01, 2);
  });

  it("excludes unrated hostels rather than counting them as zero", () => {
    const rated = averageRating([
      hostel({
        ratingSummary: {
          averageRating: 4.6,
          cleanlinessRating: 0,
          foodRating: 0,
          safetyRating: 0,
          total: 10,
        },
      }),
      hostel(),
      hostel(),
    ]);

    expect(rated).toBeCloseTo(4.6, 5);
  });

  it("returns null when nothing has been reviewed", () => {
    expect(averageRating([hostel(), hostel()])).toBeNull();
  });
});

describe("homeStats", () => {
  it("is empty for an empty catalogue, rather than a row of zeros", () => {
    expect(homeStats([])).toEqual([]);
  });

  it("drops the tiles with nothing behind them", () => {
    const stats = homeStats([
      hostel({ capacitySummary: {}, verificationStatus: "PENDING" }),
    ]);

    expect(stats.map((stat) => stat.label)).toEqual(["City covered"]);
  });

  it("builds the full band and groups thousands", () => {
    const stats = homeStats([
      hostel({
        capacitySummary: { vacantBeds: 1200 },
        ratingSummary: {
          averageRating: 4.62,
          cleanlinessRating: 0,
          foodRating: 0,
          safetyRating: 0,
          total: 4,
        },
      }),
      hostel({ capacitySummary: { vacantBeds: 34 }, location: { area: "x", city: "Pokhara" } }),
    ]);

    expect(stats).toEqual([
      { label: "Verified hostels", value: "2" },
      { label: "Cities covered", value: "2" },
      { label: "Beds available", value: "1,234" },
      { label: "Average rating", value: "4.6 ★" },
    ]);
  });
});
