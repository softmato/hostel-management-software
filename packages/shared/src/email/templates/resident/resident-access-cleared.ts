import { emailLayout, escapeHtml, paragraph, type EmailContent } from "../layout";

/**
 * Sent when becoming a resident took something else away.
 *
 * Residency has no blocker: whatever role or hostel membership an account held
 * before, moving into a hostel wins and the rest is stood down. That is the
 * right outcome — the person is standing at the desk with their luggage — but
 * doing it silently would be its own defect. Somebody who had a warden invite in
 * their inbox would go looking for a dashboard that had quietly stopped
 * existing, find a public home page, and have no way to tell whether the product
 * was broken or their access had been withdrawn on purpose.
 *
 * So the mail says exactly what was cleared and nothing else. It is not sent at
 * all when nothing was — the ordinary case, where a public account is simply
 * promoted, is already covered by the registration confirmation, and a second
 * mail listing an empty set would be noise.
 */
export function residentAccessClearedEmail(input: {
  /** Hostels and roles stood down, as the person would recognise them. */
  clearedMemberships: { hostelName: string; role: string }[];
  /** The role they held before, when it was not already a public account. */
  clearedRole: string | null;
  hostelName: string;
  /** True when an invitation they never accepted was closed off. */
  reactivatedInvite: boolean;
  residentName: string;
  supportEmail?: string;
}): EmailContent {
  const items: string[] = [];

  if (input.clearedRole) {
    items.push(
      `Your previous <strong>${escapeHtml(roleLabel(input.clearedRole))}</strong> access has been closed. Your account is now a resident account.`,
    );
  }

  for (const membership of input.clearedMemberships) {
    items.push(
      `You have been removed as ${escapeHtml(roleLabel(membership.role).toLowerCase())} at <strong>${escapeHtml(membership.hostelName)}</strong>.`,
    );
  }

  if (input.reactivatedInvite) {
    items.push(
      "An invitation you had never accepted has been closed, and your account is now active.",
    );
  }

  return {
    category: "info",
    subject: `Your account is now a resident account at ${input.hostelName}`,
    html: emailLayout({
      heading: "What changed on your account",
      bodyHtml: [
        paragraph(
          `Hi ${escapeHtml(input.residentName)}, now that <strong>${escapeHtml(input.hostelName)}</strong> has registered you as a resident, your account signs in as a resident.`,
        ),
        paragraph("To make that possible we cleared the following:"),
        `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;">${items
          .map((item) => `<li style="margin:0 0 8px;">${item}</li>`)
          .join("")}</ul>`,
        paragraph(
          "Your password and Google sign-in are unchanged — sign in the way you always have. Nothing else about your account was touched.",
        ),
        paragraph(
          input.supportEmail
            ? `If any of this looks wrong, reply to this email or write to ${escapeHtml(input.supportEmail)} and we will put it back.`
            : "If any of this looks wrong, reply to this email and we will put it back.",
        ),
      ].join("\n"),
    }),
  };
}

/** `WARDEN` → `Warden`, so the mail reads like a sentence rather than a column. */
function roleLabel(role: string) {
  const labels: Record<string, string> = {
    GUARDIAN: "Guardian",
    HOSTEL_ADMIN: "Hostel admin",
    RESIDENT: "Resident",
    SERVICE_PROVIDER: "Service provider",
    WARDEN: "Warden",
  };

  return labels[role] ?? role.toLowerCase().replace(/_/g, " ");
}
