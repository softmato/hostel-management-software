import { describe, expect, it } from "vitest";

import { cityCounts, inCity, showcaseHostels } from "@/lib/home-sections";
import type { PublicHostel } from "@/lib/public-api";

function hostel(overrides: Partial<PublicHostel> = {}): PublicHostel {
  return {
    capacitySummary: {},
    contact: {},
    coordinates: null,
    demoDataLabel: "",
    description: "",
    facilities: [],
    food: {},
    hostelType: "BOYS",
    id: "1",
    isDemoData: false,
    location: { area: "Ghattekulo", city: "Kathmandu" },
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

function withPhoto(overrides: Partial<PublicHostel> = {}): PublicHostel {
  return hostel({
    photos: [{ alt: "", kind: "EXTERIOR", roomType: "", url: "/photo.jpg" }],
    ...overrides,
  });
}

function rated(average: number, total: number) {
  return {
    averageRating: average,
    cleanlinessRating: 0,
    foodRating: 0,
    safetyRating: 0,
    total,
  };
}

describe("cityCounts", () => {
  it("counts listings per city, busiest first", () => {
    expect(
      cityCounts([
        hostel({ location: { area: "a", city: "Kathmandu" } }),
        hostel({ location: { area: "b", city: "Pokhara" } }),
        hostel({ location: { area: "c", city: "Kathmandu" } }),
      ]),
    ).toEqual([
      { city: "Kathmandu", count: 2 },
      { city: "Pokhara", count: 1 },
    ]);
  });

  it("groups spellings case-insensitively and keeps the first one seen", () => {
    expect(
      cityCounts([
        hostel({ location: { area: "a", city: "Kathmandu" } }),
        hostel({ location: { area: "b", city: "kathmandu" } }),
      ]),
    ).toEqual([{ city: "Kathmandu", count: 2 }]);
  });

  it("falls back to area when a hostel has no city", () => {
    expect(cityCounts([hostel({ location: { area: "Dhulikhel" } })])).toEqual([
      { city: "Dhulikhel", count: 1 },
    ]);
  });

  it("skips a hostel with neither, rather than showing a blank chip", () => {
    expect(cityCounts([hostel({ location: { area: "   " } })])).toEqual([]);
  });

  it("breaks ties alphabetically, so equal cities do not swap between fetches", () => {
    const counts = cityCounts([
      hostel({ location: { area: "a", city: "Pokhara" } }),
      hostel({ location: { area: "b", city: "Biratnagar" } }),
      hostel({ location: { area: "c", city: "Kathmandu" } }),
    ]);

    expect(counts.map((row) => row.city)).toEqual(["Biratnagar", "Kathmandu", "Pokhara"]);
  });
});

describe("showcaseHostels", () => {
  it("excludes hostels with no photo — the card is one big image", () => {
    const result = showcaseHostels([hostel({ id: "no-photo" }), withPhoto({ id: "has-photo" })]);

    expect(result.map((row) => row.id)).toEqual(["has-photo"]);
  });

  it("leads with verified, then best rated", () => {
    const result = showcaseHostels([
      withPhoto({ id: "unverified-5", ratingSummary: rated(5, 20), verificationStatus: "PENDING" }),
      withPhoto({ id: "verified-4", ratingSummary: rated(4, 9) }),
      withPhoto({ id: "verified-5", ratingSummary: rated(4.8, 12) }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["verified-5", "verified-4", "unverified-5"]);
  });

  it("sorts an unreviewed hostel below a rated one instead of dropping it", () => {
    // Every average is 0 before the first review, so branching on the average
    // alone would treat a brand-new hostel as a zero-star one.
    const result = showcaseHostels([
      withPhoto({ id: "new" }),
      withPhoto({ id: "reviewed", ratingSummary: rated(3.1, 2) }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["reviewed", "new"]);
  });

  it("caps the carousel", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      withPhoto({ id: `h${index}` }),
    );

    expect(showcaseHostels(many, 4)).toHaveLength(4);
  });

  it("does not mutate the caller's array", () => {
    const rows = [
      withPhoto({ id: "second", verificationStatus: "PENDING" }),
      withPhoto({ id: "first" }),
    ];

    showcaseHostels(rows);

    expect(rows.map((row) => row.id)).toEqual(["second", "first"]);
  });
});

describe("inCity", () => {
  it("matches the same key cityCounts groups by", () => {
    const result = inCity(
      [
        hostel({ id: "1", location: { area: "a", city: "Kathmandu" } }),
        hostel({ id: "2", location: { area: "b", city: "kathmandu" } }),
        hostel({ id: "3", location: { area: "c", city: "Pokhara" } }),
      ],
      "KATHMANDU",
    );

    expect(result.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("matches a hostel whose city came from its area", () => {
    expect(inCity([hostel({ location: { area: "Dhulikhel" } })], "Dhulikhel")).toHaveLength(1);
  });

  it("does not match on a substring — Kathmandu is not Kathmandu Valley", () => {
    expect(inCity([hostel({ location: { area: "a", city: "Kathmandu Valley" } })], "Kathmandu")).toEqual([]);
  });

  it("returns everything for a blank city, rather than nothing", () => {
    const rows = [hostel()];

    expect(inCity(rows, "  ")).toBe(rows);
  });
});
