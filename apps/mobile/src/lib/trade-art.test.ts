import { describe, expect, it } from "vitest";

import { tradeArt, tradeArtUri } from "@/lib/trade-art";

const CATEGORIES = [
  "PLUMBING",
  "ELECTRICAL",
  "INTERNET",
  "CLEANING",
  "CARPENTRY",
  "PAINTING",
  "WATER",
  "APPLIANCE",
  "ROOM_REPAIR",
  "HEALTH",
  "OTHER",
];

describe("tradeArt", () => {
  it("gives every trade its own colour", () => {
    // The deck exists so the card under your thumb is recognised without
    // reading its label. Two trades sharing a tint would defeat that for the one
    // pair a hostel happens to use most.
    const tints = CATEGORIES.map((category) => tradeArt(category).tint);

    expect(new Set(tints).size).toBe(CATEGORIES.length);
  });

  it("falls back rather than handing back undefined colours", () => {
    // A category this build has not heard of must still draw. `undefined` in a
    // `backgroundColor` is a transparent card with black-on-nothing text.
    expect(tradeArt("TELEPATHY")).toEqual(tradeArt("OTHER"));
  });
});

describe("tradeArtUri", () => {
  it("builds a data URI expo-image can decode", () => {
    const uri = tradeArtUri("PLUMBING");

    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(uri.split(",")[1])).toContain("<svg");
  });

  it("percent-encodes, because a raw # would eat every colour", () => {
    // `#2563eb` inside an unencoded data URI is read as a fragment marker: the
    // browser and both native decoders truncate the document there, so the
    // drawing arrives with no fills at all.
    const uri = tradeArtUri("PLUMBING");

    expect(uri).not.toContain("#");
    expect(decodeURIComponent(uri)).toContain("#2563eb");
  });

  it("draws a different picture for every trade", () => {
    const drawings = CATEGORIES.map(tradeArtUri);

    expect(new Set(drawings).size).toBe(CATEGORIES.length);
  });

  it("puts a face on every one of them", () => {
    // The shared bust is what makes the set look like one set. If a trade ever
    // loses it, the deck has a card that is a floating tool.
    for (const category of CATEGORIES) {
      const svg = decodeURIComponent(tradeArtUri(category));

      expect(svg).toContain('<circle cx="48" cy="48" r="17"');
    }
  });

  it("closes every element it opens", () => {
    // Hand-written SVG strings, so a stray unclosed tag is a real risk and
    // renders as a blank square on device with no error anywhere.
    for (const category of CATEGORIES) {
      const svg = decodeURIComponent(tradeArtUri(category));
      const opened = (svg.match(/<[a-zA-Z]/g) ?? []).length;
      const closed =
        (svg.match(/\/>/g) ?? []).length + (svg.match(/<\/[a-zA-Z]/g) ?? []).length;

      expect(closed).toBe(opened);
    }
  });
});
