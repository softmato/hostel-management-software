import { detailsTable, emailDate, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Tells a guardian that the person they are guardian to now lives at a hostel.
 *
 * ## Why it is sent when the guardian is attached, not when the resident is
 *
 * A scanned intake creates the resident first and writes their guardian and
 * emergency records **afterwards** (`attachContacts` in the mobile intake), so at
 * the moment of registration there is nobody to write to. Hooking this to the
 * guardian record instead means the parent of a resident registered by card and
 * the parent added by hand a fortnight later both get told, once each, without
 * the intake having to know which kind of registration it was.
 *
 * ## It carries no money and no login
 *
 * Deliberately. A guardian is not a party to the resident's ledger — what the
 * resident may see is theirs, and what a guardian may see is the resident's own
 * decision, made on their privacy screen (`createGuardianAccess`). This mail is
 * the fact that a hostel now houses their ward, the address, and who to call.
 * Anything more would be handing out a resident's record to a phone number
 * somebody typed at a desk.
 */
export function wardRegisteredEmail(input: {
  guardianName: string;
  hostelName: string;
  hostelPhone?: string | null;
  moveInDate?: Date | null;
  relation?: string | null;
  residentName: string;
  roomType?: string | null;
}): EmailContent {
  return {
    category: "info",
    subject: `${input.residentName} now stays at ${input.hostelName}`,
    html: emailLayout({
      heading: `${input.residentName} now stays at ${input.hostelName}`,
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.guardianName)}, <strong>${escapeHtml(input.hostelName)}</strong> added <strong>${escapeHtml(input.residentName)}</strong> as a resident and added you as their ${escapeHtml(
            input.relation?.toLowerCase() || "guardian",
          )}.`,
        ),
        detailsTable([
          { label: "Hostel", value: input.hostelName },
          { label: "Room", value: input.roomType?.replaceAll("_", " ") ?? "" },
          { label: "Moving in", value: emailDate(input.moveInDate) ?? "" },
          { label: "Hostel phone", value: input.hostelPhone ?? "" },
        ]),
        paragraph("The hostel will call you in an emergency. Something wrong? Tell the hostel."),
      ].join("\n"),
    }),
  };
}
