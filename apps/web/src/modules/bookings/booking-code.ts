import { createHash, randomInt } from "node:crypto";

import type { BookingTerms } from "@/modules/bookings/booking-terms";

/**
 * No 0/O and no 1/I: the code is read off a screen and typed into a banking
 * app's remarks box, often on a phone keyboard.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** `BK-7F3K2Q` — 32^6, about a billion, and a unique index catches the rest. */
export function newBookingCode(length = 6) {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }

  return `BK-${code}`;
}

/**
 * Which refund policy a person accepted.
 *
 * A digest of the terms that decide their money plus the policy text override
 * and its date. The checkout sends back the version it showed; if the terms or
 * the text moved while the page was open, the versions differ and the booking
 * is refused until the new policy has been shown and accepted.
 */
export function bookingPolicyVersion(
  terms: BookingTerms,
  policy: { body: string; updatedAt: string },
) {
  const material = JSON.stringify({
    body: createHash("sha256").update(policy.body).digest("hex"),
    cancelSteps: terms.cancelSteps.map((step) => [step.throughDay, step.refundPercent]),
    feePercent: terms.feePercent,
    holdDays: terms.holdDays,
    hostelAnswerHours: terms.hostelAnswerHours,
    noShowRefundPercent: terms.noShowRefundPercent,
    updatedAt: policy.updatedAt,
  });

  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
