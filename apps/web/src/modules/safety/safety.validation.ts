import { z } from "zod";

import { paginationQuerySchema } from "@/lib/pagination";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

export const nightStatusSchema = z.enum([
  "INSIDE_HOSTEL",
  "OUTSIDE_HOSTEL",
  "NOT_VERIFIED",
  "MARKED_SAFE",
  "SOS_TRIGGERED",
]);

/**
 * The hostel's presets, as a resident would pick them.
 *
 * A closed list rather than free text so the warden's board can group by it and
 * the notification's one-tap button has something to send. `OTHER` exists for
 * the typed answer, which arrives in `note` beside it.
 */
export const nightStatusReasonSchema = z.enum([
  "HOME",
  "FRIENDS",
  "TRAVELLING",
  "WORKING_LATE",
  "HOSPITAL",
  "OTHER",
]);

export const nightStatusUpdateSchema = z.object({
  /**
   * When the resident actually answered, for an answer that waited in a queue.
   * An answer older than the one already recorded tonight is ignored rather than
   * written over it — see `updateResidentNightStatus`.
   */
  answeredAt: z.iso.datetime().optional(),
  /**
   * What they typed, when they typed anything.
   *
   * 1000 was the old cap and it stays, even though the notification's inline
   * field will never produce anything near it — the in-app screen uses the same
   * endpoint and there is no reason to make the shorter surface the limit.
   */
  note: z.string().trim().max(1000).optional(),
  reasonCode: nightStatusReasonSchema.optional(),
  /**
   * Which surface the answer came from, for the one metric that says whether
   * this feature works: if `PUSH_ACTION` is rare, residents are not answering
   * from the notification and everything built for that is decoration.
   *
   * Accepted from the client and **not** trusted for anything but analytics —
   * it decides no permission and gates no write.
   */
  source: z.enum(["APP", "PUSH_ACTION", "WEB"]).optional(),
  status: nightStatusSchema,
});

export const nightStatusListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  status: nightStatusSchema.optional(),
});

export const nightStatusOverrideSchema = z.object({
  hostelId: objectIdSchema.optional(),
  reason: z.string().trim().min(3).max(1000),
  reasonCode: nightStatusReasonSchema.optional(),
  status: nightStatusSchema,
});

export const sosCreateSchema = z.object({
  guardianAlertEnabled: z.boolean().default(false),
  message: z.string().trim().max(1000).optional(),
});

export const sosListQuerySchema = z.object({
  ...paginationQuerySchema,
  hostelId: objectIdSchema.optional(),
  status: z.enum(["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"]).optional(),
});

export const sosStatusUpdateSchema = z.object({
  hostelId: objectIdSchema.optional(),
  note: z.string().trim().max(1000).optional(),
  status: z.enum(["ACKNOWLEDGED", "RESOLVED", "FALSE_ALARM"]),
});
