import { PLATFORM_NAME } from "../../../brand/brand";
import {
  ctaButton,
  detailsTable,
  emailLayout,
  escapeHtml,
  greeting,
  paragraph,
  smallPrint,
  textLink,
  type EmailContent,
} from "../layout";
import {
  bookingFactsTable,
  hoursWord,
  refundLadderTable,
  rupees,
  type BookingFacts,
  type RefundLadderRow,
} from "./parts";

/**
 * Mail to the person who booked a room.
 *
 * Every message states the booking back — code, hostel, room, fee — so it can
 * be checked by the one person who can catch a wrong figure, and ends with one
 * button to the booking page, which always shows the live state. Nothing here
 * promises what the platform cannot keep: times are exact and in Nepal time.
 */

type GuestBase = {
  booking: BookingFacts;
  bookingUrl: string;
  name?: string | null;
};

/** Sent when the booking is created: the invoice and how to pay it. */
export function bookingInvoiceEmail(
  input: GuestBase & {
    hostelAnswerHours: number;
    invoiceNumber: string;
    noShowRefund: number;
    payBy: string;
    paymentCheckHours: number;
    policyUrl: string;
    refundRows: RefundLadderRow[];
  },
): EmailContent {
  return {
    category: "billing",
    subject: `Booking invoice ${input.invoiceNumber} — ${rupees(input.booking.fee)} for ${input.booking.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `Your booking at <strong>${escapeHtml(input.booking.hostelName)}</strong> is waiting for payment.`,
        ),
        bookingFactsTable(input.booking, [
          { label: "Invoice", value: input.invoiceNumber },
          { label: "Pay by", value: input.payBy },
        ]),
        paragraph(
          `Open your booking, scan the ${PLATFORM_NAME} QR, pay <strong>${rupees(input.booking.fee)}</strong> and write <strong>${escapeHtml(input.booking.code)}</strong> in the remarks. Then upload the payment screenshot.`,
        ),
        ctaButton(input.bookingUrl, "Pay booking fee"),
        paragraph(
          `We check the screenshot within ${input.paymentCheckHours} hours. The hostel then has ${input.hostelAnswerHours} hours to confirm your bed.`,
        ),
        paragraph("<strong>Refunds</strong>"),
        refundLadderTable({
          fee: input.booking.fee,
          noShowRefund: input.noShowRefund,
          rows: input.refundRows,
        }),
        smallPrint(`Full refund policy: ${textLink(input.policyUrl, "read it here")}.`),
      ].join(""),
      eyebrow: "Invoice",
      heading: "Pay your booking fee",
      preheader: `Pay ${rupees(input.booking.fee)} with code ${input.booking.code} to book ${input.booking.roomType} at ${input.booking.hostelName}.`,
    }),
  };
}

/** Sent when the screenshot arrives. Nothing is confirmed yet. */
export function bookingProofReceivedEmail(
  input: GuestBase & { checkBy: string; reference?: string | null },
): EmailContent {
  return {
    category: "billing",
    subject: `We have your payment screenshot — booking ${input.booking.code}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph("We have your payment screenshot and are checking it."),
        bookingFactsTable(input.booking, [
          { label: "Your reference", value: input.reference ?? "" },
          { label: "Checked by", value: input.checkBy },
        ]),
        paragraph("We will email you as soon as it is checked, whether or not it matches."),
        ctaButton(input.bookingUrl, "View booking"),
      ].join(""),
      eyebrow: "Payment",
      heading: "Payment screenshot received",
      preheader: `We are checking your ${rupees(input.booking.fee)} payment for booking ${input.booking.code}.`,
    }),
  };
}

