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

export const platformAdminInviteSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  role: platformAdminRoleSchema,
});

export const platformAdminEmailCheckSchema = z.object({
  email: z.string().trim().email("Enter a complete email address."),
});

/**
 * The token and nothing else. Accepting asks the recipient for no details: the
 * link reached their mailbox, which is the only thing this step needs to
 * establish, and they sign in with Google afterwards.
 */
export const platformAdminInvitationAcceptSchema = z.object({
  token: z.string().trim().min(1, "This link is missing its invitation token."),
});
