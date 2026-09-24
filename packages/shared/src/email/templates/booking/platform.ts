import { ctaButton, detailsTable, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { rupees } from "./parts";

/**
 * Mail to superadmins: work that HostelPalika has promised to do on time.
 */

/** A hostel crossed the strike limit and was paused automatically. */
export function hostelBookingsPausedEmail(input: {
  hostelName: string;
  reviewUrl: string;
  strikes: number;
  windowDays: number;
}): EmailContent {
  return {
    category: "alert",
    subject: `Bookings stopped — ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        paragraph(
          `${escapeHtml(input.hostelName)} missed or cancelled ${input.strikes} bookings in ${input.windowDays} days. Its Book button is off until a superadmin turns it on.`,
        ),
        ctaButton(input.reviewUrl, "Review hostel"),
      ].join(""),
      eyebrow: "Bookings",
      heading: "Hostel bookings stopped",
      preheader: `${input.hostelName}: ${input.strikes} strikes in ${input.windowDays} days.`,
    }),
  };
}

const HOSTEL_FAULT_COPY = {
  CANCELLED_BY_HOSTEL: { did: "cancelled this booking after confirming it", short: "cancelled" },
  DECLINED: { did: "declined this booking", short: "declined" },
  HOSTEL_NO_RESPONSE: { did: "did not answer this booking in time", short: "did not answer" },
};

export type HostelFaultCause = keyof typeof HOSTEL_FAULT_COPY;

/** A hostel declined, ignored or cancelled a paid booking: the guest's refund is ours to send. */
export function bookingHostelFaultRefundEmail(input: {
  cause: HostelFaultCause;
  code: string;
  guestName: string;
  hostelName: string;
  queueUrl: string;
  reason?: string | null;
  refund: number;
  refundTo: string;
  roomType: string;
}): EmailContent {
  const copy = HOSTEL_FAULT_COPY[input.cause];

  return {
    category: "alert",
    subject: `Refund to send — ${input.hostelName} ${copy.short} booking ${input.code}`,
    html: emailLayout({
      bodyHtml: [
        paragraph(`${escapeHtml(input.hostelName)} ${copy.did}. Check and send the refund.`),
        detailsTable([
          { label: "Booking", value: input.code },
          { label: "Guest", value: input.guestName },
          { label: "Hostel", value: input.hostelName },
          { label: "Room", value: input.roomType },
          { label: "Reason", value: input.reason ?? "" },
          { emphasis: true, label: "Refund", value: rupees(input.refund) },
          { label: "Refund to", value: input.refundTo },
        ]),
        ctaButton(input.queueUrl, "Send refund"),
      ].join(""),
      eyebrow: "Bookings",
      heading: "Refund to send",
      preheader: `${input.hostelName} ${copy.short} ${input.code}. Refund ${rupees(input.refund)} to ${input.guestName}.`,
    }),
  };
}

/** A booking screenshot waiting to be checked against money received. */
export function bookingProofToCheckEmail(input: {
  amount: number;
  checkBy: string;
  code: string;
  guestName: string;
  hostelName: string;
  queueUrl: string;
  reference?: string | null;
}): EmailContent {
  return {
    category: "alert",
    subject: `Booking payment to check — ${rupees(input.amount)} (${input.code})`,
    html: emailLayout({
      bodyHtml: [
        paragraph("A booking fee screenshot is waiting. Check it with our bank account."),
        detailsTable([
          { label: "Booking", value: input.code },
          { label: "Guest", value: input.guestName },
          { label: "Hostel", value: input.hostelName },
          { emphasis: true, label: "Amount", value: rupees(input.amount) },
          { label: "Their reference", value: input.reference ?? "" },
          { label: "Check by", value: input.checkBy },
        ]),
        ctaButton(input.queueUrl, "Check payment"),
      ].join(""),
      eyebrow: "Bookings",
      heading: "Booking payment to check",
      preheader: `${input.guestName} sent a screenshot for ${rupees(input.amount)} (${input.code}).`,
    }),
  };
}
