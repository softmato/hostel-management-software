import { describe, expect, it } from "vitest";

import { buildCityIndex, hostelTypeLabel, locationSlug } from "@/lib/hostel-locations";

describe("locationSlug", () => {
  it("makes stable, readable slugs from typed place names", () => {
    expect(locationSlug("Kathmandu")).toBe("kathmandu");
    expect(locationSlug("  New Baneshwor ")).toBe("new-baneshwor");
    expect(locationSlug("Lakeside & Bagar")).toBe("lakeside-and-bagar");
    expect(locationSlug("Pokharā")).toBe("pokhara");
  });
});

describe("buildCityIndex", () => {
  const configured = [
    { areas: ["Baneshwor", "Kathmandu", "Boys"], city: "Kathmandu" },
    { areas: ["Lakeside"], city: "Pokhara" },
  ];

  it("counts hostels by city, type and area, keeping configured spellings", () => {
    const index = buildCityIndex(
      [
        { area: "Baneshwor", city: "kathmandu", count: 2, hostelType: "BOYS", updatedAt: "2026-09-01" },
        { area: "Koteshwor", city: "Kathmandu", count: 1, hostelType: "GIRLS", updatedAt: "2026-09-10" },
        { area: "Kathmandu", city: "Kathmandu", count: 1, hostelType: "GIRLS", updatedAt: null },
      ],
      configured,
    );

    const kathmandu = index[0];
    expect(kathmandu).toMatchObject({ count: 4, name: "Kathmandu", slug: "kathmandu" });
    expect(kathmandu.types).toEqual({ BOYS: 2, CO_LIVING: 0, GIRLS: 2 });
    expect(kathmandu.updatedAt?.toISOString().slice(0, 10)).toBe("2026-09-10");
    // An area named like its city or like a type page would collide with those pages.
    expect(kathmandu.areas.map((area) => area.slug)).toEqual(["baneshwor", "koteshwor"]);
  });

  it("keeps an open city with no hostels yet, so its page exists before its listings", () => {
    const index = buildCityIndex([], configured);

    expect(index.map((city) => [city.slug, city.count])).toEqual([
      ["kathmandu", 0],
      ["pokhara", 0],
    ]);
  });
});

describe("hostelTypeLabel", () => {
  it("names one hostel's type", () => {
    expect(hostelTypeLabel("GIRLS")).toBe("Girls hostel");
    expect(hostelTypeLabel(undefined)).toBe("Hostel");
  });
});
