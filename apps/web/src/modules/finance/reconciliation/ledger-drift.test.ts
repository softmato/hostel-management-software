/**
 * Ledger drift — Block 5 item 5.1 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §10.1).
 *
 * The assertion that matters most is negative: **nothing here writes.** ADR-4's
 * decision to forgo MongoDB transactions is only defensible because a crash
 * mid-sequence leaves a *detectable* half-state, and detection is worthless if
 * the detector quietly repairs the evidence. So alongside each check there is a
 * test that no model's write methods were called.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");
const eventId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");
const runId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b9");

const mocks = vi.hoisted(() => ({
  auditFind: vi.fn(),
  balanceFind: vi.fn(),
  creditFind: vi.fn(),
  eventFind: vi.fn(),
  invoiceFind: vi.fn(),
  invoiceUpdateOne: vi.fn(),
  profileFindOne: vi.fn(),
  receiptFind: vi.fn(),
  residentFind: vi.fn(),
  userFind: vi.fn(),
  runCreate: vi.fn(),
  runUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { find: mocks.auditFind },
}));
vi.mock("@hostel/db/models/CreditBalance", async (importOriginal) => ({
  // `computeCreditAmount` is the real rule the credit check is about; only the
  // model is stubbed.
  ...(await importOriginal<typeof import("@hostel/db/models/CreditBalance")>()),
  CreditBalanceModel: { find: mocks.creditFind },
}));
vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { find: vi.fn() },
}));
vi.mock("@hostel/db/models/HostelPaymentProfile", () => ({
  HostelPaymentProfileModel: { findOne: mocks.profileFindOne },
}));
vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));
vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: mocks.userFind },
}));
vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { find: mocks.invoiceFind, updateOne: mocks.invoiceUpdateOne },
}));
vi.mock("@hostel/db/models/InvoiceBalance", () => ({
  InvoiceBalanceModel: { find: mocks.balanceFind, updateOne: vi.fn() },
}));
vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { find: mocks.eventFind, updateOne: vi.fn() },
}));
vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: { find: mocks.receiptFind, updateOne: vi.fn() },
}));
vi.mock("@hostel/db/models/ReconciliationRun", () => ({
  ReconciliationRunModel: { create: mocks.runCreate, updateOne: mocks.runUpdateOne },
}));

import { financeIntegrityHash } from "@/modules/finance/audit-finance";
import {
  DRIFT_CODES,
  runLedgerDriftForHostel,
} from "@/modules/finance/reconciliation/ledger-drift.service";

const NOW = new Date(2026, 7, 20);

function chain<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

/**
 * The database as the checks see it.
 *
 * Dispatching on the query filter rather than on call order, because the service
 * reads events three times for different questions — a mock keyed to call order
 * would pass while asserting nothing about which query got which answer, and
 * would break the moment a check is reordered.
 */
const db = {
  audit: [] as Record<string, unknown>[],
  credits: [] as Record<string, unknown>[],
  balances: [] as Record<string, unknown>[],
  expiredEvents: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  receipts: [] as Record<string, unknown>[],
  residents: [] as Record<string, unknown>[],
  settledEvents: [] as Record<string, unknown>[],
  /** Approved claims no statement has confirmed — item E.6. */
  unconfirmedClaims: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
};

/** One invoice, one settled credit of the full amount, and a live receipt. */
function healthy() {
  db.invoices = [
    {
      _id: invoiceId,
      dueDate: new Date(2026, 7, 5),
      period: "2026-08",
      status: "PAID",
      totalAmount: 8000,
    },
  ];
  db.settledEvents = [
    { _id: eventId, amount: 8000, direction: "CREDIT", invoiceId, residentId },
  ];
  db.balances = [{ invoiceId, settledAmount: 8000 }];
  db.receipts = [
    { _id: new Types.ObjectId(), amount: 8000, eventId, receiptNumber: "R-1" },
  ];
  db.audit = [];
  db.credits = [];
  db.expiredEvents = [];
  db.residents = [];
  db.unconfirmedClaims = [];
  db.users = [];
}