/** Sent when a screenshot could not be matched. The booking waits for another. */
export function bookingPaymentRejectedEmail(
  input: GuestBase & { payBy: string; reason: string },
): EmailContent {
  return {
    category: "billing",
    subject: `We could not confirm your payment — booking ${input.booking.code}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph("We could not match your screenshot to a payment we received."),
        detailsTable([{ label: "Reason", value: input.reason }]),
        bookingFactsTable(input.booking, [{ label: "Send again by", value: input.payBy }]),
        paragraph(
          "If you have paid, send the screenshot from your banking app again. If you have not, pay first.",
        ),
        ctaButton(input.bookingUrl, "Send screenshot again"),
      ].join(""),
      eyebrow: "Action needed",
      heading: "Payment not confirmed",
      preheader: `Your screenshot for booking ${input.booking.code} could not be matched: ${input.reason}`,
      urgent: true,
    }),
  };
}

/** Sent when the hostel confirms: the bed is held, where to go, what cancelling costs from here. */
export function bookingConfirmedEmail(
  input: GuestBase & {
    address?: string | null;
    directionsUrl?: string | null;
    holdEndsAt: string;
    hostelPhone?: string | null;
    landmark?: string | null;
    noShowRefund: number;
    schedule: Array<{ refund: number; refundPercent: number; until: string }>;
  },
): EmailContent {
  return {
    category: "billing",
    subject: `${input.booking.hostelName} confirmed your booking — move in by ${input.holdEndsAt}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `<strong>${escapeHtml(input.booking.hostelName)}</strong> confirmed your booking. One ${escapeHtml(input.booking.roomType)} bed is held for you until <strong>${escapeHtml(input.holdEndsAt)}</strong>.`,
        ),
        detailsTable([
          { label: "Booking", value: input.booking.code },
          { label: "Room type", value: input.booking.roomType },
          { label: "Monthly rent", value: rupees(input.booking.monthlyRent) },
          { emphasis: true, label: "Move in by", value: input.holdEndsAt },
          { label: "Address", value: input.address ?? "" },
          { label: "Landmark", value: input.landmark ?? "" },
          { label: "Hostel phone", value: input.hostelPhone ?? "" },
        ]),
        input.directionsUrl ? ctaButton(input.directionsUrl, "Get directions") : "",
        paragraph(
          `At the hostel, show your ${PLATFORM_NAME} ID card. The hostel scans it to admit you, and that completes the booking.`,
        ),
        paragraph("<strong>If you cancel</strong>"),
        detailsTable([
          ...input.schedule.map((step) => ({
            label: `Cancel before ${step.until}`,
            value: `${rupees(step.refund)} back (${step.refundPercent}%)`,
          })),
          { label: `Not moved in by ${input.holdEndsAt}`, value: `${rupees(input.noShowRefund)} back` },
        ]),
        smallPrint(
          `The booking fee does not count towards rent, admission fee or deposit. Those are paid to the hostel. ${textLink(input.bookingUrl, "View booking")}.`,
        ),
      ].join(""),
      eyebrow: "Confirmed",
      heading: "Your bed is held",
      preheader: `One ${input.booking.roomType} bed at ${input.booking.hostelName} is held until ${input.holdEndsAt}.`,
    }),
  };
}

/** The hold is running out and nobody has scanned the person's card yet. */
export function bookingMoveInReminderEmail(
  input: GuestBase & {
    address?: string | null;
    directionsUrl?: string | null;
    holdEndsAt: string;
    hostelPhone?: string | null;
    hoursLeft: number;
    noShowRefund: number;
  },
): EmailContent {
  return {
    category: "billing",
    subject: `Move in by ${input.holdEndsAt} — booking ${input.booking.code}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(
          `Your bed at <strong>${escapeHtml(input.booking.hostelName)}</strong> is held until <strong>${escapeHtml(input.holdEndsAt)}</strong>, less than ${hoursWord(input.hoursLeft)} from now.`,
        ),
        detailsTable([
          { label: "Booking", value: input.booking.code },
          { label: "Room type", value: input.booking.roomType },
          { emphasis: true, label: "Move in by", value: input.holdEndsAt },
          { label: "Address", value: input.address ?? "" },
          { label: "Hostel phone", value: input.hostelPhone ?? "" },
        ]),
        ctaButton(input.directionsUrl || input.bookingUrl, input.directionsUrl ? "Get directions" : "View booking"),
        paragraph(
          `Show your ${PLATFORM_NAME} ID card at the hostel. If you have not moved in by then, the bed is released and ${
            input.noShowRefund > 0
              ? `${rupees(input.noShowRefund)} of the booking fee comes back`
              : "the booking fee is not refunded"
          }.`,
        ),
        smallPrint(`Plans changed? Cancelling before then returns more. ${textLink(input.bookingUrl, "View booking")}.`),
      ].join(""),
      eyebrow: "Reminder",
      heading: "Time to move in",
      preheader: `Move in at ${input.booking.hostelName} by ${input.holdEndsAt}.`,
      urgent: true,
    }),
  };
}

/** The refund has left our account. */
export function bookingRefundSentEmail(
  input: GuestBase & {
    amount: number;
    documentNumber?: string | null;
    refundTo: string;
    sentOn: string;
    transactionId: string;
  },
): EmailContent {
  return {
    category: "billing",
    subject: `Refund sent — ${rupees(input.amount)} for booking ${input.booking.code}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph("We sent your refund."),
        detailsTable([
          { emphasis: true, label: "Refund", value: rupees(input.amount) },
          { label: "Sent to", value: input.refundTo },
          { label: "Sent on", value: input.sentOn },
          { label: "Transaction ID", value: input.transactionId },
          { label: "Refund note", value: input.documentNumber ?? "" },
          { label: "Booking", value: input.booking.code },
          { label: "Hostel", value: input.booking.hostelName },
        ]),
        paragraph(
          "Your bank or wallet may take a while to show it. If it has not arrived, contact us with the transaction ID above.",
        ),
        ctaButton(input.bookingUrl, "View booking"),
      ].join(""),
      eyebrow: "Refund",
      heading: "Refund sent",
      preheader: `${rupees(input.amount)} sent to ${input.refundTo}. Transaction ${input.transactionId}.`,
    }),
  };
}

