import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Discounting a month whose bills have already gone out.
 *
 * Every case here is one afternoon in a hostel office: the cron billed Kartik on
 * Kartik 1, the owner decided Dashain on Kartik 5, and by then one resident had
 * paid nothing, one had paid part and one had paid the lot. All three have to end
 * up owing the same *half* — the difference is only where the money that has
 * already moved ends up.
 */

const KARTIK = "2083-06";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  balanceFindOne: vi.fn(),
  invoiceFind: vi.fn(),
  recomputeInvoiceBalance: vi.fn(),
  setConcessionCredit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

vi.mock("@/modules/finance/audit-finance", () => ({
  auditFinanceAction: mocks.audit,
}));

vi.mock("@/modules/finance/credit-balance.service", () => ({
  setConcessionCredit: mocks.setConcessionCredit,
}));

/*
 * Stubbed, unlike `discountRent` beside it. What it does is re-derive a status
 * from payment events, which is another module's subject and has its own suite;
 * what this file is about is which number lands on the invoice, so the settled
 * figure is an input here rather than something to build a ledger for.
 */
vi.mock("@/modules/finance/payment-event.service", () => ({
  recomputeInvoiceBalance: mocks.recomputeInvoiceBalance,
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { find: mocks.invoiceFind },
}));

vi.mock("@hostel/db/models/InvoiceBalance", () => ({
  InvoiceBalanceModel: { findOne: mocks.balanceFindOne },
}));

import { applyConcessionToIssuedInvoices } from "@/modules/finance/rent-concession-backfill";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");

type Line = {
  amount: number;
  basis: string;
  concessionPercent?: number;
  description: string;
};

/** A saved invoice document, with the `save()` the service goes through. */
function invoice(lines: Line[]) {
  const document = {
    _id: new Types.ObjectId(),
    hostelId,
    lines,
    residentId: new Types.ObjectId(),
    save: vi.fn(async () => document),
    totalAmount: lines.reduce((sum, line) => sum + line.amount, 0),
  };

  return document;
}

/** The rent line the billing run writes: one month, one room type, full price. */
function rentOf(amount: number): Line {
  return {
    amount,
    basis: "SCHEDULE",
    description: "Monthly rent — Kartik 2083",
  };
}

function lean<T>(rows: T) {
  return {
    lean: vi.fn().mockResolvedValue(rows),
    select: vi.fn().mockReturnThis(),
  };
}

/** How much has settled against every invoice in the case being set up. */
function settled(amount: number) {
  mocks.recomputeInvoiceBalance.mockResolvedValue({ settledAmount: amount });
  mocks.balanceFindOne.mockReturnValue(lean({ settledAmount: amount }));
}

beforeEach(() => {
  vi.clearAllMocks();
  settled(0);
  mocks.setConcessionCredit.mockResolvedValue(0);
});

