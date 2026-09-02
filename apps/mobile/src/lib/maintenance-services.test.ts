import { describe, expect, it } from "vitest";

import {
  chargeNote,
  minimumChargeFor,
  searchServices,
  titleForRequest,
} from "@/lib/maintenance-services";

/**
 * The distinction every case here is really about: a trade with **no agreed
 * charge** and a trade whose charge is **zero** are different answers, and
 * collapsing them puts `NPR 0` on the confirm step for every trade a hostel has
 * not priced yet.
 */
describe("minimumChargeFor", () => {
  const charges = [
    { amount: 800, category: "PLUMBING" },
    { amount: 0, category: "CLEANING" },
  ];

  it("finds the agreed floor for a trade", () => {
    expect(minimumChargeFor(charges, "PLUMBING")).toBe(800);
  });

  it("keeps a deliberate zero distinct from an absent rate", () => {
    // A hostel with its own handyman genuinely charges nothing for cleaning.
    expect(minimumChargeFor(charges, "CLEANING")).toBe(0);
    expect(minimumChargeFor(charges, "ELECTRICAL")).toBeNull();
  });

  it("answers null when no trade is chosen yet", () => {
    expect(minimumChargeFor(charges, null)).toBeNull();
  });
});

describe("chargeNote", () => {
  it("says three different things for three different states", () => {
    expect(chargeNote(null)).toMatch(/no agreed/i);
    expect(chargeNote(0)).toBe("No call-out charge");
    expect(chargeNote(1200)).toBe("From NPR 1,200");
  });
});

describe("searchServices", () => {
  const categories = ["PLUMBING", "ELECTRICAL", "ROOM_REPAIR"];

  it("matches the name on the card, not the enum", () => {
    // The card says `Room repair`; nobody types an underscore.
    expect(searchServices(categories, "room rep")).toEqual(["ROOM_REPAIR"]);
    expect(searchServices(categories, "ELEC")).toEqual(["ELECTRICAL"]);
  });

  it("returns everything for an empty query", () => {
    // The deck is the sheet's default state. A search box that empties it when
    // cleared is a search box that has eaten the screen.
    expect(searchServices(categories, "   ")).toEqual(categories);
  });

  it("returns nothing rather than everything for a word that matches none", () => {
    expect(searchServices(categories, "telepathy")).toEqual([]);
  });
});

describe("titleForRequest", () => {
  it("uses the typed sentence when there is one", () => {
    expect(titleForRequest("Tap in 204 is leaking", "PLUMBING")).toBe(
      "Tap in 204 is leaking",
    );
  });

  it("names a spoken-only request after its trade", () => {
    // The sheet defaults to a recording, so a valid request can carry no typed
    // words at all — and `title` is required by the server and is the line a
    // provider reads in their job list.
    expect(titleForRequest("", "PLUMBING")).toBe("Plumbing job");
    expect(titleForRequest("   ", "ROOM_REPAIR")).toBe("Room repair job");
    expect(titleForRequest("", null)).toBe("Other job");
  });

  it("takes the first line only, and trims a very long one", () => {
    expect(titleForRequest("Leaking tap\nsince Tuesday", "PLUMBING")).toBe(
      "Leaking tap",
    );
    expect(titleForRequest("x".repeat(400), "PLUMBING")).toHaveLength(180);
  });
});
