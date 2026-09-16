/**
 * The refund policy page's words — docs/BOOKINGS.md item 13. What would go
 * wrong quietly: a page promising a step the settings no longer have, or an
 * owner's `{feePercent}` printed as a literal brace.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BOOKING_CONFIG } from "@/modules/bookings/booking-config";
import { fillPolicyText, policyValues, refundPolicySections } from "@/modules/bookings/booking-policy";

describe("refund policy text", () => {
  it("prints every cancel step and the no-show share from the settings", () => {
    const hold = refundPolicySections(DEFAULT_BOOKING_CONFIG).find((section) => section.title === "After the hostel confirms");

    expect(hold?.body).toEqual([
      "One bed is held for you for 7 days, counted in 24-hour blocks from the moment the hostel confirms.",
      "Cancel on days 1–2 of the hold: 75% back.",
      "Cancel on days 3–5 of the hold: 50% back.",
      "Cancel on days 6–7 of the hold: 25% back.",
      "Not moved in when the hold ends: 0% back.",
      "When the hostel scans your ID card and admits you, the booking is complete and nothing is refunded.",
    ]);
  });

  it("follows a changed setting", () => {
    const sections = refundPolicySections({ ...DEFAULT_BOOKING_CONFIG, feePercent: 5, hostelAnswerHours: 12 });

    expect(sections[0]?.body[0]).toContain("5% of one month's rent");
    expect(sections[1]?.body[1]).toContain("within 12 hours");
  });

  it("fills an owner's own text and leaves unknown tokens visible", () => {
    expect(
      fillPolicyText("Fee {feePercent}, hold {holdDays}, {nonsense}.", policyValues(DEFAULT_BOOKING_CONFIG)),
    ).toBe("Fee 7%, hold 7 days, {nonsense}.");
  });
});
