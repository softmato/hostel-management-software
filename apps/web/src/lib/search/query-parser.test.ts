import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./query-parser";

describe("parseSearchQuery", () => {
  it("reads gender from the sentence", () => {
    expect(parseSearchQuery("girls hostel").filters.type).toBe("GIRLS");
    expect(parseSearchQuery("boys hostel").filters.type).toBe("BOYS");
    expect(parseSearchQuery("co-living space").filters.type).toBe("CO_LIVING");
  });

  it("matches a known area", () => {
    expect(parseSearchQuery("hostel in Baneshwor").filters.area).toBe("Baneshwor");
  });

  it("prefers the longer area name when both match", () => {
    expect(parseSearchQuery("rooms in New Baneshwor").filters.area).toBe("New Baneshwor");
  });

  it("falls back to a city when no locality matches", () => {
    expect(parseSearchQuery("hostels in Pokhara").filters.area).toBe("Pokhara");
  });

  it("expands shorthand budgets to rupees", () => {
    expect(parseSearchQuery("under 8k").filters.maxPrice).toBe(8000);
    expect(parseSearchQuery("under 8 thousand").filters.maxPrice).toBe(8000);
    expect(parseSearchQuery("below 12,000").filters.maxPrice).toBe(12000);
    // A bare small number in a rent query means thousands.
    expect(parseSearchQuery("under 9").filters.maxPrice).toBe(9000);
  });

  it("reads a minimum and a two-sided range", () => {
    expect(parseSearchQuery("above 10k").filters.minPrice).toBe(10000);

    const between = parseSearchQuery("between 6k and 9k").filters;
    expect(between.minPrice).toBe(6000);
    expect(between.maxPrice).toBe(9000);

    const dashed = parseSearchQuery("7000-11000 rent").filters;
    expect(dashed.minPrice).toBe(7000);
    expect(dashed.maxPrice).toBe(11000);
  });

  it("treats vague budget words as a soft cap", () => {
    expect(parseSearchQuery("cheap hostel").filters.maxPrice).toBe(8000);
    expect(parseSearchQuery("sasto hostel").filters.maxPrice).toBe(8000);
  });

  it("does not read non-veg as veg", () => {
    expect(parseSearchQuery("veg food hostel").filters.food).toBe("veg");
    expect(parseSearchQuery("non veg meals").filters.food).toBe("non-veg");
    expect(parseSearchQuery("non-veg meals").filters.food).toBe("non-veg");
  });

  it("maps facility and room-type synonyms", () => {
    expect(parseSearchQuery("hostel with wifi").filters.facility).toBe("WiFi");
    expect(parseSearchQuery("need hot water").filters.facility).toBe("Hot water");
    expect(parseSearchQuery("single room").filters.roomType).toBe("Single");
    expect(parseSearchQuery("4 sharing").filters.roomType).toBe("Dormitory");
  });

  it("routes a college-only mention into free text, not area", () => {
    const parsed = parseSearchQuery("hostel near Xavier's");

    expect(parsed.filters.q).toContain("Xavier");
    expect(parsed.filters.area).toBeUndefined();
  });

  it("prefers the locality when a name is both an area and a campus", () => {
    // "Pulchowk" is a tole as well as the IOE campus; the area filter is the
    // more useful of the two, so it wins.
    expect(parseSearchQuery("hostel near Pulchowk").filters.area).toBe("Pulchowk");
  });

  it("combines several signals from one sentence", () => {
    const { filters } = parseSearchQuery("cheap girls hostel in Koteshwor with wifi");

    expect(filters.type).toBe("GIRLS");
    expect(filters.area).toBe("Koteshwor");
    expect(filters.facility).toBe("WiFi");
    expect(filters.maxPrice).toBe(8000);
  });

  it("keeps the raw text and reports no confidence when nothing matches", () => {
    const parsed = parseSearchQuery("Sunrise Residency");

    expect(parsed.filters.q).toBe("Sunrise Residency");
    expect(parsed.confidence).toBe(0);
  });

  it("is confident enough about a plain area search to skip the model", () => {
    expect(parseSearchQuery("Baneshwor").confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("handles an empty query without inventing filters", () => {
    const parsed = parseSearchQuery("   ");

    expect(parsed.filters).toEqual({});
    expect(parsed.confidence).toBe(1);
  });
});
