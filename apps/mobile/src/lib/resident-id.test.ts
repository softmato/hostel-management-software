import { describe, expect, it } from "vitest";

import { normalizeResidentId, residentIdError } from "@/lib/resident-id";

/**
 * A mirror of the server's `normalizeResidentId`, so these cases are the
 * server's cases. Anything this accepts that the server rejects is a request
 * that fails after a round trip, and anything it rejects that the server would
 * have taken is a card that will not scan.
 */
describe("normalizeResidentId", () => {
  it("reads the share URL the card's QR actually encodes", () => {
    // The QR holds a link, not the id — the same PNG is printed for the web
    // flow, so it cannot be changed to carry the bare id.
    expect(normalizeResidentId("https://softmato.com/resident-id/HH-4K7M-9XQ2")).toBe(
      "HH-4K7M-9XQ2",
    );
  });

  it("ignores a tracking query rather than parsing it as the id", () => {
    // Splitting on `/` first would make the last segment `HH-4K7M-9XQ2?utm=qr`.
    expect(normalizeResidentId("https://softmato.com/resident-id/HH-4K7M-9XQ2?utm=qr")).toBe(
      "HH-4K7M-9XQ2",
    );
  });

  it("takes what a warden's thumbs produce", () => {
    expect(normalizeResidentId("hh 4k7m-9xq2")).toBe("HH-4K7M-9XQ2");
    expect(normalizeResidentId("HH4K7M9XQ2")).toBe("HH-4K7M-9XQ2");
  });

  it("refuses a QR that belongs to something else", () => {
    // `onBarcodeScanned` fires every frame, so this is what stops a bus ticket
    // held up to the lens becoming several lookups a second.
    expect(normalizeResidentId("WIFI:S=hostel;T=WPA;P=letmein;;")).toBeNull();
    expect(normalizeResidentId("https://softmato.com/resident-activation?code=AB12CD34")).toBeNull();
    expect(normalizeResidentId("")).toBeNull();
  });

  it("refuses an id of the wrong length", () => {
    expect(normalizeResidentId("HH-4K7M-9XQ")).toBeNull();
    expect(normalizeResidentId("HH-4K7M-9XQ23")).toBeNull();
  });
});

describe("residentIdError", () => {
  it("asks for the id before it complains about the format", () => {
    expect(residentIdError("  ")).toContain("Type the ID");
  });

  it("shows the shape rather than saying invalid", () => {
    expect(residentIdError("nonsense")).toContain("HH-4K7M-9XQ2");
  });

  it("passes a good id", () => {
    expect(residentIdError("hh4k7m9xq2")).toBeNull();
  });
});
