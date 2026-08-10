/**
 * `runBillingCycle` — Block 2 item 2.5 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §6.1).
 *
 * The three paths this replaces disagreed with each other, so the cases that
 * matter are the ones where they disagreed: proration, who counts as billable,
 * and what happens when a resident cannot be priced. The plan names three
 * requirements outright — skip reasons are surfaced and never swallowed,
 * re-running is a no-op, and a missing `FeeSchedule` fails the whole run without
 * partial billing — and each has a test here that fails if it regresses.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocateReferenceCode: vi.fn(),
  audit: vi.fn(),
  eventCount: vi.fn(),
  hostelFind: vi.fn(),
  invoiceFindOne: vi.fn(),
  applyCredit: vi.fn(),
  invoiceUpdateOne: vi.fn(),
  hostelFindOne: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceFind: vi.fn(),
  residentFind: vi.fn(),
  scheduleFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

// Credit application (item 5.3) has its own suite; here it is stubbed to "no
// credit available", which is every resident's situation in these cases —
// except the one case at the bottom of this file that overrides it.
vi.mock("@/modules/finance/credit-balance.service", () => ({
  applyCreditToInvoice: mocks.applyCredit,
}));

vi.mock("@/modules/finance/audit-finance", () => ({
  auditFinanceAction: mocks.audit,
}));

vi.mock("@/modules/finance/reference-sequence.service", () => ({
  allocateReferenceCode: mocks.allocateReferenceCode,
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { find: mocks.hostelFind, findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: {
    create: mocks.invoiceCreate,
    find: mocks.invoiceFind,
    findOne: mocks.invoiceFindOne,
    updateOne: mocks.invoiceUpdateOne,
  },
}));

vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { countDocuments: mocks.eventCount },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));

vi.mock("@hostel/db/models/FeeSchedule", () => ({
  FeeScheduleModel: { findOne: mocks.scheduleFindOne },
}));

import {
  findBillableResidents,
  periodOf,
  runBillingCycle,
  runBillingCycleForAllHostels,
  voidInvoice,
} from "@/modules/finance/billing.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentA = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const residentB = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");
const scheduleId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");

const principal = { userId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1") } as never;

const schedule = {
  _id: scheduleId,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  hostelId,
  rates: [{ bedType: "DOUBLE_SHARING", monthlyAmount: 12000 }],
};

function resident(overrides: Record<string, unknown> = {}) {
  return {
    _id: residentA,
    bedType: "DOUBLE_SHARING",
    hostelId,
    monthlyFee: null,
    moveInDate: new Date("2025-01-01T00:00:00.000Z"),
    moveOutDate: null,
    status: "ACTIVE",
    ...overrides,
  };
}

/** `.lean()`-terminated query chains, as the service uses them. */
function lean<T>(rows: T) {
  return { lean: vi.fn().mockResolvedValue(rows), select: vi.fn().mockReturnThis(), sort: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hostelFindOne.mockReturnValue(lean({ referencePrefix: "RUP" }));
  mocks.scheduleFindOne.mockReturnValue(lean(schedule));
  mocks.residentFind.mockReturnValue(lean([resident()]));
  mocks.invoiceFind.mockReturnValue(lean([]));
  mocks.allocateReferenceCode.mockResolvedValue("RUP-0001-K");
  mocks.invoiceCreate.mockImplementation(async () => ({ _id: new Types.ObjectId() }));
  mocks.applyCredit.mockResolvedValue(0);
  mocks.audit.mockResolvedValue(undefined);
});

describe("who is billable", () => {
  it("bills active residents and anyone who left during the period", async () => {
    // The current system only looks at who is here today, so a resident who left
    // on the 8th is never charged for those eight days.
    await findBillableResidents(hostelId, "2026-08");

    const filter = mocks.residentFind.mock.calls[0]![0] as {
      $or: Record<string, unknown>[];
    };

    expect(filter.$or).toEqual([
      { status: "ACTIVE" },
      {
        moveOutDate: { $gte: new Date("2026-08-01T00:00:00.000Z") },
        status: "MOVED_OUT",
      },
    ]);
  });

  it("does not bill PENDING residents", async () => {
    // A1 billed them, A2 did not. Resolved in A2's favour: a pending resident
    // has not been admitted, and an invoice for them enters their dunning queue.
    await findBillableResidents(hostelId, "2026-08");

    expect(JSON.stringify(mocks.residentFind.mock.calls[0]![0])).not.toContain("PENDING");
  });
});

