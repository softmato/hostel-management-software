import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

import type { BookingConfig } from "@/modules/bookings/booking-config";
import { daysText, hoursText, type PolicySection } from "@/modules/bookings/booking-policy";

/**
 * How a room booking works, in order, from the live booking settings.
 *
 * docs/BOOKINGS.md item 33. It exists because the alternative is explaining the
 * same sequence four times — on the checkout, on My bookings, on the hostel's
 * Bookings screen and in the emails — and having those four copies drift apart
 * the first time a superadmin changes an hour. The screens keep one line and a
 * link here.
 *
 * Pure and shared: the website page, the app screen (through
 * `GET /api/v1/bookings/guide`) and the test read the same sentences. It stops
 * at the door of the refund policy — how much money comes back and when is that
 * page's job, and saying it twice is how two answers start existing.
 */

type GuideTerms = Pick<
  BookingConfig,
  | "feePercent"
  | "holdDays"
  | "hostelAnswerHours"
  | "hostelSharePercent"
  | "moveInReminderHoursLeft"
  | "paymentCheckHours"
  | "strikeLimit"
  | "strikeWindowDays"
  | "unpaidWindowHours"
>;

export function bookingGuideIntro(): string[] {
  return [
    `Booking a room on ${PLATFORM_NAME} holds one bed for you at a real hostel while you get there. This page is the whole process: what you pay, who decides what, and every deadline on the way.`,
    "How much money comes back if a booking ends early is set out in the refund policy.",
  ];
}

/** The move-in reminder, worded from however many the superadmin set. */
function moveInReminder(terms: GuideTerms) {
  const reminders = [...terms.moveInReminderHoursLeft].sort((a, b) => b - a);

  if (reminders.length === 0) {
    return `The bed is held for ${daysText(terms.holdDays)} from the moment the hostel confirms.`;
  }

  return `The bed is held for ${daysText(terms.holdDays)} from the moment the hostel confirms, and we remind you ${reminders
    .map((value) => hoursText(value))
    .join(" and ")} before the hold runs out.`;
}

export function bookingGuideSections(terms: GuideTerms): PolicySection[] {
  return [
    {
      body: [
        `You pay a booking fee to ${PLATFORM_NAME}, not to the hostel, and we ask the hostel to hold one bed of that room type for you.`,
        `The fee is ${terms.feePercent}% of one month's rent for that room type. You see the exact amount in rupees before you pay anything.`,
        "It is not rent, admission fee or deposit. The hostel charges those in the ordinary way when you move in.",
        "One booking at a time: finish or cancel the one you have before you start another.",
      ],
      icon: "bed",
      title: "What a booking is",
    },
    {
      body: [
        "The hostel has to be live here, taking bookings, and have a free bed of the room type you want. If it does not, the Book button says so instead of taking your money.",
        "You sign in with your own account and it needs an email address: the invoice, the receipt and every step below are emailed to you.",
        "You give the eSewa, Khalti or bank account a refund should go to, and accept the refund policy.",
        "Someone already living at a hostel cannot book a bed at that same hostel.",
      ],
      icon: "user-check",
      title: "Before you can book",
    },
    {
      body: [
        "Pick the room type and book. We raise your invoice straight away and email it to you.",
        `Pay the fee to our collection QR and send the screenshot. A booking with no screenshot closes after ${hoursText(terms.unpaidWindowHours)}, and it owes nothing and holds nothing.`,
        `We check the screenshot within ${hoursText(terms.paymentCheckHours)} and email you the receipt. If something is wrong with it we say why, and you can send another.`,
        `The hostel then has ${hoursText(terms.hostelAnswerHours)} to confirm or decline. We tell you either way.`,
        `Once it confirms, one bed is held for you for ${daysText(terms.holdDays)}, counted in 24-hour blocks from that moment.`,
        `Move in inside that window. The hostel scans your ${PLATFORM_NAME} ID card, the held bed becomes yours, and the booking is finished.`,
      ],
      icon: "receipt",
      title: "Step by step",
    },
    {
      body: [
        `Send your screenshot within ${hoursText(terms.unpaidWindowHours)} of booking.`,
        `We answer it within ${hoursText(terms.paymentCheckHours)}.`,
        `The hostel answers within ${hoursText(terms.hostelAnswerHours)} of our check. If it never answers, the booking ends and you get the whole fee back.`,
        moveInReminder(terms),
        "If you have not moved in when the hold ends, the booking ends as a no-show and the bed goes back to the hostel.",
      ],
      icon: "alert-triangle",
      title: "The deadlines",
    },
    {
      body: [
        "Cancel from My bookings whenever you like. The screen shows exactly what comes back before you press anything.",
        "Cancel before the hostel confirms and the whole fee comes back.",
        "After it confirms, what comes back depends on which day of the hold you cancel on. The refund policy lists every step.",
        "Refunds go to the account you gave when you booked. We send them by hand and email you the amount and the transaction ID.",
      ],
      icon: "credit-card",
      title: "Changing your mind",
    },
    {
      body: [
        `The Book button appears on your listing once bookings are switched on, your listing is live and the account we pay you into is verified. Add it under Bookings ${"→"} Settings; we check it before any payout.`,
        `Every request waits for you under Bookings. You have ${hoursText(terms.hostelAnswerHours)} from our payment check to confirm or decline, and we remind you before it runs out.`,
        `Confirming holds one bed of that room type for ${daysText(terms.holdDays)}. Admit the person the normal way, by scanning their ID card in Register a new resident, and the held bed becomes theirs.`,
        `Whatever is not refunded is shared: ${terms.hostelSharePercent}% to the hostel, the rest to ${PLATFORM_NAME}. We send your share by hand and email a payout advice with the transaction ID.`,
        `Missing an answer, or cancelling a booking you had confirmed, counts as a missed booking. ${terms.strikeLimit} of them inside ${daysText(terms.strikeWindowDays)} pauses the Book button on your hostel until we turn it back on.`,
        "Declining a request in time costs you nothing.",
      ],
      icon: "building",
      title: "If you run a hostel",
    },
  ];
}
