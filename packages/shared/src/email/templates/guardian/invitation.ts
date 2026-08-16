import { ctaButton, emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Guardian invitation (EMAIL_SYSTEM.md §1.5). Lists exactly what the resident
 * chose to share so the guardian knows the scope before accepting — and so a
 * later permission change is visibly the resident's decision, not a bug.
 */
export function guardianInvitationEmail(input: {
  acceptUrl: string;
  expiresInDays: number;
  hostelName: string;
  permissions: string[];
  residentName: string;
}): EmailContent {
  const permissionList =
    input.permissions.length > 0
      ? `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;">${input.permissions
          .map((permission) => `<li>${escapeHtml(permission)}</li>`)
          .join("")}</ul>`
      : paragraph(
          "They have not shared any details yet — you will see the hostel's contact information only.",
        );

  return {
    category: "info",
    subject: `${input.residentName} added you as their guardian — ${input.hostelName}`,
    html: emailLayout({
      heading: "Guardian invitation",
      bodyHtml: [
        paragraph(
          `<strong>${escapeHtml(input.residentName)}</strong> has invited you as their guardian at <strong>${escapeHtml(input.hostelName)}</strong>.`,
        ),
        paragraph("They chose to share:"),
        permissionList,
        paragraph(
          "You will only ever see the items above. The resident can change or withdraw this at any time.",
        ),
        ctaButton(input.acceptUrl, "Accept the invitation"),
        paragraph(
          `<span style="color:#64748b;font-size:13px;">This invitation expires in ${input.expiresInDays} days.</span>`,
        ),
      ].join("\n"),
    }),
  };
}