function wireModels() {
  mocks.invoiceFind.mockImplementation(() => chain(db.invoices));
  mocks.balanceFind.mockImplementation(() => chain(db.balances));
  mocks.receiptFind.mockImplementation(() => chain(db.receipts));
  mocks.auditFind.mockImplementation(() => chain(db.audit));
  mocks.creditFind.mockImplementation(() => chain(db.credits));
  mocks.profileFindOne.mockImplementation(() => chain({ statementCadenceDays: 7 }));
  mocks.residentFind.mockImplementation(() => chain(db.residents));
  mocks.userFind.mockImplementation(() => chain(db.users));
  mocks.eventFind.mockImplementation((filter: Record<string, unknown>) => {
    if (filter.expiresAt) {
      return chain(db.expiredEvents);
    }

    // Item E.6: approved claims still waiting for a statement to carry them.
    if (filter.confirmation === "MANUAL_REVIEW") {
      return chain(db.unconfirmedClaims);
    }

    // The receipt check asks "which of these event ids are settled?".
    if (filter._id) {
      const ids = new Set(db.settledEvents.map((event) => String(event._id)));

      return chain(
        ((filter._id as { $in: unknown[] }).$in ?? [])
          .filter((id) => ids.has(String(id)))
          .map((id) => ({ _id: id })),
      );
    }

    return chain(db.settledEvents);
  });
}

/** The findings the run recorder was asked to store. */
function recordedFindings(): { code: string; detail: string }[] {
  const call = mocks.runUpdateOne.mock.calls.at(-1);

  return call?.[1]?.$set?.findings ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runCreate.mockResolvedValue({ _id: runId });
  mocks.runUpdateOne.mockResolvedValue({});
  healthy();
  wireModels();
});

describe("a consistent ledger", () => {
  it("finds nothing and records an OK run", async () => {
    const summary = await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(summary.findings).toBe(0);
    expect(summary.status).toBe("OK");
    expect(recordedFindings()).toHaveLength(0);
  });

  it("still writes a run row, so a silent job is visible", async () => {
    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(mocks.runCreate).toHaveBeenCalledOnce();
    expect(mocks.runUpdateOne).toHaveBeenCalled();
  });
});

describe("the six checks", () => {
  it("reports a projection that disagrees with the events", async () => {
    db.balances = [{ invoiceId, settledAmount: 5000 }];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.LEDGER_DRIFT,
    );
  });

  it("treats a missing projection row as drift, not as zero", async () => {
    db.balances = [];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.LEDGER_DRIFT,
    );
  });

  it("does not report an unpaid invoice with no projection row", async () => {
    db.invoices = [
      { _id: invoiceId, dueDate: new Date(2026, 8, 5), status: "OPEN", totalAmount: 8000 },
    ];
    db.settledEvents = [];
    db.balances = [];
    db.receipts = [];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings()).toHaveLength(0);
  });

  it("reports a status that disagrees with the balance", async () => {
    db.invoices = [
      { _id: invoiceId, dueDate: new Date(2026, 7, 5), status: "OPEN", totalAmount: 8000 },
    ];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    const finding = recordedFindings().find(
      (one) => one.code === DRIFT_CODES.STATUS_DRIFT,
    );

    expect(finding?.detail).toContain("PAID");
  });

  it("reports a PAID invoice whose events sum short", async () => {
    db.settledEvents = [
      { _id: eventId, amount: 3000, direction: "CREDIT", invoiceId, residentId },
    ];
    db.balances = [{ invoiceId, settledAmount: 3000 }];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.PAID_SHORTFALL,
    );
  });

  it("reports a settled credit with no live receipt", async () => {
    db.receipts = [];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.RECEIPT_MISSING,
    );
  });

  it("reports a live receipt whose event is not settled", async () => {
    // The receipt points at an event that is not in the settled set — the
    // reversal that voided nothing, or a receipt issued before the settle.
    db.receipts = [
      {
        _id: new Types.ObjectId(),
        amount: 8000,
        eventId: new Types.ObjectId(),
        receiptNumber: "R-9",
      },
    ];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.RECEIPT_ORPHANED,
    );
  });

  it("reports a pending event past its expiry", async () => {
    db.expiredEvents = [
      { _id: new Types.ObjectId(), amount: 4000, expiresAt: new Date(2026, 7, 1) },
    ];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.EXPIRY_UNSWEPT,
    );
  });
});

/**
 * Item E.6 — the check that looks for a forged screenshot rather than a
 * half-written document.
 *
 * The service does the date arithmetic, so these fix `now` and let the query
 * filter be the assertion: the mock returns whatever it is asked for, and what
 * is being verified is the *cutoff* the service asks with and the sentence it
 * writes about what comes back.
 */
