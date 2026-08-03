import { z } from "zod";

/**
 * The "fill it once, reuse it everywhere" personal profile. Every field here is
 * encrypted at rest — see lib/personal-data-crypto.ts.
 *
 * The field list is deliberately not open-ended: each one feeds something that
 * already exists in this product, so a hostel really can skip the paperwork.
 *
 *   fullName / phone / email / occupation  → Resident
 *   guardian* / secondGuardian*            → Guardian (name, phone, email, relation)
 *   emergencyContact*                      → EmergencyContact
 *   governmentId*                          → MoveInChecklist.documentsCollected
 *   bloodGroup / medicalNotes              → SOSAlert + safety handling
 *   dietaryPreference                      → Hostel.food (veg / non-veg service)
 *   gender / budgetRange                   → Inquiry, and BOYS/GIRLS hostel matching
 *   institution / courseOrDesignation      → the "educationInfo" in PHASES.md §2
 *
 * Anything hostel-specific (room, bed, deposit, move-in date) is intentionally
 * absent — that is the warden's call, not a portable fact about the person.
 */

export const GENDER_VALUES = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;

export const BLOOD_GROUP_VALUES = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
  "UNKNOWN",
] as const;

export const DIETARY_PREFERENCE_VALUES = [
  "NO_PREFERENCE",
  "VEG",
  "NON_VEG",
  "EGGETARIAN",
  "VEGAN",
] as const;

export const OCCUPATION_VALUES = ["STUDENT", "WORKING_PROFESSIONAL", "OTHER"] as const;

export const GOVERNMENT_ID_TYPE_VALUES = [
  "CITIZENSHIP",
  "PASSPORT",
  "DRIVING_LICENSE",
  "STUDENT_ID",
  "NATIONAL_ID",
  "OTHER",
] as const;

/*
 * This schema is fed straight from an HTML form, where "the user left it alone"
 * arrives as `""`, not as a missing key — a `<select>` placeholder, a cleared
 * date input, an untouched text box. Every optional field therefore treats a
 * blank string as "not provided" rather than rejecting it, so an untouched
 * field can never fail the whole submission.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const phone = z.string().trim().min(7).max(24);
const optionalPhone = z.preprocess(blankToUndefined, phone.optional());

const optionalEmail = z.preprocess(
  blankToUndefined,
  z.string().trim().toLowerCase().email().optional(),
);

/** A `<select>` whose placeholder option carries `value=""`. */
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToUndefined, z.enum(values).optional());

/** Same, but a blank falls back to the documented default. */
const enumWithDefault = <T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) => z.preprocess(blankToUndefined, z.enum(values).default(fallback));

export const residentProfileDataSchema = z
  .object({
    /* Identity */
    fullName: z.string().trim().min(2).max(120),
    dateOfBirth: z.preprocess(
      blankToUndefined,
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.")
        .optional(),
    ),
    gender: z.enum(GENDER_VALUES),
    bloodGroup: enumWithDefault(BLOOD_GROUP_VALUES, "UNKNOWN"),

    /* Contact — at most two emails: the account email plus one backup. */
    primaryPhone: phone,
    alternatePhone: optionalPhone,
    primaryEmail: z.string().trim().email().toLowerCase(),
    backupEmail: optionalEmail,

    /* Where they are from */
    permanentAddress: optionalText(240),
    city: optionalText(80),
    province: optionalText(80),

    /* What they do — maps straight onto Resident.residentType */
    occupation: enumWithDefault(OCCUPATION_VALUES, "STUDENT"),
    institution: optionalText(160),
    /** Course for a student, job title for a working professional. */
    courseOrDesignation: optionalText(120),

    /*
     * Guardians — the hostel needs at least one reachable adult. Email matters
     * as much as phone here: it is how the guardian portal invite is sent.
     */
    guardianName: z.string().trim().min(2).max(120),
    guardianRelation: z.string().trim().min(2).max(60),
    guardianPhone: phone,
    guardianEmail: optionalEmail,
    secondGuardianName: optionalText(120),
    secondGuardianRelation: optionalText(60),
    secondGuardianPhone: optionalPhone,
    secondGuardianEmail: optionalEmail,

    /* Emergency contact, when it is someone other than the guardian. */
    emergencyContactName: optionalText(120),
    emergencyContactRelation: optionalText(60),
    emergencyContactPhone: optionalPhone,

    /* Living preferences and safety notes */
    dietaryPreference: enumWithDefault(DIETARY_PREFERENCE_VALUES, "NO_PREFERENCE"),
    /** Free text (e.g. "8000-12000") so inquiry forms can autofill it too. */
    budgetRange: optionalText(40),
    medicalNotes: optionalText(500),
    interests: z
      .array(z.string().trim().min(1).max(40))
      .max(12)
      .default([])
      .transform((values) => Array.from(new Set(values.filter(Boolean)))),

    /* Government ID — hostels are legally required to record one. */
    governmentIdType: optionalEnum(GOVERNMENT_ID_TYPE_VALUES),
    governmentIdNumber: optionalText(40),
  })
  .refine((value) => !value.backupEmail || value.backupEmail !== value.primaryEmail, {
    message: "The backup email must be different from your account email.",
    path: ["backupEmail"],
  });

export type ResidentProfileData = z.infer<typeof residentProfileDataSchema>;

export const residentIdentitySaveSchema = z.object({
  profile: residentProfileDataSchema,
  sharingEnabled: z.boolean().default(true),
});

export const residentIdentitySharingSchema = z.object({
  sharingEnabled: z.boolean(),
});

/**
 * The ID-card photo is set by handle, never by upload: the bytes already went to
 * R2 through the universal uploader, so all this endpoint accepts is the
 * FileAsset id it minted. Ownership of that asset is re-checked server-side.
 */
export const residentIdentityPhotoSchema = z.object({
  photoAssetId: z.string().regex(/^[a-f\d]{24}$/i, "That is not a valid upload id."),
});

/**
 * Accepts anything the warden might realistically paste: `HH-4K7M-9XQ2`,
 * `hh4k7m9xq2`, or the full scan URL. normalizeResidentId() in the service does
 * the actual parsing and rejects what is not an ID.
 */
export const residentIdLookupSchema = z.object({
  hostelId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  residentId: z.string().trim().min(8).max(300),
});
