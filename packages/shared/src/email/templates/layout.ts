import { formatBsDate, formatBsPeriod, hostelDayParts, isBsPeriod } from "../../calendar/bs";
import { PRODUCT_NAME } from "../../index";
import type { EmailCategory } from "../identity";

export type EmailContent = {
  /**
   * Which mailbox this template sends from — `alert@`, `billing@`, and so on.
   *
   * It lives on the template rather than on the call site because the category
   * is a property of the *message*, and the call site is the one place that
   * cannot see the whole message. A service that reaches for
   * `paymentOverdueEmail()` should not also have to remember that overdue mail
   * is an alert; spreading the template into `sendEmail()` carries it along.
   */
  category: EmailCategory;
  subject: string;
  html: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { escapeHtml };

/*
 * The look every email shares, in one place.
 *
 * Black, white and green, like the product: dark text on a white card, the
 * brand green for the name above it and for the one button, red only on mail
 * that needs attention now. There is no painted header block. A coloured banner
 * reads as marketing in an inbox, and the mail people trust with money — a
 * bank's alert, a receipt — is quiet.
 *
 * Every style is inline and every layout is a table, because that is what email
 * clients actually render: some Gmail views strip `<style>`, and Outlook ignores
 * most of CSS layout.
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COLOR = {
  body: "#3f3f46",
  border: "#e4e4e7",
  brand: "#0a8a4b",
  canvas: "#f4f4f5",
  card: "#ffffff",
  danger: "#dc2626",
  muted: "#71717a",
  strong: "#18181b",
} as const;

/**
 * The preview line an inbox shows beside the subject.
 *
 * Hidden in the body, and padded with zero-width characters so the client does
 * not pull the first words of the email in after it — "Hi Sita, Your payment
 * for…" is a worse preview than the one sentence written for the purpose.
 */
function preheaderHtml(text: string) {
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.canvas};">${escapeHtml(text)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;
}

/**
 * Shared HTML shell for every transactional email (EMAIL_SYSTEM.md).
 * `bodyHtml` is trusted template markup; interpolate user-provided values
 * through escapeHtml() before passing them in.
 */
