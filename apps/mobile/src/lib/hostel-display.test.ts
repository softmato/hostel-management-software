import { describe, expect, it } from "vitest";

import {
  campusDistanceLabel,
  coverPhoto,
  formatDistance,
  locationLabel,
  priceRange,
  ratingDisplay,
  vacancyLabel,
} from "@/lib/hostel-display";
import type { HostelPhoto, NearbyPlace } from "@/lib/public-api";

function photo(overrides: Partial<HostelPhoto> = {}): HostelPhoto {
  return { alt: "", kind: "INTERIOR", roomType: "", url: "https://x/1.jpg", ...overrides };
}

function place(overrides: Partial<NearbyPlace> = {}): NearbyPlace {
  return {
    coordinates: { lat: 27, lng: 85 },
    distance: 3200,
    name: "Pulchowk Campus",
    type: "college",
    ...overrides,
  };
}

describe("priceRange", () => {
  it("collapses an equal min and max to one number", () => {
    // Every hostel with a single room type has min === max, so without this the
    // common case reads "NPR 8,000 – 8,000" and looks broken.
    expect(priceRange({ monthlyRentMax: 8000, monthlyRentMin: 8000 })).toBe("NPR 8,000");
  });

  it("shows a real range", () => {
    expect(priceRange({ monthlyRentMax: 18000, monthlyRentMin: 10000 })).toBe(
      "NPR 10,000 – 18,000",
    );
  });

  it("copes with only one end published", () => {
    expect(priceRange({ monthlyRentMin: 7000 })).toBe("NPR 7,000");
    expect(priceRange({ monthlyRentMax: 7000 })).toBe("NPR 7,000");
  });

  it("says nothing rather than NPR 0 when there is no pricing", () => {
    expect(priceRange({})).toBe("—");
  });
});

describe("ratingDisplay", () => {
  it("calls an unreviewed hostel new, not zero stars", () => {
    // The averages are 0 for an unreviewed hostel. Branching on the average
    // renders it as one star, a visitor filters it out, and it never recovers.
    expect(ratingDisplay({
      averageRating: 0,
      cleanlinessRating: 0,
      foodRating: 0,
      safetyRating: 0,
      total: 0,
    })).toEqual({ kind: "new" });
  });

  it("rounds to one decimal place", () => {
    expect(
      ratingDisplay({
        averageRating: 4.5238095,
        cleanlinessRating: 4,
        foodRating: 4,
        safetyRating: 4,
        total: 21,
      }),
    ).toEqual({ count: 21, kind: "rated", value: "4.5" });
  });

  it("keeps a trailing zero so the column does not jitter", () => {
    expect(
      ratingDisplay({
        averageRating: 4,
        cleanlinessRating: 4,
        foodRating: 4,
        safetyRating: 4,
        total: 3,
      }),
    ).toMatchObject({ value: "4.0" });
  });

  it("treats a missing summary as new", () => {
    expect(ratingDisplay(undefined)).toEqual({ kind: "new" });
  });
});

describe("coverPhoto", () => {
  it("prefers the building over a bedroom", () => {
    const exterior = photo({ kind: "EXTERIOR", url: "https://x/ext.jpg" });

    expect(coverPhoto([photo(), exterior])).toBe(exterior);
  });

  it("falls back to any photo when nothing is tagged exterior", () => {
    const room = photo({ kind: "ROOM" });

    expect(coverPhoto([room])).toBe(room);
  });

  it("skips entries with no url", () => {
    const real = photo();

    expect(coverPhoto([photo({ kind: "EXTERIOR", url: "" }), real])).toBe(real);
  });

  it("returns null when there are no photos at all", () => {
    expect(coverPhoto([])).toBeNull();
  });
});

describe("formatDistance", () => {
  it("reads metres as metres and kilometres as kilometres", () => {
    // `nearbyPlaces[].distance` is metres — printing it raw gives "3200 km".
    expect(formatDistance(3200)).toBe("3.2 km");
    expect(formatDistance(450)).toBe("450 m");
  });

  it("rounds short distances to 50m rather than faking precision", () => {
    expect(formatDistance(437)).toBe("450 m");
  });

  it("handles the boundary and junk", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(-1)).toBe("—");
    expect(formatDistance(Number.NaN)).toBe("—");
  });
});

describe("campusDistanceLabel", () => {
  it("names the nearest college", () => {
    expect(campusDistanceLabel([place()])).toBe("3.2 km from Pulchowk Campus");
  });

  it("skips non-colleges even when they are closer", () => {
    // The list is sorted by distance, so the first entry is often a bus stop.
    expect(
      campusDistanceLabel([
        place({ distance: 200, name: "Gwarko Bus Park", type: "bus_stop" }),
        place(),
      ]),
    ).toBe("3.2 km from Pulchowk Campus");
  });

  it("returns null when nothing nearby is a college", () => {
    expect(campusDistanceLabel([place({ type: "hospital" })])).toBeNull();
    expect(campusDistanceLabel([])).toBeNull();
  });
});

describe("locationLabel", () => {
  it("joins area and city", () => {
    expect(locationLabel({ area: "Ghattekulo", city: "Kathmandu" })).toBe(
      "Ghattekulo, Kathmandu",
    );
  });

  it("does not repeat itself when the area is the city", () => {
    expect(locationLabel({ area: "Kathmandu", city: "Kathmandu" })).toBe("Kathmandu");
  });

  it("drops missing parts", () => {
    expect(locationLabel({ area: "Bafal" })).toBe("Bafal");
  });
});

describe("vacancyLabel", () => {
  it("reports a full hostel rather than hiding it", () => {
    // 0 is a real answer and the one a searcher most needs.
    expect(vacancyLabel({ vacantBeds: 0 })).toBe("0 beds vacant");
  });

  it("says nothing when capacity was never published", () => {
    expect(vacancyLabel({})).toBeNull();
  });

  it("reports a count", () => {
    expect(vacancyLabel({ vacantBeds: 54 })).toBe("54 beds vacant");
  });
});
