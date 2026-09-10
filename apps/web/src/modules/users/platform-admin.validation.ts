import { z } from "zod";

import { Role } from "@/lib/roles";

const platformAdminRoleSchema = z.enum([Role.SUPERADMIN, Role.PLATFORM_MODERATOR]);

export const platformAdminCreateSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  role: platformAdminRoleSchema,
  sendEmailNotification: z.boolean().optional(),
});

export const platformAdminRoleUpdateSchema = z.object({
  role: platformAdminRoleSchema,
});

/**
 * Every role an invitation may grant.
 *
 * Wider than `platformAdminRoleSchema`, which stays as it is because it also
 * guards *changing* an existing admin's grade — a field agent is not a rung on
 * that ladder and must not be reachable by editing somebody's admin level.
 */
export const invitableRoleSchema = z.enum([
  Role.SUPERADMIN,
  Role.PLATFORM_MODERATOR,
  Role.PLATFORM_AGENT,
]);

export const platformAdminInviteSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  role: invitableRoleSchema,
});

/**
 * Several invitations in one submission.
 *
 * The team is hired in batches — a superadmin pastes in the addresses of the
 * people who started this week — so the screen takes a list and this takes a
 * list. Capped at twenty because beyond that it stops being a form and starts
 * being an import, and an import needs a preview and a dry run that this does
 * not have.
 *
 * Sending is deliberately **not** all-or-nothing: see `invitePlatformAdmins`.
 */
export const platformAdminBulkInviteSchema = z.object({
  invitations: z
    .array(
      z.object({
        email: z.string().trim().email(),
        name: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(40).optional(),
      }),
    )
    .min(1, "Add at least one address.")
    .max(20, "Send at most twenty invitations at a time."),
  role: invitableRoleSchema,
});

export const platformAdminEmailCheckSchema = z.object({
  email: z.string().trim().email("Enter a complete email address."),
  /**
   * The grade about to be offered, when the caller knows it. Only one answer
   * depends on it — an address that already holds *this* role has nothing to be
   * granted — so the field stays optional and the check falls back to treating
   * any platform grade as taken.
   */
  role: invitableRoleSchema.optional(),
});

/**
 * The token and nothing else. Accepting asks the recipient for no details: the
 * link reached their mailbox, which is the only thing this step needs to
 * establish, and they sign in with Google afterwards.
 */
export const platformAdminInvitationAcceptSchema = z.object({
  token: z.string().trim().min(1, "This link is missing its invitation token."),
});
