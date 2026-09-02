import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

export const maintenanceCategorySchema = z.enum([
  "PLUMBING",
  "ELECTRICAL",
  "INTERNET",
  "CLEANING",
  "CARPENTRY",
  "PAINTING",
  "WATER",
  "APPLIANCE",
  "ROOM_REPAIR",
  "HEALTH",
  "OTHER",
]);

export const maintenanceStatusSchema = z.enum([
  "PENDING",
  "CONTACTED",
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
]);

export const maintenanceRequestCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  category: maintenanceCategorySchema,
  costNote: z.string().trim().max(500).optional(),
  description: z.string().trim().max(1600).optional(),
  /** Free text — "Room 204", "2nd floor bathroom". No room records exist. */
  location: z.string().trim().max(160).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  providerId: objectIdSchema.optional(),
  remarks: z.string().trim().max(800).optional(),
  scheduledFor: z.coerce.date().optional(),
  title: z.string().trim().min(2).max(180),
  /**
   * A completed `MAINTENANCE_NOTE` asset, recorded on the phone raising this.
   *
   * Attached at creation only. Re-recording is something the person does before
   * they press the button — once a provider has been sent to a job, silently
   * swapping the recording that describes it is not an edit, it is changing what
   * they were told.
   */
  voiceNoteAssetId: objectIdSchema.optional(),
});

export const maintenanceRequestListQuerySchema = z.object({
  ...optionalHostelScopeSchema,
  category: maintenanceCategorySchema.optional(),
  providerId: objectIdSchema.optional(),
  status: maintenanceStatusSchema.optional(),
});

export const maintenanceStatusUpdateSchema = z.object({
  ...optionalHostelScopeSchema,
  costNote: z.string().trim().max(500).optional(),
  note: z.string().trim().max(800).optional(),
  scheduledFor: z.coerce.date().optional(),
  status: maintenanceStatusSchema,
});

/**
 * The hostel's agreed call-out charges, one per trade.
 *
 * ## Why the whole list is sent, not a delta
 *
 * A charge is *removed* by leaving its category out, and there is no other way
 * to say "we no longer have an agreed rate for painting". A patch-shaped API
 * would need a sentinel for that — `null`, or `-1` — and every reader would then
 * have to know which sentinel meant absent. The list is small enough (eleven
 * categories at most) that replacing it wholesale is the simpler contract.
 *
 * Whole rupees, and a category may appear once. A duplicate is refused rather
 * than last-write-wins, because two rows for `PLUMBING` is a form bug and the
 * silent version of it is a hostel quoting whichever one the array happened to
 * order first.
 */
export const maintenanceSettingsSchema = z.object({
  ...optionalHostelScopeSchema,
  minimumCharges: z
    .array(
      z.object({
        amount: z.number().int().min(0).max(10_000_000),
        category: maintenanceCategorySchema,
      }),
    )
    .max(20)
    .refine(
      (rows) => new Set(rows.map((row) => row.category)).size === rows.length,
      "Each category may have only one minimum charge.",
    ),
});

/**
 * Sending a raised request to a contractor.
 *
 * Its own route rather than a field on the status update, because assigning is
 * not a status change: a request can be assigned while still `PENDING`, and a
 * status move must not be able to silently re-point the job at somebody else as
 * a side effect of somebody marking it scheduled.
 */
export const maintenanceProviderAssignSchema = z.object({
  ...optionalHostelScopeSchema,
  providerId: objectIdSchema,
});

export const maintenanceCommentCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  message: z.string().trim().min(1).max(1000),
  visibility: z.enum(["INTERNAL", "PROVIDER_NOTE"]).default("INTERNAL"),
});
