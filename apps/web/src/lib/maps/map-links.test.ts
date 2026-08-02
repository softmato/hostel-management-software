import { describe, expect, it } from "vitest";

import { parseMapLink } from "./map-links";

describe("parseMapLink", () => {
  it("prefers the marker position over the viewport centre", () => {
    // `@` is where the map happened to be looking; `!3d!4d` is the place.
    const parsed = parseMapLink(
      "https://www.google.com/maps/place/Narephat/@27.6800,85.3500,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d27.6812!4d85.3527",
    );

    expect(parsed).toEqual({
      coordinates: { lat: 27.6812, lng: 85.3527 },
      kind: "coordinates",
      label: "Narephat",
    });
  });

  it("falls back to the viewport centre when there is no marker", () => {
    expect(parseMapLink("https://www.google.com/maps/@27.7172,85.324,15z")).toEqual({
      coordinates: { lat: 27.7172, lng: 85.324 },
      kind: "coordinates",
    });
  });

  it("reads the Maps URL API query parameter", () => {
    expect(
      parseMapLink("https://www.google.com/maps/search/?api=1&query=27.6935,85.3419"),
    ).toEqual({ coordinates: { lat: 27.6935, lng: 85.3419 }, kind: "coordinates" });
  });

  it("defers short links to the server, which can follow the redirect", () => {
    expect(parseMapLink("https://maps.app.goo.gl/aBcDeF123")).toEqual({
      kind: "shortLink",
      url: "https://maps.app.goo.gl/aBcDeF123",
    });
  });

  it("reads an OpenStreetMap permalink", () => {
    expect(
      parseMapLink(
        "https://www.openstreetmap.org/?mlat=27.6812&mlon=85.3527#map=19/27.68/85.35",
      ),
    ).toEqual({ coordinates: { lat: 27.6812, lng: 85.3527 }, kind: "coordinates" });
  });

  it("accepts a coordinate pair copied straight out of a map", () => {
    expect(parseMapLink("27.7172, 85.3240")).toEqual({
      coordinates: { lat: 27.7172, lng: 85.324 },
      kind: "coordinates",
    });
  });

  it("returns the place name when a link carries no coordinates", () => {
    expect(
      parseMapLink("https://www.google.com/maps/place/New+Baneshwor,+Kathmandu"),
    ).toEqual({
      kind: "place",
      query: "New Baneshwor, Kathmandu",
    });
  });

  it("leaves ordinary searches alone", () => {
    expect(parseMapLink("Royal Rapti Boys Hostel")).toBeNull();
    expect(parseMapLink("Narephat, Kathmandu")).toBeNull();
    expect(parseMapLink("   ")).toBeNull();
  });

  it("rejects out-of-range and Null Island pairs", () => {
    // "Ward 10, 5" is an address fragment, not a location.
    expect(parseMapLink("0, 0")).toBeNull();
    expect(parseMapLink("95.1, 200.4")).toBeNull();
  });
});
