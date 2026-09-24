import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function accountUpgradedEmail(input: {
  roleLabel: string;
  dashboardUrl: string;
  hostelName?: string;
}): EmailContent {
  const context = input.hostelName
    ? ` for <strong>${escapeHtml(input.hostelName)}</strong>`
    : "";

  return {
    category: "security",
    subject: `You have new access on ${PLATFORM_NAME}`,
    html: emailLayout({
      heading: "You have new access",
      bodyHtml: [
        paragraph(
          `Your ${PLATFORM_NAME} account is now <strong>${escapeHtml(input.roleLabel)}</strong>${context}.`,
        ),
        paragraph(
          "Log in the same way as before (email and password, or Google). You will see your new dashboard.",
        ),
        ctaButton(input.dashboardUrl, "Open dashboard"),
      ].join("\n"),
    }),
  };
}
