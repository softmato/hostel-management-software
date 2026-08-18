import { describe, expect, it } from "vitest";

import type { PublicHostel } from "@/lib/public-api";
import { refreshedSnapshots, savedSnapshot } from "@/lib/saved-hostels";

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
    name: "Sagarmatha Boys",
    nearbyPlaces: [],
    photos: [],
    pricing: { monthlyRentMax: 9000, monthlyRentMin: 7000 },
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
    slug: "sagarmatha-boys",
    verificationStatus: "VERIFIED",
    ...overrides,
  } as PublicHostel;
}

function photo(overrides: Partial<PublicHostel["photos"][number]> = {}) {
  return {
    alt: "",
    kind: "EXTERIOR" as const,
    roomType: "",
    url: "/api/v1/files/abc/url",
    ...overrides,
  };
}

describe("savedSnapshot", () => {
  it("carries the strings the card draws, so the row works with no payload", () => {
    expect(savedSnapshot(hostel({ photos: [photo()] }), 1_700_000_000_000)).toEqual({
      coverUrl: "/api/v1/files/abc/url",
      id: "1",
      name: "Sagarmatha Boys",
      place: "Ghattekulo, Kathmandu",
      price: "NPR 7,000 – 9,000",
      savedAt: 1_700_000_000_000,
      slug: "sagarmatha-boys",
    });
  });

  it("stores the photo URL unresolved — the base is a LAN address in dev", () => {
    const snapshot = savedSnapshot(hostel({ photos: [photo()] }));

    expect(snapshot.coverUrl).toBe("/api/v1/files/abc/url");
  });

  it("keeps a null cover rather than inventing one for a photoless hostel", () => {
    expect(savedSnapshot(hostel()).coverUrl).toBeNull();
  });

  it("prefers the exterior shot, as the cards do", () => {
    const snapshot = savedSnapshot(
      hostel({
        photos: [
          photo({ kind: "ROOM", url: "/room.jpg" }),
          photo({ kind: "EXTERIOR", url: "/outside.jpg" }),
        ],
      }),
    );

    expect(snapshot.coverUrl).toBe("/outside.jpg");
  });
});

describe("refreshedSnapshots", () => {
  it("returns null when nothing moved, so no write and no re-render", () => {
    const items = [savedSnapshot(hostel())];

    expect(refreshedSnapshots(items, [hostel()])).toBeNull();
  });

  it("returns null for an empty saved list or an empty payload", () => {
    expect(refreshedSnapshots([], [hostel()])).toBeNull();
    expect(refreshedSnapshots([savedSnapshot(hostel())], [])).toBeNull();
  });

  it("folds in a new price and keeps savedAt, so the order does not shuffle", () => {
    const items = [savedSnapshot(hostel(), 500)];

    const next = refreshedSnapshots(items, [
      hostel({ pricing: { monthlyRentMax: 12_000, monthlyRentMin: 12_000 } }),
    ]);

    expect(next).toEqual([{ ...items[0], price: "NPR 12,000", savedAt: 500 }]);
  });

  it("keeps a hostel that is missing from the payload", () => {
    // Outside the server's first-60 window, filtered out, or delisted. The user
    // saved it; dropping it silently is the one thing this must not do.
    const gone = savedSnapshot(hostel({ id: "gone", name: "Delisted House" }), 1);
    const present = savedSnapshot(hostel({ id: "here" }), 2);

    const next = refreshedSnapshots(
      [gone, present],
      [hostel({ id: "here", name: "Renamed" })],
    );

    expect(next).toHaveLength(2);
    expect(next?.[0]).toBe(gone);
    expect(next?.[1].name).toBe("Renamed");
  });

  it("refreshes only the entries that changed", () => {
    const stale = savedSnapshot(hostel({ id: "1" }), 1);
    const fresh = savedSnapshot(hostel({ id: "2", name: "Annapurna" }), 2);

    const next = refreshedSnapshots(
      [stale, fresh],
      [hostel({ id: "1", name: "Sagarmatha Boys Hostel" }), hostel({ id: "2", name: "Annapurna" })],
    );

    expect(next?.[0].name).toBe("Sagarmatha Boys Hostel");
    // Untouched entries keep their identity, not just their value.
    expect(next?.[1]).toBe(fresh);
  });
});
