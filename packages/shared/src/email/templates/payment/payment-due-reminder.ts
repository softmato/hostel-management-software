import { ctaButton, emailLayout, escapeHtml, monthName, paragraph, type EmailContent } from "../layout";

/**
 * Which of the three pre-due notices this is.
 *
 * A resident gets told a week out, three days out and on the day itself, and
 * the three must not arrive wearing the same sentence — three identical
 * "due soon" emails read as a system stuck in a loop, and the last one, the one
 * that actually matters, is the one such a reader has already learned to
 * ignore. See `nextDunningAction`.
 *
 * `WEEK` deliberately says "coming up" rather than naming a number of days: it
 * is the rung a hostel can move (`paymentReminderDaysBefore`), so a hostel that
 * reminds five days out would otherwise send an email that lies about its own
 * timing. The other two rungs are fixed and can be exact.
 */
export type ReminderStage = "SOON" | "TODAY" | "WEEK";

function wording(stage: ReminderStage) {
  switch (stage) {
    case "TODAY":
      return {
        heading: "Your hostel fee is due today",
        lead: "is due today",
        subject: "Rent due today",
      };
    case "SOON":
      return {
        heading: "Your hostel fee is due in three days",
        lead: "is due in three days",
        subject: "Rent due in 3 days",
      };
    default:
      return {
        heading: "Your hostel fee is due soon",
        lead: "is coming up",
        subject: "Payment due soon",
      };
  }
}

export function paymentDueReminderEmail(input: {
  amount: number;
  currency?: string;
  dueDate: Date;
  hostelName: string;
  month: string;
  paymentsUrl: string;
  residentName: string;
  /** Defaults to the first, gentlest notice. */
  stage?: ReminderStage;
}): EmailContent {
  const currency = input.currency ?? "NPR";
  const words = wording(input.stage ?? "WEEK");

  return {
    category: "billing",
    subject: `${words.subject} — ${monthName(input.month)} · ${input.hostelName}`,
    html: emailLayout({
      heading: words.heading,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, your <strong>${escapeHtml(monthName(input.month))}</strong> fee at ${escapeHtml(input.hostelName)} ${words.lead}.`,
        ),
        paragraph(
          `Amount due: <strong>${escapeHtml(currency)} ${input.amount.toLocaleString("en-US")}</strong><br/>Due date: <strong>${escapeHtml(input.dueDate.toDateString())}</strong>`,
        ),
        paragraph(
          "Pay through your usual method, then upload the payment proof so your hostel admin can verify it.",
        ),
        ctaButton(input.paymentsUrl, "Upload payment proof"),
      ].join("\n"),
    }),
  };
}
