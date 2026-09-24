import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * The hostel's online checkout is not working (plan item 6.7).
 *
 * This email exists because the failure it reports is invisible from every
 * screen the owner looks at. A broken checkout and a quiet month produce the
 * same dashboard: no settlements, invoices staying open, nobody complaining
 * yet. Without this the owner finds out when a resident finally rings to say the
 * payment button has not worked since the 3rd — by which point a month of rent
 * is late for a reason nobody caused.
 *
 * So the body leads with the count, not the status. "Six residents tried to pay
 * and none succeeded" is a sentence an owner acts on; "gateway degraded" is one
 * they file.
 */
export function gatewayUnhealthyEmail(input: {
  detail: string;
  hostelName: string;
  providerName: string;
  setupUrl: string;
  title: string;
}): EmailContent {
  return {
    category: "alert",
    subject: `${input.title} · ${input.hostelName}`,
    html: emailLayout({
      heading: input.title,
      bodyHtml: [
        paragraph(escapeHtml(input.detail)),
        paragraph(
          `Your ${escapeHtml(input.providerName)} details may have changed (key, merchant code, or your bank turned off online payments). The money you already got is safe.`,
        ),
        paragraph(
          "Residents can still pay by QR, wallet or bank. That money still reaches you.",
        ),
        ctaButton(input.setupUrl, "Check payment settings"),
      ].join("\n"),
    }),
  };
}
