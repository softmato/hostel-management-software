import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";
import { PLATFORM_NAME } from "../../../brand/brand";

export function hostelPublishedEmail(input: {
  hostelName: string;
  listingUrl: string;
}): EmailContent {
  return {
    category: "info",
    subject: `Your hostel is now online — ${input.hostelName}`,
    html: emailLayout({
      heading: "Your hostel is online 🎉",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.hostelName)}</strong> is now on ${PLATFORM_NAME}. Students looking for a hostel can see it.`,
        ),
        paragraph(
          "Keep your photos, prices and free beds up to date. Then more people will contact you.",
        ),
        ctaButton(input.listingUrl, "See your hostel"),
      ].join("\n"),
    }),
  };
}