describe("issuing invoices", () => {
  it("issues one invoice per resident, with a reference code", async () => {
    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(result.billed).toHaveLength(1);
    expect(result.totalBilled).toBe(12000);
    expect(result.billed[0]!.referenceCode).toBe("RUP-0001-K");

    const created = mocks.invoiceCreate.mock.calls[0]![0];

    expect(created).toMatchObject({
      kind: "MONTHLY_RENT",
      period: "2026-08",
      status: "OPEN",
      totalAmount: 12000,
    });
    expect(created.lines[0]).toMatchObject({ basis: "SCHEDULE", feeScheduleId: scheduleId });
  });

  it("defaults the due date to the end of the period", async () => {
    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.invoiceCreate.mock.calls[0]![0].dueDate).toEqual(
      new Date("2026-08-31T23:59:59.999Z"),
    );
  });

  it("prorates a mid-month move-in, which the bulk fee run never did", async () => {
    mocks.residentFind.mockReturnValue(
      lean([resident({ moveInDate: new Date("2026-08-17T00:00:00.000Z") })]),
    );

    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    // 15 of 31 days: 12000 / 31 * 15, rounded once.
    expect(mocks.invoiceCreate.mock.calls[0]![0].totalAmount).toBe(5806);
    expect(mocks.invoiceCreate.mock.calls[0]![0].lines[0].prorationBasis).toBe(
      "15/31 days",
    );
  });

  it("prorates a move-out, which no current path does at all", async () => {
    mocks.residentFind.mockReturnValue(
      lean([
        resident({
          moveOutDate: new Date("2026-08-08T00:00:00.000Z"),
          status: "MOVED_OUT",
        }),
      ]),
    );

    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.invoiceCreate.mock.calls[0]![0].lines[0].prorationBasis).toBe(
      "8/31 days",
    );
  });
});

describe("credit from an earlier overpayment", () => {
  it("comes off the new invoice as a negative line", async () => {
    // Target §9.4: the excess of an overpayment is not lost and not refunded —
    // it reduces the next invoice, visibly, as a line on the document rather
    // than an unexplained smaller total.
    mocks.applyCredit.mockResolvedValue(3000);

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    const update = mocks.invoiceUpdateOne.mock.calls[0]![1];

    expect(update.$push.lines).toMatchObject({ amount: -3000, basis: "CREDIT" });
    expect(update.$set.totalAmount).toBe(9000);
    expect(result.billed[0]!.amount).toBe(9000);
    expect(result.billed[0]!.creditApplied).toBe(3000);
  });

  it("touches nothing when the resident has no credit", async () => {
    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.invoiceUpdateOne).not.toHaveBeenCalled();
  });

  it("consumes the credit before discounting, so a crash cannot give a free discount", async () => {
    mocks.applyCredit.mockResolvedValue(3000);

    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.applyCredit).toHaveBeenCalledBefore(mocks.invoiceUpdateOne);
  });
});

