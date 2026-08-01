import { z } from "zod";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id.");

const optionalHostelScopeSchema = {
  hostelId: objectIdSchema.optional(),
};

/**
 * The canonical per-member capability list (DATABASE.md → HostelMember).
 * Stored as an array of the enabled keys on `HostelMember.permissions`, so a new
 * capability costs an entry here rather than a migration across every row.
 */
export const WARDEN_PERMISSION_KEYS = [
  "registerResidents",
  "editHostelProfile",
  "manageRooms",
  "verifyPayments",
  "manageFood",
  "manageNotices",
  "viewComplaints",
  "updateComplaints",
  "viewNightStatus",
  "updateNightStatus",
  "manageMaintenance",
] as const;

export type WardenPermissionKey = (typeof WARDEN_PERMISSION_KEYS)[number];

/**
 * What a newly created warden gets. Everything except the two that change the
 * hostel itself — editing the profile and the room configuration stay with the
 * admin until they are granted deliberately.
 */
export const DEFAULT_WARDEN_PERMISSIONS: WardenPermissionKey[] = [
  "registerResidents",
  "verifyPayments",
  "manageFood",
  "manageNotices",
  "viewComplaints",
  "updateComplaints",
  "viewNightStatus",
  "updateNightStatus",
  "manageMaintenance",
];

const permissionsSchema = z
  .array(z.enum(WARDEN_PERMISSION_KEYS))
  .max(WARDEN_PERMISSION_KEYS.length);

export const wardenListQuerySchema = z.object({
  ...optionalHostelScopeSchema,
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "REMOVED"]).optional(),
});

export const wardenCreateSchema = z.object({
  ...optionalHostelScopeSchema,
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  permissions: permissionsSchema.optional(),
  phone: z.string().trim().min(7).max(24).optional(),
});

export const wardenUpdateSchema = z
  .object({
    ...optionalHostelScopeSchema,
    permissions: permissionsSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .refine((value) => value.permissions !== undefined || value.status !== undefined, {
    message: "Provide permissions or status to update.",
  });
