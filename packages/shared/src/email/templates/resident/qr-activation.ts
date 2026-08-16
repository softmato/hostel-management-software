import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

export function residentQrActivationEmail(input: {
  activationUrl: string;
  code: string;
  expiresAt: Date;
  hostelName: string;
  /** Public R2 URL of the rendered QR image. Omitted when storage is unconfigured. */
  qrImageUrl?: string;
  residentName: string;
}): EmailContent {
  const expiry = input.expiresAt.toUTCString();
  const qrBlock = input.qrImageUrl
    ? `<p style="margin:0 0 16px;text-align:center;">
    <img src="${escapeHtml(input.qrImageUrl)}" alt="Activation QR code" width="200" height="200" style="border:1px solid #dbeee8;border-radius:12px;" />
  </p>`
    : paragraph(
        "Scan the QR code in the HostelHub app, or use the code below on the web.",
      );

  return {
    category: "security",
    subject: `Activate your HostelHub account — ${input.hostelName}`,
    html: emailLayout({
      heading: "Activate your resident account",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, <strong>${escapeHtml(input.hostelName)}</strong> has set up your resident account on HostelHub.`,
        ),
        qrBlock,
        paragraph(
          `If you cannot scan the code, enter this activation code instead:<br/><strong style="font-size:22px;letter-spacing:3px;">${escapeHtml(input.code)}</strong>`,
        ),
        ctaButton(input.activationUrl, "Activate my account"),
        paragraph(
          `This code expires on <strong>${escapeHtml(expiry)}</strong>. Ask your hostel admin for a new one if it lapses.`,
        ),
      ].join("\n"),
    }),
  };
}