describe("skips and failures are returned, never swallowed", () => {
  it("reports a resident whose bed type has no rate instead of billing zero", async () => {
    // The old `monthlyFee || defaultAmount || 0` chain billed this resident
    // nothing and nobody found out until somebody asked in November.
    mocks.residentFind.mockReturnValue(
      lean([resident({ bedType: "SINGLE", roomType: "Single" })]),
    );

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      {
        errorCode: "BED_TYPE_NOT_PRICED",
        message: expect.stringContaining("SINGLE"),
        residentId: residentA.toString(),
      },
    ]);
  });

  it("reports an unmappable room type rather than guessing a rate", async () => {
    mocks.residentFind.mockReturnValue(
      lean([resident({ bedType: null, roomType: "Shared" })]),
    );

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    // "Shared" does not say how many people share. §7.3: report, do not guess.
    expect(result.failures[0]!.errorCode).toBe("BED_TYPE_NOT_PRICED");
    expect(result.billed).toHaveLength(0);
  });

  it("skips a resident who moved out before the period, with the reason", async () => {
    mocks.residentFind.mockReturnValue(
      lean([
        resident({
          moveOutDate: new Date("2026-07-04T00:00:00.000Z"),
          status: "MOVED_OUT",
        }),
      ]),
    );

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(result.skipped).toEqual([
      {
        detail: "already moved out",
        reason: "ALREADY_MOVED_OUT",
        residentId: residentA.toString(),
      },
    ]);
  });

  it("skips a deliberate zero rate rather than issuing an empty invoice", async () => {
    // Zero is a legitimate override — a staff member's child — and it is a skip
    // with a reason, not a zero-rupee invoice and not a silent omission.
    mocks.residentFind.mockReturnValue(lean([resident({ monthlyFee: 0 })]));

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(result.skipped[0]!.reason).toBe("ZERO_CHARGE");
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  it("bills the residents it can while reporting the ones it cannot", async () => {
    mocks.residentFind.mockReturnValue(
      lean([resident(), resident({ _id: residentB, bedType: "SINGLE" })]),
    );

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(result.billed).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
  });
});

describe("re-running", () => {
  it("is a no-op when every resident is already billed", async () => {
    mocks.invoiceFind.mockReturnValue(lean([{ residentId: residentA }]));

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
    expect(result.billed).toHaveLength(0);
    expect(result.skipped[0]!.reason).toBe("ALREADY_BILLED");
  });

  it("does not consume a reference code for an invoice it will not issue", async () => {
    // Codes are permanent and sequential; burning one per skipped resident on
    // every re-run would leave gaps that look like deleted invoices.
    mocks.invoiceFind.mockReturnValue(lean([{ residentId: residentA }]));

    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.allocateReferenceCode).not.toHaveBeenCalled();
  });

  it("treats a lost race on the double-billing index as a skip, not an error", async () => {
    // Two concurrent runs. The unique index is the referee, and the loser must
    // not fail the whole run — the resident is billed exactly once, which is
    // what was wanted.
    mocks.invoiceCreate.mockRejectedValue({ code: 11000 });

    const result = await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(result.skipped[0]!.reason).toBe("ALREADY_BILLED");
    expect(result.billed).toHaveLength(0);
  });
});

