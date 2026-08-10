import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { financeIntegrityHash } from "@/modules/finance/audit-finance";
import { deriveInvoiceStatus } from "@/modules/finance/payment-event.service";
import {
  type RunFinding,
  type RunRecorder,
  withRun,
} from "@/modules/finance/reconciliation/run-recorder";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import {
  computeCreditAmount,
  CreditBalanceModel,
} from "@hostel/db/models/CreditBalance";
import { HostelModel } from "@hostel/db/models/Hostel";
import { InvoiceBalanceModel } from "@hostel/db/models/InvoiceBalance";
import { InvoiceModel } from "@hostel/db/models/Invoice";
import { PaymentEventModel } from "@hostel/db/models/PaymentEvent";
import { ReceiptModel } from "@hostel/db/models/Receipt";

/**
 * The nightly ledger drift job (target §10.1, plan item 5.1).
 *
 * **Drift is reported, never corrected.** That is the entire discipline of this
 * module and it is worth stating plainly, because the correcting version is one
 * line shorter and feels more helpful. A balance that disagrees with its events
 * means *something wrote where it should not have* — a code path that bypassed
 * `payment-event.service`, a partial failure, or a hand-edited document. Quietly
 * recomputing the projection erases the only evidence that path exists, and the
 * next drift is discovered by a resident who was charged twice.
 *
 * Six checks. Two compare the projection against the events; four look for
 * **structural half-completions**, which current §7.9 notes are possible today
 * and entirely undetectable — the direct consequence of ADR-4's decision to
 * forgo transactions. That decision is only defensible because this job exists:
 * a crash mid-sequence is allowed to leave a detectable half-state precisely
 * because something detects it.
 *
 * Every run writes a `ReconciliationRun` through {@link withRun} (§5.4), one per
 * hostel, so a job that has been throwing for a fortnight is visible rather than
 * silent.
 */

export const DRIFT_CODES = {
  /** `InvoiceBalance.settledAmount` disagrees with the sum of settled events. */
  LEDGER_DRIFT: "LEDGER_DRIFT",
  /** The stored status disagrees with the status its balance implies. */
  STATUS_DRIFT: "STATUS_DRIFT",
  /** A settled CREDIT that never got its receipt — crash between steps 3 and 4. */
  RECEIPT_MISSING: "RECEIPT_MISSING",
  /** A live receipt whose event is not settled — money proven that did not move. */
  RECEIPT_ORPHANED: "RECEIPT_ORPHANED",
  /** A gateway event past `expiresAt` that the sweep never reached. */
  EXPIRY_UNSWEPT: "EXPIRY_UNSWEPT",
  /** An invoice marked PAID whose settled events sum to less than its total. */
  PAID_SHORTFALL: "PAID_SHORTFALL",
  /** The finance audit hash chain does not verify (§5.3). */
  AUDIT_CHAIN_BROKEN: "AUDIT_CHAIN_BROKEN",
  /** A `CreditBalance.amount` that disagrees with its own entries. */
  CREDIT_DRIFT: "CREDIT_DRIFT",
  /** Credit consumed by an invoice that carries no matching credit line. */
  CREDIT_UNAPPLIED: "CREDIT_UNAPPLIED",
} as const;

export type LedgerDriftSummary = {
  findings: number;
  hostelId: string;
  runId: string;
  scanned: number;
  status: "FAIL" | "OK" | "WARN";
};

/** Invoices per page. The job is nightly; throughput matters less than memory. */
const BATCH_SIZE = 200;

/**
 * How far back the audit chain is verified on each run.
 *
 * Bounded because the chain grows without limit and re-walking all of it every
 * night would eventually dominate the job. A tampered entry is detected on the
 * night it happens; an attacker who waits out the window has still had to break
 * every hash after it, which the *next* entry's verification catches.
 */
const AUDIT_CHAIN_WINDOW = 500;