export function emailLayout(options: {
  bodyHtml: string;
  /**
   * A short label above the heading — "Invoice", "Overdue". Plain text. Urgent
   * mail that does not name one is labelled "Urgent".
   */
  eyebrow?: string;
  heading: string;
  /** The inbox preview line. Plain text; see `preheaderHtml`. */
  preheader?: string;
  /**
   * The platform owner's configured site name. Templates that have it should
   * pass it; the rest fall back to the shipped product name, which is why this
   * is optional rather than required — a half-migrated set of templates should
   * still render.
   */
  siteName?: string;
  /** Needs attention now. Turns the label red; nothing else shouts. */
  urgent?: boolean;
}) {
  const brand = escapeHtml(options.siteName?.trim() || PRODUCT_NAME);
  const eyebrow = options.eyebrow ?? (options.urgent ? "Urgent" : "");
  const eyebrowColor = options.urgent ? COLOR.danger : COLOR.muted;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(options.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLOR.canvas};">
    ${options.preheader ? preheaderHtml(options.preheader) : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLOR.canvas};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 16px;font-family:${FONT};font-size:17px;line-height:24px;font-weight:700;letter-spacing:-0.2px;color:${COLOR.brand};">${brand}</td>
            </tr>
            <tr>
              <td style="padding:32px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px;font-family:${FONT};">
                ${eyebrow ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${eyebrowColor};">${escapeHtml(eyebrow)}</p>` : ""}
                <h1 style="margin:0 0 20px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;color:${COLOR.strong};">${escapeHtml(options.heading)}</h1>
                ${options.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">
                Sent by ${brand} · Powered by Softmato<br>
                If you were not expecting this email, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The one action an email asks for.
 *
 * A table cell painted green with the link inside, rather than a styled link on
 * its own, because Outlook drops padding on inline links and would otherwise
 * render a bare underlined word. The address is printed under it for the reader
 * whose client breaks buttons or who wants to see where it goes.
 */
export function ctaButton(url: string, label: string) {
  const href = escapeHtml(url);

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 12px;">
    <tr>
      <td style="border-radius:8px;background:${COLOR.brand};">
        <a href="${href}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>
  <p style="margin:0 0 20px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">If the button does not work, open this link:<br><a href="${href}" style="color:${COLOR.muted};text-decoration:underline;word-break:break-all;">${href}</a></p>`;
}

export function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${COLOR.body};">${text}</p>`;
}

/** `Hi Sita,` — or `Hi,` when there is no name worth using. */
export function greeting(name?: string | null) {
  const trimmed = name?.trim();

  return paragraph(trimmed ? `Hi ${escapeHtml(trimmed)},` : "Hi,");
}

/**
 * Secondary lines under the action — "already paid?", where the PDF is.
 * Trusted markup, like `paragraph`.
 */
export function smallPrint(html: string) {
  return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLOR.muted};">${html}</p>`;
}

/** An inline link in the brand colour, for a second destination that is not the button. */
export function textLink(url: string, label: string) {
  return `<a href="${escapeHtml(url)}" style="color:${COLOR.brand};font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>`;
}

export type DetailRow = {
  /** The one figure the email is about — set larger. At most one per table. */
  emphasis?: boolean;
  label: string;
  /** Plain text. A blank value drops the row, so optional facts need no branching. */
  value: string;
};

/**
 * Label on the left, value on the right, a hairline between rows — the shape a
 * bank statement uses, because it is the one people scan fastest for "how much"
 * and "by when". Both sides are escaped here.
 */
export function detailsTable(rows: DetailRow[]) {
  const visible = rows.filter((row) => row.value.trim() !== "");

  if (visible.length === 0) {
    return "";
  }

  const body = visible
    .map((row, index) => {
      const rule = index === 0 ? "" : `border-top:1px solid ${COLOR.border};`;
      const size = row.emphasis
        ? "font-size:18px;line-height:26px;"
        : "font-size:14px;line-height:20px;";

      return `<tr>
        <td style="padding:12px 0;${rule}font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.muted};">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:12px 0 12px 16px;${rule}font-family:${FONT};${size}font-weight:600;color:${COLOR.strong};">${escapeHtml(row.value)}</td>
      </tr>`;
    })
    .join("");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 8px;border-top:1px solid ${COLOR.border};border-bottom:1px solid ${COLOR.border};">${body}</table>`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `"2083-05"` → `"Bhadra 2083 BS"`, and `"2026-07"` → `"July 2026"`, for
 * anything a person reads.
 *
 * The ledger's period key is `YYYY-MM` because it sorts as a string, and every
 * payment email printed it raw: "Payment verified — 2026-07" is a subject line
 * that reads like a machine talking to itself. Anything that is not a period
 * key passes through untouched, so a caller already holding a formatted string
 * cannot be made worse by routing it through here.
 */
export function monthName(period: string | null | undefined): string {
  if (!period) {
    return "";
  }

  /*
   * Bikram Sambat first. The ledger keys its months in BS now (`2083-05` is
   * Bhadra), and reading that key as a Gregorian month put "May 2083" on
   * residents' reminders.
   */
  if (isBsPeriod(period)) {
    const named = formatBsPeriod(period);

    if (named) {
      return named;
    }
  }

  const match = /^(\d{4})-(\d{2})$/.exec(period);

  if (!match) {
    return period;
  }

  const name = MONTH_NAMES[Number(match[2]) - 1];

  return name ? `${name} ${match[1]}` : period;
}

/**
 * `Aswin 1, 2083 BS (17 Sep 2026)` — a day as both calendars name it.
 *
 * Bikram Sambat first, because it is the calendar a hostel owner plans in and
 * the one the app prints; the Gregorian date after it, because billing mail gets
 * forwarded to people who read the other one. Both are read off the **Nepal**
 * day, so a due that ends at 23:59 in Kathmandu is never printed as the next day.
 */
export function emailDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const { day, month, year } = hostelDayParts(date);
  const gregorian = `${day} ${(MONTH_NAMES[month - 1] ?? "").slice(0, 3)} ${year}`;
  const bikramSambat = formatBsDate(date);

  return bikramSambat ? `${bikramSambat} (${gregorian})` : gregorian;
}
