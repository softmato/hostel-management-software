import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const cookPortalUpdateSchema = z.object({
  cookName: z.string().trim().min(2).max(80).optional(),
  enabled: z.boolean(),
  hostelId: objectIdSchema.optional(),
});

export const foodReadySchema = z.object({
  deviceInfo: z.record(z.string(), z.unknown()).default({}),
  hostelId: objectIdSchema.optional(),
  mealType: z.enum(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]),
  /** Custom announcement. Omitted → today's menu items, or a plain "ready" ping. */
  message: z.string().trim().max(240).optional(),
  /** When true, the message is built from today's menu for this meal. */
  useMenuDescription: z.boolean().default(true),
});

const cookNameSchema = z.string().trim().min(2).max(80);

/**
 * Adding a cook. One endpoint, two shapes, discriminated the way the admin
 * thinks about it: *"generate a login for them"* or *"send them an invite"*.
 *
 * `CREDENTIAL` takes no email — the whole point is that we mint a short one.
 * `INVITE` takes no name-optional shortcut either: an invitation that arrives
 * addressed to nobody is the one a cook ignores.
 */
export const cookCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    hostelId: objectIdSchema.optional(),
    kind: z.literal("CREDENTIAL"),
    name: cookNameSchema,
  }),
  z.object({
    email: z.string().trim().toLowerCase().email().max(160),
    hostelId: objectIdSchema.optional(),
    kind: z.literal("INVITE"),
    name: cookNameSchema,
  }),
]);

/**
 * Editing one cook. `rotate` only means anything for a `CREDENTIAL` cook —
 * there is no password of ours behind an invited mailbox to rotate.
 */
export const cookUpdateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  name: cookNameSchema.optional(),
  /** Issue a fresh first-time password and retire the current one. */
  rotate: z.boolean().optional(),
});

export const cookRemoveSchema = z.object({
  hostelId: objectIdSchema.optional(),
});

export const cookInvitationAcceptSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  token: z.string().trim().min(16).max(128),
});
