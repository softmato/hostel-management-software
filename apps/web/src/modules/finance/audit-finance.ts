import { createHash } from "node:crypto";
import type { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { AuditLogModel } from "@hostel/db/models/AuditLog";

/**
 * The audit envelope every finance write goes through (plan §5.3, target §13.5).
 *
 * Two things it fixes about the existing `auditPaymentAction`:
 *
 * 1. **Amounts are required.** `PAYMENT_UPDATED` recorded only the status
 *    transition, so changing `paidAmount` from 12,000 to 0 produced an audit
 *    entry that said nothing about the amount — the most dangerous operation in
 *    the system was the least audited (current §6.3). `amountBefore` and
 *    `amountAfter` are non-optional parameters here, which is what makes that
 *    unrepeatable rather than merely discouraged.
 * 2. **The entries are chained.** `financeIntegrity` is a SHA-256 over the
 *    previous entry's hash plus this entry's identifying fields, so editing or
 *    removing a finance audit row breaks every hash after it. The audit log is
 *    an ordinary mutable collection; this does not prevent tampering, it makes
 *    it detectable, and a break is raised as a `LEDGER_DRIFT` finding in 5.1.
 */

export const FINANCE_AUDIT_CURRENCY = "NPR";

export type FinanceAuditInput = {
  action: string;
  /** After the operation. Same units as `amountBefore`; whole rupees (ADR-1). */
  amountAfter: number;
  /** Before the operation. Use 0, never null, when nothing existed before. */
  amountBefore: number;
  currency?: string;
  entityId: Types.ObjectId | string;
  entityType: string;
  eventId?: string;
  hostelId: Types.ObjectId | string;
  invoiceId?: string;
  reason?: string;
  /** Where the write came from, e.g. "PROOF_APPROVAL", "ADMIN_PATCH". */
  source: string;
};

/**
 * The chain is per hostel, not platform-wide.
 *
 * A global chain would serialise every hostel's finance writes behind one head
 * row and make two unrelated hostels' concurrent approvals fork it constantly.
 * Per hostel, a fork means two writes inside one hostel raced — rare, real, and
 * worth surfacing. Consistent with ADR-4: detect, do not prevent.
 */
async function previousEntryHash(hostelId: Types.ObjectId | string) {
  const previous = await AuditLogModel.findOne({
    financeIntegrity: { $exists: true },
    hostelId,
  })
    .sort({ createdAt: -1 })
    .select("financeIntegrity")
    .lean<{ financeIntegrity?: string } | null>();

  return previous?.financeIntegrity ?? "";
}

export function financeIntegrityHash(input: {
  action: string;
  amountAfter: number;
  createdAt: Date;
  entityId: string;
  previousEntryHash: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.previousEntryHash,
        input.action,
        input.entityId,
        String(input.amountAfter),
        input.createdAt.toISOString(),
      ].join("|"),
    )
    .digest("hex");
}

export async function auditFinanceAction(
  principal: ApiPrincipal,
  input: FinanceAuditInput,
) {
  const entityId = input.entityId.toString();
  // Written explicitly rather than left to the schema default, so the value the
  // hash covers is the value that is stored.
  const createdAt = new Date();

  const financeIntegrity = financeIntegrityHash({
    action: input.action,
    amountAfter: input.amountAfter,
    createdAt,
    entityId,
    previousEntryHash: await previousEntryHash(input.hostelId),
  });

  await AuditLogModel.create({
    action: input.action,
    actorId: principal.userId,
    createdAt,
    entityId,
    entityType: input.entityType,
    financeIntegrity,
    hostelId: input.hostelId,
    metadata: {
      actorRole: principal.role,
      amountAfter: input.amountAfter,
      amountBefore: input.amountBefore,
      currency: input.currency ?? FINANCE_AUDIT_CURRENCY,
      eventId: input.eventId,
      invoiceId: input.invoiceId,
      reason: input.reason,
      source: input.source,
    },
  });
}
