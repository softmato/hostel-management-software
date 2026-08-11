/**
 * The payments screen's cross-month data: lifetime totals, the per-month
 * roll-up behind the month picker's badges, and the floor the picker cannot
 * walk past.
 *
 * The floor is the part worth pinning. It exists so an owner cannot page back
 * into months before the hostel was allowed to take money and be shown an empty
 * table with no explanation — but it must never hide a month that has real
 * invoices in it, which is the failure mode a naive "approval date" floor has.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventCount: vi.fn(),
  residentFind: vi.fn(),
  hostelFindOne: vi.fn(),
  listRecentInvoices: vi.fn(),
  verificationFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

vi.mock("@/modules/finance/ledger-read.service", () => ({
  listRecentInvoices: mocks.listRecentInvoices,
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/HostelVerification", () => ({
  HostelVerificationModel: { findOne: mocks.verificationFindOne },
}));

vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { countDocuments: mocks.eventCount },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));

import { getPeriodSummary } from "@/modules/finance/period-summary.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentA = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1").toString();
const residentB = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2").toString();

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    dueAmount: 10000,
    hostelId: hostelId.toString(),
    id: new Types.ObjectId().toString(),
    paidAmount: 0,
    period: "2026-08",
    residentId: residentA,
    status: "UNPAID",
    ...overrides,
  };
}

/** `months` back from today, as a period key. */
function periodAgo(months: number) {
  const date = new Date();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `months` forward from today, as a period key. */
function periodAhead(months: number) {
  return periodAgo(-months);
}

function dateAgo(months: number) {
  const date = new Date();

  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);

  return date;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verificationFindOne.mockReturnValue(chain({ verifiedAt: dateAgo(2) }));
  mocks.hostelFindOne.mockReturnValue(chain({ createdAt: dateAgo(3) }));
  mocks.listRecentInvoices.mockResolvedValue([]);
  mocks.eventCount.mockResolvedValue(0);
  mocks.residentFind.mockReturnValue(
    chain([{ _id: new Types.ObjectId(residentA) }, { _id: new Types.ObjectId(residentB) }]),
  );
});

describe("soft-deleted residents", () => {
  /**
   * Deleting a resident is soft, so their invoices stay in the ledger — an
   * audit trail may not lose rows. The bug this pins is every *reader* deciding
   * separately whether those rows count: the matrix excluded them and this
   * summary did not, so one screen showed August as "1 resident" and "2 needing
   * attention" at the same time.
   */
  it("counts only residents the hostel can still act on", async () => {
    await getPeriodSummary(hostelId);

    expect(mocks.residentFind).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: { $ne: true } }),
    );
    expect(mocks.listRecentInvoices).toHaveBeenCalledWith(
      expect.objectContaining({
        residentIds: [new Types.ObjectId(residentA), new Types.ObjectId(residentB)],
      }),
      expect.any(Number),
    );
  });

  it("scopes the pending-claim count the same way as the queue", async () => {
    // The card and the list beside it must agree, or a deleted resident's
    // pending claim shows as "1 pending" above an empty panel.
    await getPeriodSummary(hostelId);

    expect(mocks.eventCount).toHaveBeenCalledWith(
      expect.objectContaining({
        residentId: {
          $in: [new Types.ObjectId(residentA), new Types.ObjectId(residentB)],
        },
      }),
    );
  });
});

describe("the month floor", () => {
  it("starts at the month the hostel was approved", async () => {
    const summary = await getPeriodSummary(hostelId);

    expect(summary.earliestPeriod).toBe(periodAgo(2));
  });

  it("offers every month from approval to now, newest first", async () => {
    const summary = await getPeriodSummary(hostelId);

    expect(summary.months.map((month) => month.period)).toEqual([
      periodAgo(0),
      periodAgo(1),
      periodAgo(2),
    ]);
  });

  it("falls back to the hostel's creation date when no verification exists", async () => {
    // Hostels approved before verification records existed still need a floor,
    // and a hostel cannot have billed anyone before it existed.
    mocks.verificationFindOne.mockReturnValue(chain(null));

    const summary = await getPeriodSummary(hostelId);

    expect(summary.earliestPeriod).toBe(periodAgo(3));
  });

  it("reaches forward to rent that was billed ahead of time", async () => {
    // A hostel issuing September's invoices during August is ordinary. Pinning
    // the ceiling to today would leave that month — and its money — unreachable.
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ period: periodAhead(1), status: "UNPAID" }),
    ]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.months[0]!.period).toBe(periodAhead(1));
  });

  it("never hides a month that has real invoices in it", async () => {
    // A verification record written late would otherwise put genuine unpaid
    // invoices behind a floor the picker refuses to cross.
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ period: periodAgo(5), status: "OVERDUE" }),
    ]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.earliestPeriod).toBe(periodAgo(5));
    expect(summary.months.map((month) => month.period)).toContain(periodAgo(5));
  });
});

describe("the month badges", () => {
  it("counts only invoices that still want a human", async () => {
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ status: "UNPAID" }),
      invoice({ status: "OVERDUE" }),
      invoice({ status: "PENDING_PROOF" }),
      invoice({ status: "PARTIAL" }),
      invoice({ paidAmount: 10000, status: "PAID" }),
    ]);

    const august = (await getPeriodSummary(hostelId)).months.find(
      (month) => month.period === "2026-08",
    );

    expect(august?.needsAttention).toBe(4);
    expect(august?.paid).toBe(1);
    expect(august?.total).toBe(5);
  });

  it("gives a month with nothing billed a zero rather than omitting it", async () => {
    const summary = await getPeriodSummary(hostelId);

    expect(summary.months.every((month) => month.total === 0)).toBe(true);
    expect(summary.months).toHaveLength(3);
  });
});

describe("the lifetime totals", () => {
  it("sums across every month, not the selected one", async () => {
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ dueAmount: 10000, paidAmount: 10000, period: periodAgo(2), status: "PAID" }),
      invoice({ dueAmount: 10000, paidAmount: 4000, period: periodAgo(1), status: "PARTIAL" }),
      invoice({ dueAmount: 12000, paidAmount: 0, period: periodAgo(0), status: "UNPAID" }),
    ]);

    const { overall } = await getPeriodSummary(hostelId);

    expect(overall.collected).toBe(14000);
    expect(overall.due).toBe(32000);
    expect(overall.outstanding).toBe(18000);
    expect(overall.paid).toBe(1);
    expect(overall.partial).toBe(1);
    expect(overall.unpaid).toBe(1);
  });

  it("counts overdue residents, not overdue invoices", async () => {
    // Three unpaid months is one person to call, and the card says "Overdue
    // Residents".
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ period: periodAgo(0), residentId: residentA, status: "OVERDUE" }),
      invoice({ period: periodAgo(1), residentId: residentA, status: "OVERDUE" }),
      invoice({ period: periodAgo(2), residentId: residentB, status: "OVERDUE" }),
    ]);

    const { overall } = await getPeriodSummary(hostelId);

    expect(overall.overdueResidents).toBe(2);
  });

  it("reports pending claims from the event ledger", async () => {
    mocks.eventCount.mockResolvedValue(3);

    const { overall } = await getPeriodSummary(hostelId);

    expect(overall.pendingProofs).toBe(3);
    expect(mocks.eventCount).toHaveBeenCalledWith(
      expect.objectContaining({ source: "RESIDENT_CLAIM", status: "PENDING" }),
    );
  });
});
