import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { HostelPaymentProfileModel } from "@hostel/db/models/HostelPaymentProfile";

/**
 * "You have not uploaded a statement in a while" (target §6.4, plan item 4.5).
 *
 * The reconciliation feature only works if it is actually used, and nothing in
 * the product prompts an owner to export a file from their bank. Left alone, a
 * hostel uses it once in the first week and never again — at which point every
 * fabricated transaction id goes uncaught, because catching them is exactly what
 * the import does (target §8's honest table).
 *
 * Two decisions the banner rests on:
 *
 * - **A hostel that has *never* uploaded is nudged too**, and worded
 *   differently. It is the population that most needs the prompt, and treating
 *   "no upload yet" as "not overdue" would silently exempt them forever.
 * - **The cadence is per hostel** (`statementCadenceDays`, default 7). A hostel
 *   with forty residents and one that bills three do not owe the same rhythm,
 *   and a platform-wide number would be nagging for one and useless for the other.
 *
 * Pure apart from one read, and the arithmetic is split out so it can be tested
 * without a clock or a database.
 */

export type StatementNudge = {
  cadenceDays: number;
  /** Null when no statement has ever been imported for this hostel. */
  daysSinceUpload: number | null;
  due: boolean;
  message: string;
};

export function buildStatementNudge(input: {
  cadenceDays: number;
  lastUploadAt: Date | null;
  now?: Date;
}): StatementNudge {
  const cadenceDays = input.cadenceDays > 0 ? input.cadenceDays : 7;

  if (!input.lastUploadAt) {
    return {
      cadenceDays,
      daysSinceUpload: null,
      due: true,
      message:
        "Upload your first eSewa, Khalti or bank statement to check what has actually arrived.",
    };
  }

  const now = input.now ?? new Date();
  const daysSinceUpload = Math.floor(
    (now.getTime() - input.lastUploadAt.getTime()) / 86_400_000,
  );

  if (daysSinceUpload <= cadenceDays) {
    return { cadenceDays, daysSinceUpload, due: false, message: "" };
  }

  return {
    cadenceDays,
    daysSinceUpload,
    due: true,
    message: `It has been ${daysSinceUpload} days since your last statement upload. Upload the latest one to reconcile this month.`,
  };
}

export async function getStatementNudge(
  hostelId: Types.ObjectId | string,
): Promise<StatementNudge> {
  await connectToDatabase();

  const profile = await HostelPaymentProfileModel.findOne({ hostelId })
    .select("lastStatementUploadAt statementCadenceDays")
    .lean<{ lastStatementUploadAt?: Date; statementCadenceDays?: number } | null>();

  return buildStatementNudge({
    cadenceDays: profile?.statementCadenceDays ?? 7,
    lastUploadAt: profile?.lastStatementUploadAt ?? null,
  });
}