/** How a booking ended, as the person who booked is told it. */
export type BookingEndCause =
  | "CANCELLED_BEFORE_CONFIRMATION"
  | "CANCELLED_BY_USER"
  | "DECLINED"
  | "HOSTEL_NO_RESPONSE"
  | "CANCELLED_BY_HOSTEL"
  | "CANCELLED_BY_PLATFORM"
  | "NO_SHOW"
  | "EXPIRED";

const ENDED_COPY: Record<BookingEndCause, { heading: string; line: (hostel: string) => string }> = {
  CANCELLED_BEFORE_CONFIRMATION: {
    heading: "Booking cancelled",
    line: () => "You cancelled this booking before the hostel confirmed it.",
  },
  CANCELLED_BY_HOSTEL: {
    heading: "The hostel cancelled your booking",
    line: (hostel) => `${hostel} cancelled your booking.`,
  },
  CANCELLED_BY_PLATFORM: {
    heading: `Booking cancelled by ${PLATFORM_NAME}`,
    line: () => `${PLATFORM_NAME} cancelled this booking.`,
  },
  CANCELLED_BY_USER: {
    heading: "Booking cancelled",
    line: () => "You cancelled this booking. The bed held for you is released.",
  },
  DECLINED: {
    heading: "The hostel declined your booking",
    line: (hostel) => `${hostel} declined your booking.`,
  },
  EXPIRED: {
    heading: "Booking closed",
    line: () => "No payment screenshot arrived in time, so this booking is closed.",
  },
  HOSTEL_NO_RESPONSE: {
    heading: "The hostel did not answer",
    line: (hostel) => `${hostel} did not answer your booking in time, so it is cancelled.`,
  },
  NO_SHOW: {
    heading: "Your booking has ended",
    line: () => "The time to move in has passed, so the bed held for you is released.",
  },
};

/** Sent on every ending: what happened, and exactly what comes back. */
export function bookingEndedEmail(
  input: GuestBase & {
    cause: BookingEndCause;
    /** False when nothing was ever paid — there is no money to talk about. */
    paid: boolean;
    reason?: string | null;
    refund: number;
    refundPercent: number;
    /** `eSewa ••••4321 (Sita Sharma)`. */
    refundTo: string;
  },
): EmailContent {
  const copy = ENDED_COPY[input.cause];
  const hostel = escapeHtml(input.booking.hostelName);
  const money = !input.paid
    ? paragraph("Nothing was paid, so nothing is owed.")
    : input.refund > 0
      ? [
          detailsTable([
            { emphasis: true, label: "Refund", value: `${rupees(input.refund)} (${input.refundPercent}%)` },
            { label: "Refund to", value: input.refundTo },
          ]),
          paragraph(
            "We send the refund to the account above and email you the transaction ID once it is sent.",
          ),
        ].join("")
      : paragraph("No refund is due under the refund policy you accepted.");

  return {
    category: "billing",
    subject: `${copy.heading} — booking ${input.booking.code}`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(copy.line(hostel)),
        bookingFactsTable(input.booking, [{ label: "Reason", value: input.reason ?? "" }], null),
        money,
        ctaButton(input.bookingUrl, "View booking"),
      ].join(""),
      eyebrow: input.paid && input.refund > 0 ? "Refund" : "Booking",
      heading: copy.heading,
      preheader:
        input.paid && input.refund > 0
          ? `${rupees(input.refund)} of your booking fee is coming back to ${input.refundTo}.`
          : `Booking ${input.booking.code} at ${input.booking.hostelName} has ended.`,
    }),
  };
}

/** Sent when the payment is checked: the receipt, and the hostel's deadline. */
export function bookingPaymentVerifiedEmail(
  input: GuestBase & { hostelAnswerBy: string; paidOn: string; receiptNumber: string },
): EmailContent {
  return {
    category: "billing",
    subject: `Receipt ${input.receiptNumber} — booking fee received`,
    html: emailLayout({
      bodyHtml: [
        greeting(input.name),
        paragraph(`We received your booking fee. It is held by ${PLATFORM_NAME} until the booking ends.`),
        bookingFactsTable(input.booking, [
          { label: "Receipt", value: input.receiptNumber },
          { label: "Paid on", value: input.paidOn },
          { label: "Hostel answers by", value: input.hostelAnswerBy },
        ]),
        paragraph(
          `${escapeHtml(input.booking.hostelName)} now confirms your bed. If it declines or does not answer by ${escapeHtml(input.hostelAnswerBy)}, you get the full ${rupees(input.booking.fee)} back.`,
        ),
        ctaButton(input.bookingUrl, "View booking"),
      ].join(""),
      eyebrow: "Receipt",
      heading: "Booking fee received",
      preheader: `Receipt ${input.receiptNumber}: ${rupees(input.booking.fee)} for booking ${input.booking.code}.`,
    }),
  };
}
