import { Schema, model, models } from "mongoose";

/**
 * One uploaded provider statement, and the audit trail of what we read from it
 * (target §4.1 / §6.4).
 *
 * Tier 0.5's whole premise is that the hostel's own eSewa/Khalti/bank export is
 * the only independent evidence that a resident's claimed payment actually
 * happened. That makes this row an evidence record, not a job log:
 *
 * - **The raw file is retained** (`sourceAssetId`) and never re-derived. Parsers
 *   will change; a statement imported by v1 must be re-readable by v3, otherwise
 *   a parser bug is unfixable retrospectively for exactly the months that
 *   matter.
 * - **`parserVersion` is stored per import, not read from code.** "Which parser
 *   produced this?" has to be answerable a year later, when the code says
 *   something else.
 * - **`status: FAILED` is a first-class outcome.** A statement that could not be
 *   read must leave a row saying so — a partially parsed import that silently
 *   drops 24 of 84 rows is worse than one that refuses, because the missing rows
 *   look exactly like residents who did not pay.
 */

const statementImportSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    uploadedBy: { ref: "User", type: Schema.Types.ObjectId },
    uploadedAt: { default: Date.now, type: Date },

    /** The raw CSV/PDF. Kept forever so a re-parse is possible (target §6.4). */
    sourceAssetId: { ref: "FileAsset", type: Schema.Types.ObjectId },
    /** The uploaded file's own name, for the "which file was this?" question. */
    fileName: { type: String, trim: true },

    provider: {
      type: String,
      enum: ["ESEWA", "KHALTI", "BANK"],
      required: true,
    },
    /** The exact parser that produced the rows below — see the class comment. */
    parserVersion: { type: String, required: true, trim: true },

    /** The range the statement itself covers, derived from its rows. */
    periodStart: Date,
    periodEnd: Date,

    /** Credit rows read. Debits are counted but never matched. */
    rowCount: { default: 0, min: 0, type: Number },
    creditCount: { default: 0, min: 0, type: Number },
    /**
     * Rows whose `providerTxnId` was already ingested by an earlier import.
     * Overlapping date ranges are the normal case, so this is expected to be
     * large and is surfaced rather than hidden (target §6.4).
     */
    duplicateCount: { default: 0, min: 0, type: Number },

    /** Ladder outcome tallies — the three buckets of the reconcile screen. */
    matchedCount: { default: 0, min: 0, type: Number },
    suggestedCount: { default: 0, min: 0, type: Number },
    orphanCount: { default: 0, min: 0, type: Number },

    status: {
      type: String,
      enum: ["PARSING", "READY", "FAILED"],
      default: "PARSING",
      required: true,
    },
    /** Why it failed, in words an owner can act on. Empty unless FAILED. */
    errorDetail: { type: String, trim: true },

    completedAt: Date,
  },
  { timestamps: true },
);

statementImportSchema.index({ hostelId: 1, uploadedAt: -1 });

export const StatementImportModel =
  models.StatementImport || model("StatementImport", statementImportSchema);