describe("discounting a month that is already billed", () => {
  it("adds a negative line and leaves the rent line as issued", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    expect(bill.totalAmount).toBe(4_000);
    expect(bill.lines).toHaveLength(2);
    // The bill still says what the rent was. That is the point of a line rather
    // than an edit: "what was the rent in Kartik" stays answerable.
    expect(bill.lines[0]).toMatchObject({ amount: 8_000, basis: "SCHEDULE" });
    expect(bill.lines[1]).toMatchObject({ amount: -4_000, concessionPercent: 50 });
    expect(bill.lines[1]?.description).toContain("Dashain");
    expect(bill.save).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ discounted: 4_000, invoicesChanged: 1 });
  });

  it("moves the line instead of stacking a second when the percent changes", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });
    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 40,
      period: KARTIK,
      reason: "Dashain",
    });

    // 8,000 less 40%, not 8,000 less 50% less another 40% of what was left.
    expect(bill.lines).toHaveLength(2);
    expect(bill.totalAmount).toBe(4_800);
    expect(bill.lines[1]).toMatchObject({ amount: -3_200, concessionPercent: 40 });
  });

  it("is a no-op when re-run with the same percent", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });
    const second = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    expect(bill.totalAmount).toBe(4_000);
    expect(bill.save).toHaveBeenCalledOnce();
    expect(second.invoicesChanged).toBe(0);
  });

  it("discounts the rent only, never credit the resident already had", async () => {
    // Billed 8,000 with 1,000 of earlier overpayment applied: they owed 7,000.
    // Half of the *rent* is 4,000 off, so 3,000 is left — not half of 7,000.
    const bill = invoice([
      rentOf(8_000),
      { amount: -1_000, basis: "CREDIT", description: "Credit from earlier overpayment" },
    ]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: null,
    });

    expect(bill.totalAmount).toBe(3_000);
  });

  it("never takes a bill below zero", async () => {
    const bill = invoice([
      rentOf(8_000),
      { amount: -6_000, basis: "CREDIT", description: "Credit from earlier overpayment" },
    ]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 100,
      period: KARTIK,
      reason: "Flood",
    });

    // A free month on a bill already 6,000 in credit owes nothing — it does not
    // owe the hostel money *to* the resident.
    expect(bill.totalAmount).toBe(0);
  });
});

describe("money that has already been paid", () => {
  it("turns a part payment over the new total into credit", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);
    settled(5_000);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    // 5,000 paid against a bill now worth 4,000 — the 1,000 over goes forward.
    expect(mocks.setConcessionCredit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1_000, invoiceId: bill._id }),
    );
    expect(result.refundedAsCredit).toBe(1_000);
  });

  it("turns a fully paid month into credit for the whole discount", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);
    settled(8_000);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    expect(result.refundedAsCredit).toBe(4_000);
  });

  it("credits nothing when nobody has paid", async () => {
    const bill = invoice([rentOf(8_000)]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    expect(mocks.setConcessionCredit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 0 }),
    );
  });
});

describe("withdrawing the discount", () => {
  it("puts an unpaid bill back to full rent", async () => {
    const bill = invoice([
      rentOf(8_000),
      { amount: -4_000, basis: "CREDIT", concessionPercent: 50, description: "Dashain · 50% off — Kartik 2083" },
    ]);
    mocks.invoiceFind.mockResolvedValue([bill]);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 0,
      period: KARTIK,
      reason: null,
    });

    expect(bill.totalAmount).toBe(8_000);
    expect(bill.lines).toHaveLength(1);
    expect(result).toMatchObject({ invoicesChanged: 1, invoicesKept: 0 });
  });

  it("leaves a part-paid bill at its discount", async () => {
    // The resident was told they owed 4,000 and sent 2,000. Putting the bill back
    // to 8,000 would be a larger bill arriving after a smaller one was paid
    // against — the correction a hostel cannot make politely.
    const bill = invoice([
      rentOf(8_000),
      { amount: -4_000, basis: "CREDIT", concessionPercent: 50, description: "Dashain · 50% off — Kartik 2083" },
    ]);
    mocks.invoiceFind.mockResolvedValue([bill]);
    settled(2_000);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 0,
      period: KARTIK,
      reason: null,
    });

    expect(bill.totalAmount).toBe(4_000);
    expect(bill.save).not.toHaveBeenCalled();
    expect(result).toMatchObject({ invoicesChanged: 0, invoicesKept: 1 });
  });
});

describe("a month with no bills yet", () => {
  it("does nothing and says so with zeroes", async () => {
    mocks.invoiceFind.mockResolvedValue([]);

    const result = await applyConcessionToIssuedInvoices({
      hostelId,
      percentOff: 50,
      period: KARTIK,
      reason: "Dashain",
    });

    // The healthy case: the billing run has not happened, so it will price
    // everybody at the reduced rent itself and there is nothing to correct.
    expect(result).toEqual({
      discounted: 0,
      invoicesChanged: 0,
      invoicesKept: 0,
      refundedAsCredit: 0,
    });
    expect(mocks.setConcessionCredit).not.toHaveBeenCalled();
  });
});
