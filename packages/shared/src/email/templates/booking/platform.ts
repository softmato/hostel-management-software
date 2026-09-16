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
    subject: `Bookings paused automatically — ${input.hostelName}`,
    html: emailLayout({
      bodyHtml: [
        paragraph(
          `${escapeHtml(input.hostelName)} missed or cancelled ${input.strikes} bookings in ${input.windowDays} days. Its Book button is off until a superadmin turns it back on.`,
        ),
        ctaButton(input.reviewUrl, "Review hostel"),
      ].join(""),
      eyebrow: "Bookings",
      heading: "Hostel bookings paused",
      preheader: `${input.hostelName}: ${input.strikes} strikes in ${input.windowDays} days.`,
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
        paragraph("A booking fee screenshot is waiting. Check it against the collection account."),
        detailsTable([
          { label: "Booking", value: input.code },
          { label: "Guest", value: input.guestName },
          { label: "Hostel", value: input.hostelName },
          { emphasis: true, label: "Amount", value: rupees(input.amount) },
          { label: "Their reference", value: input.reference ?? "" },
          { label: "Promised by", value: input.checkBy },
        ]),
        ctaButton(input.queueUrl, "Check payment"),
      ].join(""),
      eyebrow: "Bookings",
      heading: "Booking payment to check",
      preheader: `${input.guestName} sent a screenshot for ${rupees(input.amount)} (${input.code}).`,
    }),
  };
}
