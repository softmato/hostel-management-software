import { describe, expect, it } from "vitest";

import { buildHostelShare, hostelPublicUrl } from "@/lib/hostel-share";

describe("hostelPublicUrl", () => {
  it("points at the website's listing route", () => {
    expect(hostelPublicUrl("https://hostelhub.example", "green-view-hostel")).toBe(
      "https://hostelhub.example/hostels/green-view-hostel",
    );
  });

  it("strips a trailing slash rather than trusting the base", () => {
    // `API_BASE_URL` is `EXPO_PUBLIC_API_URL` in a release build and a LAN
    // address in development. A stray slash produces `//hostels/…`, which some
    // hosts redirect and others 404 — and this URL ends up in someone's chat.
    expect(hostelPublicUrl("https://hostelhub.example///", "a-hostel")).toBe(
      "https://hostelhub.example/hostels/a-hostel",
    );
  });

  it("encodes a slug rather than pasting it into the path", () => {
    expect(hostelPublicUrl("https://x.example", "a b/c")).toBe(
      "https://x.example/hostels/a%20b%2Fc",
    );
  });
});

describe("buildHostelShare", () => {
  const url = "https://hostelhub.example/hostels/green-view-hostel";

  it("leads with the three things that decide whether the link is tapped", () => {
    expect(
      buildHostelShare({
        name: "Green View Hostel",
        place: "Ghattekulo, Kathmandu",
        price: "NPR 7,000 – 9,000",
        url,
      }),
    ).toBe(
      "Green View Hostel\nGhattekulo, Kathmandu\nNPR 7,000 – 9,000 per month\n\n" + url,
    );
  });

  /**
   * `priceRange` returns an em dash for a hostel with no stated pricing. On a
   * card that reads as "not stated"; in a chat message "— per month" reads as a
   * bug, and "0 per month" would be worse — it would be a claim.
   */
  it("drops the price line when there is no price to state", () => {
    const message = buildHostelShare({
      name: "Green View Hostel",
      place: "Ghattekulo, Kathmandu",
      price: "—",
      url,
    });

    expect(message).toBe("Green View Hostel\nGhattekulo, Kathmandu\n\n" + url);
    expect(message).not.toContain("per month");
  });

  it("drops an empty price and an empty place alike", () => {
    expect(buildHostelShare({ name: "A Hostel", place: "", price: "  ", url })).toBe(
      "A Hostel\n\n" + url,
    );
  });

  it("always ends with the URL on its own line", () => {
    const message = buildHostelShare({
      name: "A",
      place: "B",
      price: "NPR 5,000",
      url,
    });

    expect(message.endsWith(`\n\n${url}`)).toBe(true);
  });
});