describe("a missing fee schedule", () => {
  it("fails the whole run without issuing a single invoice", async () => {
    mocks.scheduleFindOne.mockReturnValue(lean(null));
    mocks.residentFind.mockReturnValue(
      lean([resident(), resident({ _id: residentB, monthlyFee: 9000 })]),
    );

    await expect(
      runBillingCycle({ hostelId, period: "2026-08" }, principal),
    ).rejects.toMatchObject({ errorCode: "FEE_SCHEDULE_MISSING" });

    // Not even the resident with an override, who could have been priced: half a
    // billing month is harder to reason about than none of it.
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  it("stops before billing when the hostel has no reference prefix", async () => {
    mocks.hostelFindOne.mockReturnValue(lean({ referencePrefix: null }));
    mocks.allocateReferenceCode.mockRejectedValue(
      Object.assign(new Error("no prefix"), { errorCode: "REFERENCE_PREFIX_MISSING" }),
    );

    await expect(
      runBillingCycle({ hostelId, period: "2026-08" }, principal),
    ).rejects.toMatchObject({ errorCode: "REFERENCE_PREFIX_MISSING" });
  });
});

describe("the monthly run across every hostel", () => {
  const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");

  beforeEach(() => {
    mocks.hostelFind.mockReturnValue(
      lean([
        { _id: hostelId, name: "Rupa Hostel" },
        { _id: otherHostelId, name: "Green View" },
      ]),
    );
  });

  it("keeps billing after a hostel that cannot be billed at all", async () => {
    // Green View configures one room type — the string "Shared", which does not
    // say how many people share — so it has no fee schedule and fails by design
    // (§7.3). Aborting the platform's billing over it would be absurd.
    mocks.scheduleFindOne
      .mockReturnValueOnce(lean(schedule))
      .mockReturnValueOnce(lean(null));

    const outcomes = await runBillingCycleForAllHostels("2026-08");

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ billedCount: 1, totalBilled: 12000 });
    expect(outcomes[1]).toMatchObject({
      billedCount: 0,
      errorCode: "FEE_SCHEDULE_MISSING",
      hostelName: "Green View",
    });
  });

  it("does not audit a run nobody performed", async () => {
    // `AuditLog.actorId` is required, and attributing a scheduled run to a real
    // person who did not perform it is worse than the gap. Block 5's
    // `ReconciliationRun` is where scheduled runs get recorded.
    await runBillingCycleForAllHostels("2026-08");

    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("derives the current period in UTC", () => {
    expect(periodOf(new Date("2026-08-07T18:30:00.000Z"))).toBe("2026-08");
    expect(periodOf(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
  });
});

describe("voiding an invoice", () => {
  const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");

  beforeEach(() => {
    mocks.invoiceFindOne.mockReturnValue(
      lean({ _id: invoiceId, hostelId, status: "OPEN", totalAmount: 12000 }),
    );
    mocks.invoiceUpdateOne.mockResolvedValue({});
    mocks.eventCount.mockResolvedValue(0);
  });

  it("cancels the obligation without erasing it", async () => {
    const result = await voidInvoice(invoiceId, { principal, reason: "billed twice" });

    expect(result.status).toBe("VOID");
    expect(mocks.invoiceUpdateOne.mock.calls[0]![1].$set).toMatchObject({
      status: "VOID",
      voidReason: "billed twice",
    });
  });

  it("refuses when the invoice has settled money", async () => {
    // Voiding a paid obligation orphans money that is really in the hostel's
    // account, and removes the only record of what it was for.
    mocks.eventCount.mockResolvedValue(1);

    await expect(
      voidInvoice(invoiceId, { principal, reason: "billed twice" }),
    ).rejects.toMatchObject({ errorCode: "INVOICE_HAS_SETTLED_PAYMENTS" });
    expect(mocks.invoiceUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses without a reason", async () => {
    await expect(
      voidInvoice(invoiceId, { principal, reason: "" }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("is a no-op on an already-voided invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(
      lean({ _id: invoiceId, hostelId, status: "VOID", totalAmount: 12000 }),
    );

    expect((await voidInvoice(invoiceId, { principal, reason: "again" })).status).toBe(
      "VOID",
    );
    expect(mocks.invoiceUpdateOne).not.toHaveBeenCalled();
  });

  it("cannot reach an invoice outside the caller's hostels", async () => {
    // Scoped in the query, so out-of-scope reads as missing (RULES.md §3).
    mocks.invoiceFindOne.mockReturnValue(lean(null));

    await expect(
      voidInvoice(invoiceId, { hostelIds: ["other"], principal, reason: "nope" }),
    ).rejects.toBeInstanceOf(Error);
    expect(mocks.invoiceFindOne.mock.calls[0]![0]).toMatchObject({
      hostelId: { $in: ["other"] },
    });
  });

  it("frees the period so it can be billed correctly", async () => {
    // The double-billing index excludes VOID precisely so a corrected invoice
    // can be issued for the same month.
    await voidInvoice(invoiceId, { principal, reason: "billed twice" });

    expect(mocks.audit).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        action: "INVOICE_VOIDED",
        amountAfter: 0,
        amountBefore: 12000,
      }),
    );
  });
});

describe("auditing", () => {
  it("records the run with the amount it billed", async () => {
    await runBillingCycle({ hostelId, period: "2026-08" }, principal);

    expect(mocks.audit).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        action: "BILLING_CYCLE_RUN",
        amountAfter: 12000,
        amountBefore: 0,
      }),
    );
  });
});
