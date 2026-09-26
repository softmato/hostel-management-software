import { detailsTable, emailLayout, paragraph, type EmailContent } from "../layout";

/** A visitor on the compare page asked for help choosing a hostel. */
export function consultationRequestEmail(input: {
  details: { label: string; value: string }[];
  name: string;
}): EmailContent {
  return {
    category: "support",
    subject: `Help choosing a hostel — ${input.name}`,
    html: emailLayout({
      heading: "Someone wants help choosing a hostel",
      bodyHtml: [detailsTable(input.details), paragraph("Please call or email them.")].join("\n"),
    }),
  };
}

/** A hostel owner asked the platform to change something only we can change. */
export function hostelChangeRequestEmail(input: {
  change: string;
  hostelName: string;
  hostelSlug: string;
  newValue: string;
  reason?: string;
}): EmailContent {
  return {
    category: "support",
    subject: `Change request: ${input.change} — ${input.hostelName}`,
    html: emailLayout({
      heading: "A hostel asked for a change",
      bodyHtml: [
        detailsTable([
          { label: "Hostel", value: `${input.hostelName} (${input.hostelSlug})` },
          { label: "Change", value: input.change },
          { label: "New value", value: input.newValue },
          { label: "Reason", value: input.reason ?? "" },
        ]),
        paragraph(
          "Check it, then make the change in the platform portal. The owner gets an email when it is done.",
        ),
      ].join("\n"),
    }),
  };
}
