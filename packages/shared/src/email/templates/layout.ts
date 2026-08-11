import { PRODUCT_NAME } from "../../index";

export type EmailContent = {
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

/**
 * Shared HTML shell for every transactional email (EMAIL_SYSTEM.md).
 * `bodyHtml` is trusted template markup; interpolate user-provided values
 * through escapeHtml() before passing them in.
 */
export function emailLayout(options: {
  heading: string;
  bodyHtml: string;
  /**
   * The platform owner's configured site name. Templates that have it should
   * pass it; the rest fall back to the shipped product name, which is why this
   * is optional rather than required — a half-migrated set of templates should
   * still render.
   */
  siteName?: string;
  urgent?: boolean;
}) {
  const headerBackground = options.urgent ? "#b91c1c" : "#0f766e";
  const brand = escapeHtml(options.siteName?.trim() || PRODUCT_NAME);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3faf8;padding:32px 16px;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dbeee8;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px;background:${headerBackground};color:#ffffff;">
          <h1 style="margin:0;font-size:22px;line-height:1.25;">${escapeHtml(options.heading)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          ${options.bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
          ${brand} — Multi-Hostel Platform. If you were not expecting this email you can safely ignore it.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function ctaButton(url: string, label: string) {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>
  </p>
  <p style="margin:0 0 16px;color:#64748b;font-size:13px;">If the button does not work, copy this link into your browser:<br/>${escapeHtml(url)}</p>`;
}

export function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${text}</p>`;
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
 * `"2026-07"` → `"July 2026"`, for anything a person reads.
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

  const match = /^(\d{4})-(\d{2})$/.exec(period);

  if (!match) {
    return period;
  }

  const name = MONTH_NAMES[Number(match[2]) - 1];

  return name ? `${name} ${match[1]}` : period;
}
