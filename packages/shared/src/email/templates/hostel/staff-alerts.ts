import {
  ctaButton,
  detailsTable,
  emailLayout,
  listTable,
  monthName,
  paragraph,
  sectionTitle,
  smallPrint,
  type EmailContent,
} from "../layout";

/**
 * The hostel admins' summary emails: one table each, one button, no speeches.
 * These replaced bare HTML fragments that were sent with no layout at all.
 */

/** ponytail: a list stops at this many rows; the rest is "…and N more in the app". */
const MAX_ROWS = 50;

const rupees = (amount: number) => `NPR ${amount.toLocaleString("en-US")}`;

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function more(total: number) {
  return total > MAX_ROWS ? smallPrint(`…and ${total - MAX_ROWS} more in the app.`) : "";
}

export type PaymentLine = { amount: number; month?: string | null; name: string };

function paymentTable(lines: PaymentLine[], amountLabel = "Amount") {
  const sum = lines.reduce((total, line) => total + line.amount, 0);

  return (
    listTable(
      [{ label: "Name" }, { label: "Month" }, { align: "right", label: amountLabel }],
      lines.slice(0, MAX_ROWS).map((line) => [line.name, monthName(line.month) || "—", rupees(line.amount)]),
      lines.length > 1 ? ["Total", "", rupees(sum)] : undefined,
    ) + more(lines.length)
  );
}

/** The morning payments email. Sent only when one of the two lists has rows. */
export function paymentSummaryEmail(input: {
  hostelName: string;
  paymentsUrl: string;
  received: PaymentLine[];
  waiting: PaymentLine[];
}): EmailContent {
  const { received, waiting } = input;

  return {
    category: "billing",
    subject: waiting.length
      ? `${plural(waiting.length, "payment")} to check — ${input.hostelName}`
      : `${plural(received.length, "payment")} received — ${input.hostelName}`,
    html: emailLayout({
      heading: "Payments",
      preheader: [
        waiting.length ? `${waiting.length} to check` : "",
        received.length ? `${received.length} received` : "",
      ]
        .filter(Boolean)
        .join(", "),
      bodyHtml: [
        waiting.length
          ? sectionTitle(`To check (${waiting.length})`) +
            smallPrint("Residents sent a payment photo. Check each one, then verify it.") +
            paymentTable(waiting)
          : "",
        received.length
          ? sectionTitle(`Received since yesterday (${received.length})`) + paymentTable(received)
          : "",
        ctaButton(input.paymentsUrl, waiting.length ? "Check payments" : "Open payments"),
      ].join("\n"),
    }),
  };
}

/** Residents who ran out of automatic reminders on this run. */
export function unpaidFeesEmail(input: {
  hostelName: string;
  paymentsUrl: string;
  reminders: number;
  residents: PaymentLine[];
}): EmailContent {
  const count = input.residents.length;

  return {
    category: "billing",
    subject: `${plural(count, "resident")} still not paid — ${input.hostelName}`,
    html: emailLayout({
      heading: "Fees still not paid",
      bodyHtml: [
        paragraph(
          `We reminded ${count === 1 ? "this resident" : "these residents"} ${input.reminders} times. They have not paid, so we stopped the reminders. Please talk to them.`,
        ),
        paymentTable(input.residents, "Unpaid"),
        ctaButton(input.paymentsUrl, "Open payments"),
      ].join("\n"),
    }),
  };
}

function lateBy(hours: number) {
  return hours < 24 ? plural(hours, "hour") : plural(Math.floor(hours / 24), "day");
}

function typeLabel(type: string) {
  const lower = type.toLowerCase().replace(/_/g, " ");

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Complaints that passed their deadline since the last run. */
export function overdueComplaintsEmail(input: {
  complaints: { hoursLate: number; title: string; type: string }[];
  complaintsUrl: string;
  hostelName: string;
}): EmailContent {
  const count = input.complaints.length;

  return {
    category: "alert",
    subject: `${plural(count, "complaint")} past the deadline — ${input.hostelName}`,
    html: emailLayout({
      heading: "Complaints past the deadline",
      bodyHtml: [
        paragraph(`${count === 1 ? "This complaint is" : "These complaints are"} not fixed yet.`),
        listTable(
          [{ label: "Complaint" }, { label: "Type" }, { align: "right", label: "Late by" }],
          input.complaints
            .slice(0, MAX_ROWS)
            .map((complaint) => [complaint.title, typeLabel(complaint.type), lateBy(complaint.hoursLate)]),
        ),
        more(count),
        ctaButton(input.complaintsUrl, "Open complaints"),
      ].join("\n"),
    }),
  };
}

/** One new complaint. */
export function newComplaintEmail(input: {
  complaintsUrl: string;
  from: string;
  hostelName: string;
  title: string;
  type: string;
}): EmailContent {
  return {
    category: "support",
    subject: `New complaint: ${input.title} — ${input.hostelName}`,
    html: emailLayout({
      heading: "New complaint",
      bodyHtml: [
        detailsTable([
          { label: "From", value: input.from },
          { label: "Type", value: typeLabel(input.type) },
          { label: "Complaint", value: input.title },
        ]),
        ctaButton(input.complaintsUrl, "Open complaints"),
      ].join("\n"),
    }),
  };
}

/** Residents newly past the hostel's absence limit. */
export function attendanceAlertEmail(input: {
  attendanceUrl: string;
  hostelName: string;
  residents: { days: number; name: string }[];
}): EmailContent {
  const count = input.residents.length;

  return {
    category: "alert",
    subject: `${plural(count, "resident")} away from the hostel — ${input.hostelName}`,
    html: emailLayout({
      heading: "Residents away",
      bodyHtml: [
        paragraph(
          `${count === 1 ? "This resident has" : "These residents have"} not been seen at the hostel for a while.`,
        ),
        listTable(
          [{ label: "Name" }, { align: "right", label: "Days away" }],
          input.residents.slice(0, MAX_ROWS).map((resident) => [resident.name, String(resident.days)]),
        ),
        more(count),
        ctaButton(input.attendanceUrl, "Open attendance"),
      ].join("\n"),
    }),
  };
}
