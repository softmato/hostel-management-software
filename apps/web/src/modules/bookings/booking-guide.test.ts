/**
 * How booking works, as words — docs/BOOKINGS.md item 33. What would go wrong
 * quietly: the page telling people a hostel has 24 hours to answer after a
 * superadmin cut it to 12, or a hostel reading a share it is not paid.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BOOKING_CONFIG } from "@/modules/bookings/booking-config";
import { bookingGuideSections } from "@/modules/bookings/booking-guide";

const section = (config: typeof DEFAULT_BOOKING_CONFIG, title: string) =>
  bookingGuideSections(config).find((entry) => entry.title === title);

describe("how booking works", () => {
  it("walks the flow in order, with every deadline from the settings", () => {
    expect(section(DEFAULT_BOOKING_CONFIG, "Step by step")?.body).toEqual([
      "Pick the room type and book. We raise your invoice straight away and email it to you.",
      "Pay the fee to our collection QR and send the screenshot. A booking with no screenshot closes after 24 hours, and it owes nothing and holds nothing.",
      "We check the screenshot within 24 hours and email you the receipt. If something is wrong with it we say why, and you can send another.",
      "The hostel then has 24 hours to confirm or decline. We tell you either way.",
      "Once it confirms, one bed is held for you for 7 days, counted in 24-hour blocks from that moment.",
      "Move in inside that window. The hostel scans your HostelPalika ID card, the held bed becomes yours, and the booking is finished.",
    ]);
  });

  it("follows changed settings", () => {
    const changed = {
      ...DEFAULT_BOOKING_CONFIG,
      feePercent: 5,
      holdDays: 3,
      hostelAnswerHours: 12,
      hostelSharePercent: 70,
      moveInReminderHoursLeft: [24, 2],
      strikeLimit: 2,
      // The ladder has to keep ending on the last day of the shortened hold.
      cancelSteps: [{ refundPercent: 50, throughDay: 3 }],
    };

    expect(section(changed, "What a booking is")?.body[1]).toContain("5% of one month's rent");
    expect(section(changed, "The deadlines")?.body[2]).toContain("within 12 hours");
    expect(section(changed, "The deadlines")?.body[3]).toBe(
      "The bed is held for 3 days from the moment the hostel confirms, and we remind you 24 hours and 2 hours before the hold runs out.",
    );

    const hostel = section(changed, "If you run a hostel")?.body ?? [];

    expect(hostel[3]).toContain("70% to the hostel");
    expect(hostel[4]).toContain("2 of them inside 30 days");
  });

  it("leaves the refund figures to the refund policy", () => {
    const words = bookingGuideSections(DEFAULT_BOOKING_CONFIG)
      .flatMap((entry) => entry.body)
      .join(" ");

    expect(words).not.toContain("75%");
    expect(words).toContain("the refund policy");
  });
});
