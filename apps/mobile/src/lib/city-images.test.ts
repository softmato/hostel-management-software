import { describe, expect, it } from "vitest";

import { cityImageUrl, normalizeCity } from "@/lib/city-images";

describe("normalizeCity", () => {
  it("folds the spellings one address field actually produces", () => {
    expect(normalizeCity("Kathmandu")).toBe("kathmandu");
    expect(normalizeCity("  KATHMANDU  ")).toBe("kathmandu");
    expect(normalizeCity("Kathmandu Metropolitan City")).toBe("kathmandu");
    expect(normalizeCity("Pokhara Sub-Metropolitan City")).toBe("pokhara");
    expect(normalizeCity("Itahari Sub Metropolitan")).toBe("itahari");
  });

  it("resolves a city's other name to the one that has the photograph", () => {
    expect(normalizeCity("Patan")).toBe("lalitpur");
    expect(normalizeCity("Chitwan")).toBe("bharatpur");
    expect(normalizeCity("Janakpurdham")).toBe("janakpur");
  });
});

describe("cityImageUrl", () => {
  it("finds a photograph however the city was typed", () => {
    const kathmandu = cityImageUrl("Kathmandu");

    expect(kathmandu).toContain("upload.wikimedia.org");
    expect(cityImageUrl("kathmandu metropolitan city")).toBe(kathmandu);
  });

  it("returns null rather than a guess for a city we have no picture of", () => {
    expect(cityImageUrl("Ghattekulo")).toBeNull();
    expect(cityImageUrl("   ")).toBeNull();
  });

  /*
   * Wikimedia only serves widths it has already rendered — an arbitrary one
   * comes back as an HTML error page, which decodes as a *broken* image rather
   * than a missing one. Every URL in the table was checked at 500px; this stops
   * a well-meant edit to the number from breaking all fourteen at once.
   */
  it("asks for the one width every file in the table has", () => {
    for (const city of ["Kathmandu", "Pokhara", "Lalitpur", "Bhaktapur", "Butwal"]) {
      expect(cityImageUrl(city)).toContain("/500px-");
    }
  });
});
