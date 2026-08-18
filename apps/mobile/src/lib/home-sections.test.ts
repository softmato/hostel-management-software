import { describe, expect, it } from "vitest";

import {
  cityCounts,
  featuredCities,
  inCity,
  servingMeals,
  showcaseHostels,
  topRatedHostels,
  withVacantBeds,
} from "@/lib/home-sections";
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
  it("ranks a photo first but still carries the hostels without one", () => {
    const result = showcaseHostels([hostel({ id: "no-photo" }), withPhoto({ id: "has-photo" })]);

    /*
     * Both, in that order. Excluding the photo-less one left a single-card
     * carousel on a young catalogue — nothing to slide to, and no position dots.
     */
    expect(result.map((row) => row.id)).toEqual(["has-photo", "no-photo"]);
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

describe("featuredCities", () => {
  const listings = [
    hostel({ id: "k1", location: { area: "Ghattekulo", city: "kathmandu" } }),
    hostel({ id: "k2", location: { area: "Baneshwor", city: "Kathmandu" } }),
    hostel({ id: "p1", location: { area: "Lakeside", city: "Pokhara" } }),
  ];

  it("keeps the configured order and shows zero for a city with no listings", () => {
    const result = featuredCities(["Kathmandu", "Lalitpur", "Pokhara"], listings);

    expect(result).toEqual([
      { city: "Kathmandu", count: 2 },
      { city: "Lalitpur", count: 0 },
      { city: "Pokhara", count: 1 },
    ]);
  });

  it("labels the card with the configured spelling, not the payload's", () => {
    // Both listings say "kathmandu"/"Kathmandu"; the admin typed one of them.
    expect(featuredCities(["KATHMANDU"], listings)[0]).toEqual({
      city: "KATHMANDU",
      count: 2,
    });
  });

  it("appends a city that has listings but was never configured", () => {
    const result = featuredCities(["Lalitpur"], listings);

    // "kathmandu" lowercase: an unconfigured city keeps `cityCounts`' label,
    // which is the first spelling the payload used.
    expect(result.map((row) => row.city)).toEqual(["Lalitpur", "kathmandu", "Pokhara"]);
  });

  it("falls back to the payload's own cities when nothing is configured", () => {
    expect(featuredCities([], listings).map((row) => row.city)).toEqual([
      "kathmandu",
      "Pokhara",
    ]);
  });

  it("ignores blanks and repeats in the configured list", () => {
    const result = featuredCities(["Kathmandu", "  ", "kathmandu"], listings);

    expect(result.map((row) => row.city)).toEqual(["Kathmandu", "Pokhara"]);
  });

  it("caps the row", () => {
    expect(featuredCities(["A", "B", "C", "D"], [], 2)).toHaveLength(2);
  });
});

describe("topRatedHostels", () => {
  it("drops every hostel nobody has reviewed", () => {
    const result = topRatedHostels([
      hostel({ id: "unrated", ratingSummary: rated(0, 0) }),
      hostel({ id: "rated", ratingSummary: rated(4.1, 3) }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["rated"]);
  });

  it("keeps a hostel that genuinely averages zero — total is what decides", () => {
    expect(topRatedHostels([hostel({ ratingSummary: rated(0, 2) })])).toHaveLength(1);
  });

  it("ranks by average, and breaks a tie on the number of reviews", () => {
    const result = topRatedHostels([
      hostel({ id: "few", ratingSummary: rated(4.8, 1) }),
      hostel({ id: "best", ratingSummary: rated(4.9, 2) }),
      hostel({ id: "many", ratingSummary: rated(4.8, 40) }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["best", "many", "few"]);
  });

  it("breaks an identical tie on the name, so the row does not flicker", () => {
    const result = topRatedHostels([
      hostel({ id: "b", name: "Beta", ratingSummary: rated(4.5, 5) }),
      hostel({ id: "a", name: "Alpha", ratingSummary: rated(4.5, 5) }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("caps the row", () => {
    const rows = [1, 2, 3].map((n) =>
      hostel({ id: String(n), ratingSummary: rated(4, n) }),
    );

    expect(topRatedHostels(rows, 2)).toHaveLength(2);
  });

  it("does not mutate the caller's array", () => {
    const rows = [
      hostel({ id: "low", ratingSummary: rated(3, 1) }),
      hostel({ id: "high", ratingSummary: rated(5, 1) }),
    ];

    topRatedHostels(rows);

    expect(rows.map((row) => row.id)).toEqual(["low", "high"]);
  });
});

describe("withVacantBeds", () => {
  it("keeps only hostels with a bed actually free", () => {
    const result = withVacantBeds([
      hostel({ capacitySummary: { vacantBeds: 4 }, id: "free" }),
      hostel({ capacitySummary: { vacantBeds: 0 }, id: "full" }),
      hostel({ capacitySummary: { totalBeds: 40 }, id: "unpublished" }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["free"]);
  });

  it("keeps the payload's cheapest-first order rather than ranking by vacancy", () => {
    const result = withVacantBeds([
      hostel({ capacitySummary: { vacantBeds: 2 }, id: "cheap" }),
      hostel({ capacitySummary: { vacantBeds: 90 }, id: "empty" }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["cheap", "empty"]);
  });

  it("caps the row", () => {
    const rows = [1, 2, 3].map((n) =>
      hostel({ capacitySummary: { vacantBeds: n }, id: String(n) }),
    );

    expect(withVacantBeds(rows, 2)).toHaveLength(2);
  });
});

describe("servingMeals", () => {
  it("keeps only hostels that actually serve meals", () => {
    const result = servingMeals([
      hostel({ food: { mealsPerDay: 2 }, id: "meals", slug: "meals" }),
      hostel({ food: {}, id: "none", slug: "none" }),
      hostel({ food: { mealsPerDay: 0 }, id: "zero", slug: "zero" }),
    ]);

    expect(result.map((row) => row.id)).toEqual(["meals"]);
  });

  it("treats a missing food block as no meals rather than throwing", () => {
    expect(servingMeals([hostel({ food: undefined })])).toHaveLength(0);
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
