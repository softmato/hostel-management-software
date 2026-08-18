import { z } from "zod";

/** One hour is the shortest useful hand-off; 30 days the longest "temporary". */
export const TEMPORARY_CREDENTIAL_MIN_HOURS = 1;
export const TEMPORARY_CREDENTIAL_MAX_HOURS = 24 * 30;

/**
 * A temporary username must be unmistakably *not* an email address: no `@`, and
 * it has to start and end with a letter or digit. `login()` routes on exactly
 * that difference, so the rule lives here rather than in a comment.
 */
export const temporaryCredentialUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, "Username must be at least 4 characters.")
  .max(32, "Username must be 32 characters or fewer.")
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    "Use letters, digits, dots, dashes or underscores — no spaces and no @.",
  );

export const temporaryCredentialCreateSchema = z.object({
  expiresInHours: z.coerce
    .number()
    .int()
    .min(TEMPORARY_CREDENTIAL_MIN_HOURS, "Pick at least one hour.")
    .max(TEMPORARY_CREDENTIAL_MAX_HOURS, "Temporary access cannot exceed 30 days.")
    .default(24),
  label: z.string().trim().max(80, "Keep the note under 80 characters.").optional(),
  username: temporaryCredentialUsernameSchema,
});

export type TemporaryCredentialCreateInput = z.infer<
  typeof temporaryCredentialCreateSchema
>;
