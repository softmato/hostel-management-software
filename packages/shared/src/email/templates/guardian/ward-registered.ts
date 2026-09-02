import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

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
  const facts = [
    `Hostel: <strong>${escapeHtml(input.hostelName)}</strong>`,
    input.roomType
      ? `Room: <strong>${escapeHtml(input.roomType.replaceAll("_", " "))}</strong>`
      : "",
    input.moveInDate
      ? `Moving in: <strong>${escapeHtml(input.moveInDate.toDateString())}</strong>`
      : "",
    input.hostelPhone
      ? `Hostel phone: <strong>${escapeHtml(input.hostelPhone)}</strong>`
      : "",
  ].filter(Boolean);

  return {
    category: "info",
    subject: `${input.residentName} is now a resident of ${input.hostelName}`,
    html: emailLayout({
      heading: "Your ward has been registered",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.guardianName)}, <strong>${escapeHtml(input.hostelName)}</strong> has registered <strong>${escapeHtml(input.residentName)}</strong> as a resident and listed you as their ${escapeHtml(
            input.relation?.toLowerCase() || "guardian",
          )}.`,
        ),
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;">${facts
          .map((fact) => `<li>${fact}</li>`)
          .join("")}</ul>`,
        paragraph(
          "You are the contact the hostel will reach in an emergency. If any of this is wrong, or you should not be listed here, tell the hostel.",
        ),
      ].join("\n"),
    }),
  };
}
