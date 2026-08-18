import { describe, expect, it } from "vitest";

import { searchHostels } from "@/lib/hostel-search";
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
    name: "Education Light Hostel",
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
    slug: "education-light-hostel",
    verificationStatus: "VERIFIED",
    ...overrides,
  } as PublicHostel;
}

describe("searchHostels", () => {
  it("matches on the name, whatever the case", () => {
    const rows = [hostel({ id: "a" }), hostel({ id: "b", name: "Question Call" })];

    expect(searchHostels(rows, "QUESTION").map((row) => row.id)).toEqual(["b"]);
  });

  it("matches on the area and the city, which is how people name a place", () => {
    const rows = [
      hostel({ id: "ktm", location: { area: "Ghattekulo", city: "Kathmandu" } }),
      hostel({ id: "pkr", location: { area: "Lakeside", city: "Pokhara" } }),
    ];

    expect(searchHostels(rows, "lakeside").map((row) => row.id)).toEqual(["pkr"]);
    expect(searchHostels(rows, "kathmandu").map((row) => row.id)).toEqual(["ktm"]);
  });

  it("matches on the street address", () => {
    const rows = [
      hostel({ id: "a", location: { address: "Shanti Marg", area: "Baneshwor" } }),
    ];

    expect(searchHostels(rows, "shanti")).toHaveLength(1);
  });

  it("returns nothing rather than something irrelevant", () => {
    expect(searchHostels([hostel()], "kritika")).toEqual([]);
  });

  it("gives back the same array for a blank query, so a cleared box is free", () => {
    const rows = [hostel()];

    expect(searchHostels(rows, "   ")).toBe(rows);
  });

  it("ignores the spaces around what was typed", () => {
    // A search box on a phone collects them from the keyboard's own spacing,
    // and a query that matches only without them is a search that looks broken.
    expect(searchHostels([hostel()], "  education  ")).toHaveLength(1);
    expect(searchHostels([hostel()], "education")).toHaveLength(1);
  });
});
