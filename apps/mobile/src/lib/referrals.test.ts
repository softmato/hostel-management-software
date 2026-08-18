import { describe, expect, it } from "vitest";

import type { ReferralSummary } from "@/lib/referral-api";
import { parseReferralLink } from "@/lib/referral-link";
import {
  buildReferralShare,
  describeRewards,
  referralAppLink,
  referralShareUrl,
  referralStatusLabel,
  referralTiles,
} from "@/lib/referrals";

const EMPTY: ReferralSummary = {
  converted: 0,
  joined: 0,
  rewardApprovedAmount: 0,
  rewardPaidAmount: 0,
  sent: 0,
};

describe("referralAppLink", () => {
  it("builds the scheme `app/ref/[code].tsx` answers", () => {
    expect(referralAppLink("HH4K7M")).toBe("hostelhub://ref/HH4K7M");
  });

  /* The parser is the other half of the same contract, so they are checked together. */
  it("round-trips through the link parser", () => {
    expect(parseReferralLink(referralAppLink("HH4K7M"))).toBe("HH4K7M");
  });

  it("escapes a code that would otherwise break the path", () => {
    expect(referralAppLink("A B/C")).toBe("hostelhub://ref/A%20B%2FC");
  });
});

describe("referralShareUrl", () => {
  /*
   * `link` is stored relative so one row is correct on localhost, vercel.app and
   * a custom domain. A phone has no page origin, so resolving it is the client's
   * job — the same fix as `absoluteMediaUrl`.
   */
  it("resolves the stored relative link against the origin", () => {
    expect(referralShareUrl("/inquiry?ref=HH4K7M", "http://192.168.1.14:3000")).toBe(
      "http://192.168.1.14:3000/inquiry?ref=HH4K7M",
    );
  });

  it("does not double the slash", () => {
    expect(referralShareUrl("/inquiry?ref=X", "https://softmato.com/")).toBe(
      "https://softmato.com/inquiry?ref=X",
    );
    expect(referralShareUrl("inquiry?ref=X", "https://softmato.com")).toBe(
      "https://softmato.com/inquiry?ref=X",
    );
  });
});

describe("buildReferralShare", () => {
  /*
   * The reason this function exists. The server hands residents
   * `/inquiry?ref=<code>`, and `public-inquiry-page.tsx` reads only `hostel` and
   * `room` — so a friend following that link files an ordinary inquiry and the
   * referrer is never credited. Sending it would be shipping a silent no-op that
   * costs the resident a reward.
   */
  it("never sends the web link, which drops the referral", () => {
    const message = buildReferralShare({ code: "HH4K7M" });

    expect(message).not.toContain("?ref=");
    expect(message).not.toContain("/inquiry");
  });

  it("leads with the code, which is what actually credits a referral", () => {
    expect(buildReferralShare({ code: "HH4K7M" })).toContain("HH4K7M");
  });

  // Both paths that work today: the warden typing it at registration
  // (`linkReferralOnRegistration`) and `app/ref/[code].tsx` in this app.
  it("tells the friend both ways to use it", () => {
    const message = buildReferralShare({ code: "HH4K7M" });

    expect(message).toContain("register");
    expect(message).toContain("app");
  });

  it("names the hostel when it is known", () => {
    expect(buildReferralShare({ code: "X1Y2", hostelName: "Green View Hostel" })).toContain(
      "Green View Hostel",
    );
  });

  /*
   * The hostel is not always known — `app/ref/[code].tsx` documents that no public
   * endpoint maps a code to a hostel — so the copy must degrade rather than print
   * an empty gap or invent a name.
   */
  it("degrades to a neutral phrase rather than guessing one", () => {
    for (const name of [null, undefined, "   "]) {
      const message = buildReferralShare({ code: "X1Y2", hostelName: name });

      expect(message).toContain("my hostel");
      expect(message).not.toContain("  at .");
    }
  });
});

describe("referralStatusLabel", () => {
  /*
   * `humanizeEnum` would give "Inquiry created" — the database's view of the
   * event. The referrer's view is that their friend has been in touch.
   */
  it("speaks in the referrer's terms, not the schema's", () => {
    expect(referralStatusLabel("INQUIRY_CREATED")).toBe("Inquiry sent");
    expect(referralStatusLabel("JOINED")).toBe("Joined the hostel");
    expect(referralStatusLabel("REWARDED")).toBe("Rewarded");
    expect(referralStatusLabel("CANCELLED")).toBe("Cancelled");
  });

  it("passes through a status nobody has mapped", () => {
    expect(referralStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("describeRewards", () => {
  it("says nothing has been recorded, and who records it", () => {
    const line = describeRewards(EMPTY, 0);

    expect(line).toContain("No rewards recorded yet");
    expect(line).toContain("by hand");
  });

  /*
   * Approved and paid both count — the hostel has committed to both. `PENDING`
   * deliberately does not: an unapproved reward is a request, not an amount, and
   * counting it would have residents chasing money nobody agreed to.
   */
  it("adds approved and paid together", () => {
    const line = describeRewards(
      { ...EMPTY, rewardApprovedAmount: 500, rewardPaidAmount: 1500 },
      3,
    );

    expect(line).toContain("NPR 2,000");
    expect(line).toContain("3 referrals");
  });

  it("keeps the count singular for one referral", () => {
    expect(describeRewards({ ...EMPTY, rewardPaidAmount: 500 }, 1)).toContain(
      "1 referral",
    );
  });

  it("still reads as nothing when only cancelled rewards exist", () => {
    // Neither amount is populated by a cancelled reward, so this is the zero case.
    expect(describeRewards(EMPTY, 2)).toContain("No rewards recorded yet");
  });
});

describe("referralTiles", () => {
  it("keeps the web's three tiles, labels and hints", () => {
    const tiles = referralTiles({
      converted: 1,
      joined: 2,
      rewardApprovedAmount: 0,
      rewardPaidAmount: 0,
      sent: 5,
    });

    expect(tiles.map((tile) => tile.label)).toEqual(["Sent", "Joined", "Converted"]);
    expect(tiles.map((tile) => tile.value)).toEqual([5, 2, 1]);
    // The only number tied to real money says so, rather than reading as a
    // synonym for "joined".
    expect(tiles[2].hint).toBe("First payment verified");
  });
});
