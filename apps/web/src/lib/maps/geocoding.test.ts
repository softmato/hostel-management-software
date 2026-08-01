import { describe, expect, it } from "vitest";

import { buildAddressQuery, queryVariants, tidyPlaceName } from "./geocoding";

describe("queryVariants", () => {
  it("drops a repeated component that makes the query unresolvable", () => {
    // The real case: address and area were both "Narephat", and the literal
    // "Narephat, Narephat, Kathmandu, Nepal" returns zero results upstream.
    expect(queryVariants("Narephat, Narephat, Kathmandu, Nepal")[0]).toBe(
      "Narephat, Kathmandu, Nepal",
    );
  });

  it("orders variants most specific first", () => {
    expect(queryVariants("Narephat, Kathmandu, Nepal")).toEqual([
      "Narephat, Kathmandu, Nepal",
      "Kathmandu, Nepal",
      "Nepal",
    ]);
  });

  it("deduplicates case-insensitively and ignores blank components", () => {
    expect(queryVariants("Balkumari, balkumari,  , Lalitpur")).toEqual([
      "Balkumari, Lalitpur",
      "Lalitpur",
    ]);
  });

  it("returns a single variant for a one-part query", () => {
    expect(queryVariants("Narephat")).toEqual(["Narephat"]);
  });

  it("returns nothing to try for an empty query", () => {
    expect(queryVariants("   ")).toEqual([]);
    expect(queryVariants(",,")).toEqual([]);
  });

  it("keeps distinct components that merely share a word", () => {
    expect(queryVariants("New Baneshwor, Baneshwor, Kathmandu")[0]).toBe(
      "New Baneshwor, Baneshwor, Kathmandu",
    );
  });
});

describe("buildAddressQuery", () => {
  it("defaults the country to Nepal", () => {
    expect(buildAddressQuery({ area: "Balkumari", city: "Lalitpur" })).toBe(
      "Balkumari, Lalitpur, Nepal",
    );
  });

  it("skips blank parts", () => {
    expect(buildAddressQuery({ address: "  ", area: "Koteshwor" })).toBe(
      "Koteshwor, Nepal",
    );
  });
});

describe("tidyPlaceName", () => {
  it("strips the administrative suffix geocoders return", () => {
    // Nominatim answers "Kathmandu Metropolitan City" for a pin in Kathmandu;
    // stored hostels — and the public city filter — say "Kathmandu".
    expect(tidyPlaceName("Kathmandu Metropolitan City")).toBe("Kathmandu");
    expect(tidyPlaceName("Lalitpur Sub-Metropolitan City")).toBe("Lalitpur");
    expect(tidyPlaceName("Madhyapur Thimi Municipality")).toBe("Madhyapur Thimi");
    expect(tidyPlaceName("Bagamati Province")).toBe("Bagamati");
  });

  it("leaves an already-plain name alone", () => {
    expect(tidyPlaceName("Pokhara")).toBe("Pokhara");
    expect(tidyPlaceName(undefined)).toBeUndefined();
  });
});
