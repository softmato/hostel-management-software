import type { Types } from "mongoose";

import { FinanceServiceError } from "@/modules/finance/finance.errors";
import {
  generateReferenceCode,
  isValidPrefix,
  MAX_SEQUENCE,
} from "@/modules/finance/reference-code";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";

/**
 * Allocates the next reference code for a hostel (target §5.2).
 *
 * The code itself is pure arithmetic and lives in `reference-code.ts`; the one
 * thing it cannot do without I/O is decide *which* sequence number is next, and
 * that decision has to be atomic. Two invoices issued in the same millisecond
 * with the same code would be indistinguishable to every downstream matcher —
 * a payment carrying it could settle either one.
 *
 * `findOneAndUpdate($inc)` with `upsert` is atomic in MongoDB, so concurrent
 * callers get distinct numbers with no lock and no retry loop. Same mechanism as
 * the receipt counter, and deliberately the same collection.
 */

/**
 * Reference sequences are per hostel and never reset.
 *
 * A code is generated once, at issue, and never changes — the resident may have
 * written it on a bank transfer that has not arrived yet (§5.2). A per-period
 * counter would hand out `RUP-0001-x` again every January and quietly break that
 * promise, so the "period" here is a constant.
 */
const LIFETIME = "LIFETIME";

export async function allocateReferenceCode(
  hostelId: Types.ObjectId | string,
  prefix: string | null | undefined,
): Promise<string> {
  if (!prefix || !isValidPrefix(prefix)) {
    throw new FinanceServiceError(
      "This hostel has no reference prefix. Run the reference-prefix backfill before billing.",
      "REFERENCE_PREFIX_MISSING",
    );
  }

  const counter = await ReceiptCounterModel.findOneAndUpdate(
    { hostelId, kind: "REFERENCE", period: LIFETIME },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = counter?.sequence ?? 1;

  if (sequence > MAX_SEQUENCE) {
    // 923,521 codes per hostel. Reaching this is not a runtime condition anyone
    // will hit, but wrapping silently would reissue a live code, so it is an
    // error rather than a modulo.
    throw new FinanceServiceError(
      `This hostel has exhausted its reference sequence at ${MAX_SEQUENCE}.`,
      "REFERENCE_PREFIX_MISSING",
    );
  }

  return generateReferenceCode(prefix, sequence);
}
