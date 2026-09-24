import {
  ctaButton,
  emailLayout,
  escapeHtml,
  paragraph,
  type EmailContent,
} from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

/** EMAIL_SYSTEM.md §9.2. */
export function accountDeletionCancelledEmail(input: {
  loginUrl: string;
  userName?: string;
}): EmailContent {
  return {
    category: "security",
    subject: "Your account is back on",
    html: emailLayout({
      heading: "Your account is active again",
      bodyHtml: [
        paragraph(
          `${input.userName ? `${escapeHtml(input.userName)}, we` : "We"} stopped the delete request for your ${PLATFORM_NAME} account. You can log in now.`,
        ),
        paragraph(
          "Nothing was deleted. Everything is the same as before.",
        ),
        paragraph(
          "Not you? Change your password now and tell your hostel.",
        ),
        ctaButton(input.loginUrl, "Log in"),
      ].join("\n"),
    }),
  };
}
