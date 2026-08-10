import { z } from "zod";

/**
 * Statement import and reconciliation inputs (target §6.4, §11.5).
 *
 * `provider` is required rather than sniffed from the file. The registry treats
 * detection as a guard on the owner's choice, not as a search, so that choice
 * has to arrive from the form — a file misfiled as the wrong provider must be
 * refused with a reason, never silently read by whichever parser matches.
 */

export const STATEMENT_PROVIDERS = ["ESEWA", "KHALTI", "BANK"] as const;

export const statementImportSchema = z.object({
  /** A FileAsset the owner has already uploaded, checked against this hostel. */
  assetId: z.string().trim().min(1),
  hostelId: z.string().optional(),
  provider: z.enum(STATEMENT_PROVIDERS),
});

export const statementListQuerySchema = z.object({
  hostelId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const assignOrphanSchema = z.object({
  hostelId: z.string().optional(),
  invoiceId: z.string().trim().min(1),
});

export const bulkApproveStatementSchema = z.object({
  hostelId: z.string().optional(),
  statementImportId: z.string().trim().min(1),
});

export type StatementImportInput = z.infer<typeof statementImportSchema>;
