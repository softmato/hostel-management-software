import { z } from "zod";

/**
 * Input for a billing run (item 2.5).
 *
 * Note what is **not** here: an amount. The bulk fee run this replaces took a
 * `defaultAmount` from the request body and fell back to it whenever a resident
 * had no fee, which is how a misconfigured resident got billed a number nobody
 * chose for them (current §5.1 A2). Amounts come from the fee schedule and the
 * per-resident override, and from nowhere else.
 */

/** "YYYY-MM", with a real month number — `2026-13` is not a period. */
const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM.");

export const billingRunSchema = z.object({
  /**
   * Optional override for the whole run. Absent means the end of the period,
   * which is the rule the dominant path used and the one residents are used to.
   */
  dueDate: z.coerce.date().optional(),
  hostelId: z.string().optional(),
  period: periodSchema,
  /** Absent means the whole hostel. Present restricts the run to these residents. */
  residentIds: z.array(z.string()).optional(),
});

export const billingRunQuerySchema = z.object({
  hostelId: z.string().optional(),
  period: periodSchema,
});

export type BillingRunInput = z.infer<typeof billingRunSchema>;
export type BillingRunQuery = z.infer<typeof billingRunQuerySchema>;
