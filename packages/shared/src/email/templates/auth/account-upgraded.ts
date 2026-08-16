import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
    subject: "Your HostelHub account has been upgraded",
    html: emailLayout({
      heading: "Account upgraded",
      bodyHtml: [
        paragraph(
          `Your existing HostelHub account has been upgraded to <strong>${escapeHtml(input.roleLabel)}</strong>${context}.`,
        ),
        paragraph(
          "Your login details have not changed — sign in with the same email/password or Google account you already use, and you will land on your new dashboard.",
        ),
        ctaButton(input.dashboardUrl, "Open dashboard"),
      ].join("\n"),
    }),
  };
}