export async function runLedgerDriftForHostel(
  hostelId: Types.ObjectId | string,
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<LedgerDriftSummary> {
  await connectToDatabase();

  const { findings, result, runId, status } = await withRun(
    { hostelId, kind: "LEDGER_DRIFT", triggeredBy: options.triggeredBy ?? "CRON" },
    async (recorder) => {
      const scanned = await checkInvoices(hostelId, recorder, options.now ?? new Date());

      await checkReceipts(hostelId, recorder);
      await checkExpiredEvents(hostelId, recorder, options.now ?? new Date());
      await checkCreditBalances(hostelId, recorder);
      await checkAuditChain(hostelId, recorder);

      return { scanned };
    },
  );

  return {
    findings: findings.length,
    hostelId: hostelId.toString(),
    runId,
    scanned: result.scanned,
    status,
  };
}

/** Nightly entry point: every hostel, each with its own run row. */
export async function runLedgerDrift(
  options: { now?: Date; triggeredBy?: string } = {},
): Promise<LedgerDriftSummary[]> {
  await connectToDatabase();

  const hostels = await HostelModel.find({ isDeleted: { $ne: true } })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  const summaries: LedgerDriftSummary[] = [];

  for (const hostel of hostels) {
    try {
      summaries.push(await runLedgerDriftForHostel(hostel._id, options));
    } catch {
      // One hostel's failure must not stop the other forty. `withRun` has
      // already recorded the FAIL row with the message.
      summaries.push({
        findings: 0,
        hostelId: hostel._id.toString(),
        runId: "",
        scanned: 0,
        status: "FAIL",
      });
    }
  }

  return summaries;
}

/**
 * Balance drift, status drift, PAID shortfall and missing receipts.
 *
 * All four are answered from the same page of invoices and their events, so they
 * share one pass — the alternative is four full scans of the same collections
 * for a job that already runs against every invoice a hostel has ever issued.
 */
async function checkInvoices(
  hostelId: Types.ObjectId | string,
  recorder: RunRecorder,
  now: Date,
): Promise<number> {
  let cursor: Types.ObjectId | null = null;
  let scanned = 0;

  for (;;) {
    const invoices: {
      _id: Types.ObjectId;
      dueDate?: Date;
      period?: string | null;
      status: string;
      totalAmount: number;
    }[] = await InvoiceModel.find({
      hostelId,
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      // Paged by the field it sorts on: a cursor on anything else can skip or
      // repeat rows at a batch boundary.
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select("dueDate period status totalAmount")
      .lean();

    if (invoices.length === 0) {
      break;
    }

    cursor = invoices[invoices.length - 1]!._id;
    scanned += invoices.length;

    const invoiceIds = invoices.map((invoice) => invoice._id);

    const [events, balances, receipts] = await Promise.all([
      PaymentEventModel.find({
        invoiceId: { $in: invoiceIds },
        status: "SETTLED",
      })
        .select("amount direction invoiceId residentId settledAt")
        .lean<
          {
            _id: Types.ObjectId;
            amount: number;
            direction: string;
            invoiceId?: Types.ObjectId | null;
            residentId?: Types.ObjectId | null;
          }[]
        >(),
      InvoiceBalanceModel.find({ invoiceId: { $in: invoiceIds } })
        .select("invoiceId settledAmount")
        .lean<{ invoiceId: Types.ObjectId; settledAmount?: number }[]>(),
      ReceiptModel.find({ invoiceId: { $in: invoiceIds }, voidedAt: null })
        .select("eventId")
        .lean<{ eventId?: Types.ObjectId | null }[]>(),
    ]);

    const computed = new Map<string, number>();
    const creditEvents: typeof events = [];

    for (const event of events) {
      const key = event.invoiceId!.toString();
      const signed = event.direction === "DEBIT" ? -event.amount : event.amount;

      computed.set(key, (computed.get(key) ?? 0) + signed);

      if (event.direction === "CREDIT" && event.residentId) {
        creditEvents.push(event);
      }
    }

    const storedByInvoice = new Map(
      balances.map((balance) => [
        balance.invoiceId.toString(),
        balance.settledAmount ?? 0,
      ]),
    );
    const receiptedEventIds = new Set(
      receipts.map((receipt) => receipt.eventId?.toString()).filter(Boolean),
    );

    for (const invoice of invoices) {
      const key = invoice._id.toString();
      const settled = computed.get(key) ?? 0;
      const stored = storedByInvoice.get(key);

      // Absent is not zero: an invoice with events and no projection row at all
      // is a different failure from one whose projection is stale, and both are
      // drift. An invoice with neither is simply unpaid.
      if (stored === undefined ? settled !== 0 : stored !== settled) {
        recorder.finding({
          code: DRIFT_CODES.LEDGER_DRIFT,
          detail: `stored ${stored ?? "none"}, events sum to ${settled}`,
          entityId: invoice._id,
          entityType: "Invoice",
          severity: "ERROR",
        });
      }

      const expected = deriveInvoiceStatus({
        currentStatus: invoice.status,
        dueDate: invoice.dueDate,
        now,
        settledAmount: settled,
        totalAmount: invoice.totalAmount,
      });

      if (expected !== invoice.status) {
        recorder.finding({
          code: DRIFT_CODES.STATUS_DRIFT,
          detail: `stored ${invoice.status}, balance implies ${expected}`,
          entityId: invoice._id,
          entityType: "Invoice",
          severity: "WARN",
        });
      }

      if (invoice.status === "PAID" && settled < invoice.totalAmount) {
        recorder.finding({
          code: DRIFT_CODES.PAID_SHORTFALL,
          detail: `marked PAID but events sum to ${settled} of ${invoice.totalAmount}`,
          entityId: invoice._id,
          entityType: "Invoice",
          severity: "ERROR",
        });
      }
    }

    for (const event of creditEvents) {
      if (!receiptedEventIds.has(event._id.toString())) {
        recorder.finding({
          code: DRIFT_CODES.RECEIPT_MISSING,
          detail: `settled ${event.amount} with no live receipt`,
          entityId: event._id,
          entityType: "PaymentEvent",
          severity: "WARN",
        });
      }
    }

    recorder.count("scanned", invoices.length);

    if (invoices.length < BATCH_SIZE) {
      break;
    }
  }

  return scanned;
}

/**
 * Receipts with no settled event behind them.
 *
 * The mirror of `RECEIPT_MISSING` and the more serious of the two: a receipt is
 * the document a resident produces to prove they paid, so one standing against
 * an event that is not settled is a proof of money that did not move.
 */
async function checkReceipts(
  hostelId: Types.ObjectId | string,
  recorder: RunRecorder,
): Promise<void> {
  const receipts = await ReceiptModel.find({ hostelId, voidedAt: null })
    .select("amount eventId receiptNumber")
    .lean<
      {
        _id: Types.ObjectId;
        amount: number;
        eventId?: Types.ObjectId | null;
        receiptNumber: string;
      }[]
    >();

  const withEvent = receipts.filter((receipt) => receipt.eventId);

  if (withEvent.length === 0) {
    return;
  }

  const settled = await PaymentEventModel.find({
    _id: { $in: withEvent.map((receipt) => receipt.eventId) },
    status: "SETTLED",
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  const settledIds = new Set(settled.map((event) => event._id.toString()));

  for (const receipt of withEvent) {
    if (!settledIds.has(receipt.eventId!.toString())) {
      recorder.finding({
        code: DRIFT_CODES.RECEIPT_ORPHANED,
        detail: `receipt ${receipt.receiptNumber} for ${receipt.amount} has no settled event`,
        entityId: receipt._id,
        entityType: "Receipt",
        severity: "ERROR",
      });
    }
  }

  recorder.count("receiptsChecked", receipts.length);
}

/**
 * Pending events past their expiry that the sweep never reached (target §6.5).
 *
 * Block 6 adds the sweep itself; this check is written now because the state it
 * looks for is already reachable — a claim or intent with an `expiresAt` and no
 * job to clear it is exactly the half-completion this job exists to surface,
 * and a check that finds nothing until Block 6 costs one indexed query a night.
 */
async function checkExpiredEvents(
  hostelId: Types.ObjectId | string,
  recorder: RunRecorder,
  now: Date,
): Promise<void> {
  const stale = await PaymentEventModel.find({
    hostelId,
    expiresAt: { $lt: now },
    status: "PENDING",
  })
    .select("amount expiresAt")
    .limit(200)
    .lean<{ _id: Types.ObjectId; amount: number; expiresAt: Date }[]>();

  for (const event of stale) {
    recorder.finding({
      code: DRIFT_CODES.EXPIRY_UNSWEPT,
      detail: `pending since ${event.expiresAt.toISOString()} for ${event.amount}`,
      entityId: event._id,
      entityType: "PaymentEvent",
      severity: "WARN",
    });
  }

  recorder.count("expiredUnswept", stale.length);
}

/**
 * Credit balances against their own entries, and applied credit against the
 * invoice that was supposed to receive it (target §9.4, item 5.3).
 *
 * The second check exists because applying credit is two writes with no
 * transaction between them: the entry is appended, then the invoice gets its
 * negative line. That order is deliberate — the reverse would hand out a
 * discount nothing paid for — but it means a crash in between leaves credit
 * consumed by an invoice that never received it. The entry names the invoice, so
 * the state is recoverable; this is the thing that notices.
 */
async function checkCreditBalances(
  hostelId: Types.ObjectId | string,
  recorder: RunRecorder,
): Promise<void> {
  const balances = await CreditBalanceModel.find({ hostelId })
    .select("amount entries residentId")
    .lean<
      {
        _id: Types.ObjectId;
        amount?: number;
        entries?: {
          amount: number;
          invoiceId?: Types.ObjectId | null;
          kind: string;
        }[];
        residentId: Types.ObjectId;
      }[]
    >();

  if (balances.length === 0) {
    return;
  }

  const appliedInvoiceIds = balances.flatMap((balance) =>
    (balance.entries ?? [])
      .filter((entry) => entry.kind === "APPLIED" && entry.invoiceId)
      .map((entry) => entry.invoiceId!),
  );

  const invoices = appliedInvoiceIds.length
    ? await InvoiceModel.find({ _id: { $in: appliedInvoiceIds } })
        .select("lines")
        .lean<{ _id: Types.ObjectId; lines?: { basis?: string }[] }[]>()
    : [];

  const withCreditLine = new Set(
    invoices
      .filter((invoice) =>
        (invoice.lines ?? []).some((line) => line.basis === "CREDIT"),
      )
      .map((invoice) => invoice._id.toString()),
  );

  for (const balance of balances) {
    const entries = balance.entries ?? [];
    const computed = computeCreditAmount(entries);

    if ((balance.amount ?? 0) !== computed) {
      recorder.finding({
        code: DRIFT_CODES.CREDIT_DRIFT,
        detail: `stored ${balance.amount ?? 0}, entries sum to ${computed}`,
        entityId: balance._id,
        entityType: "CreditBalance",
        severity: "ERROR",
      });
    }

    for (const entry of entries) {
      if (
        entry.kind === "APPLIED" &&
        entry.invoiceId &&
        !withCreditLine.has(entry.invoiceId.toString())
      ) {
        recorder.finding({
          code: DRIFT_CODES.CREDIT_UNAPPLIED,
          detail: `${entry.amount} consumed for an invoice with no credit line`,
          entityId: entry.invoiceId,
          entityType: "Invoice",
          severity: "ERROR",
        });
      }
    }
  }

  recorder.count("creditBalancesChecked", balances.length);
}

/**
 * Verifies the finance audit hash chain (§5.3).
 *
 * `AuditLog` is an ordinary mutable collection, so this does not *prevent*
 * tampering — it makes tampering detectable, which is the honest claim. Editing
 * or deleting one finance entry breaks every hash after it, and the break is
 * reported with the entry it starts at.
 */
async function checkAuditChain(
  hostelId: Types.ObjectId | string,
  recorder: RunRecorder,
): Promise<void> {
  const entries = await AuditLogModel.find({
    financeIntegrity: { $exists: true },
    hostelId,
  })
    .sort({ createdAt: -1 })
    .limit(AUDIT_CHAIN_WINDOW)
    .select("action createdAt entityId financeIntegrity metadata")
    .lean<
      {
        _id: Types.ObjectId;
        action: string;
        createdAt: Date;
        entityId: string;
        financeIntegrity: string;
        metadata?: { amountAfter?: number };
      }[]
    >();

  // Oldest first: each entry's hash covers the previous entry's hash, so the
  // chain can only be verified in the direction it was written.
  const ordered = entries.reverse();

  for (let index = 1; index < ordered.length; index += 1) {
    const entry = ordered[index]!;
    const expected = financeIntegrityHash({
      action: entry.action,
      amountAfter: entry.metadata?.amountAfter ?? 0,
      createdAt: entry.createdAt,
      entityId: entry.entityId,
      previousEntryHash: ordered[index - 1]!.financeIntegrity,
    });

    if (expected !== entry.financeIntegrity) {
      recorder.finding({
        code: DRIFT_CODES.AUDIT_CHAIN_BROKEN,
        detail: `audit entry ${entry._id.toString()} (${entry.action}) does not verify against its predecessor`,
        entityId: entry._id,
        entityType: "AuditLog",
        severity: "ERROR",
      });

      // One report per run. Every entry after a break also fails to verify, and
      // a thousand findings describing one edit is noise that buries the rest.
      break;
    }
  }

  recorder.count("auditEntriesChecked", ordered.length);
}

/** Exported for the test that asserts a finding is never turned into a write. */
export type { RunFinding };