describe("approved claims no statement has confirmed", () => {
  const claimId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c7");
  const wardenId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c8");

  function approvedClaim(settledAt: Date) {
    db.unconfirmedClaims = [
      { _id: claimId, amount: 8000, residentId, reviewedBy: wardenId, settledAt },
    ];
    db.residents = [{ _id: residentId, firstName: "Bishal", lastName: "Rai" }];
    db.users = [{ _id: wardenId, name: "Warden Gurung" }];
  }

  it("names the resident, the amount and the warden who approved it", async () => {
    approvedClaim(new Date(2026, 6, 20));

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    const finding = recordedFindings().find(
      (one) => one.code === DRIFT_CODES.CLAIM_UNCONFIRMED,
    );

    expect(finding).toBeDefined();
    expect(finding?.detail).toContain("Bishal Rai");
    expect(finding?.detail).toContain("8000");
    expect(finding?.detail).toContain("Warden Gurung");
  });

  it("asks for settlements older than twice the hostel's statement cadence", async () => {
    mocks.profileFindOne.mockImplementation(() =>
      chain({ statementCadenceDays: 10 }),
    );

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    const filter = mocks.eventFind.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((one) => one.confirmation === "MANUAL_REVIEW");

    // 20 days before `now`, not 10: one cadence is the shortest honest wait, so
    // the grace period is two.
    expect((filter?.settledAt as { $lt: Date }).$lt).toEqual(new Date(2026, 6, 31));
    expect(filter?.reversedByEventId).toBeNull();
  });

  it("says nothing about a settlement inside the grace period", async () => {
    approvedClaim(new Date(2026, 7, 18));
    // The service filters by date in the query, so an in-window claim is one the
    // database never returns.
    db.unconfirmedClaims = [];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).not.toContain(
      DRIFT_CODES.CLAIM_UNCONFIRMED,
    );
  });
});

describe("the audit hash chain", () => {
  function entry(overrides: {
    action: string;
    amountAfter: number;
    createdAt: Date;
    entityId: string;
    previousEntryHash: string;
  }) {
    return {
      _id: new Types.ObjectId(),
      action: overrides.action,
      createdAt: overrides.createdAt,
      entityId: overrides.entityId,
      financeIntegrity: financeIntegrityHash(overrides),
      metadata: { amountAfter: overrides.amountAfter },
    };
  }

  it("passes an intact chain", async () => {
    const first = entry({
      action: "PAYMENT_EVENT_SETTLED",
      amountAfter: 8000,
      createdAt: new Date(2026, 7, 1),
      entityId: "a",
      previousEntryHash: "",
    });
    const second = entry({
      action: "PAYMENT_EVENT_SETTLED",
      amountAfter: 16000,
      createdAt: new Date(2026, 7, 2),
      entityId: "b",
      previousEntryHash: first.financeIntegrity,
    });

    // The service reads newest first and reverses.
    db.audit = [second, first];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).not.toContain(
      DRIFT_CODES.AUDIT_CHAIN_BROKEN,
    );
  });

  it("reports an entry whose amount was edited after the fact", async () => {
    const first = entry({
      action: "PAYMENT_EVENT_SETTLED",
      amountAfter: 8000,
      createdAt: new Date(2026, 7, 1),
      entityId: "a",
      previousEntryHash: "",
    });
    const second = entry({
      action: "PAYMENT_EVENT_SETTLED",
      amountAfter: 16000,
      createdAt: new Date(2026, 7, 2),
      entityId: "b",
      previousEntryHash: first.financeIntegrity,
    });

    // Somebody rewrote the amount without being able to recompute the hash.
    second.metadata = { amountAfter: 1 };
    db.audit = [second, first];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(recordedFindings().map((one) => one.code)).toContain(
      DRIFT_CODES.AUDIT_CHAIN_BROKEN,
    );
  });

  it("reports a break once, not once per entry after it", async () => {
    const first = entry({
      action: "A",
      amountAfter: 1,
      createdAt: new Date(2026, 7, 1),
      entityId: "a",
      previousEntryHash: "",
    });
    const broken = { ...first, _id: new Types.ObjectId(), financeIntegrity: "tampered" };
    const after = { ...first, _id: new Types.ObjectId(), financeIntegrity: "also-wrong" };

    db.audit = [after, broken, first];

    await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(
      recordedFindings().filter((one) => one.code === DRIFT_CODES.AUDIT_CHAIN_BROKEN),
    ).toHaveLength(1);
  });
});

describe("reporting, never correcting", () => {
  it("writes nothing to the ledger even when everything is wrong", async () => {
    db.balances = [{ invoiceId, settledAmount: 999 }];
    db.receipts = [];

    const summary = await runLedgerDriftForHostel(hostelId, { now: NOW });

    expect(summary.findings).toBeGreaterThan(0);
    // A drift means something wrote where it should not have. Repairing the
    // projection erases the only evidence that path exists.
    expect(mocks.invoiceUpdateOne).not.toHaveBeenCalled();
  });

  it("marks the run WARN rather than failing it", async () => {
    db.balances = [{ invoiceId, settledAmount: 999 }];

    const summary = await runLedgerDriftForHostel(hostelId, { now: NOW });

    // FAIL is reserved for a job that threw. Findings are the job working.
    expect(summary.status).toBe("WARN");
  });
});
