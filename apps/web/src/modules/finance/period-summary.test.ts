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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { addBsMonths, bsPeriodBounds, bsPeriodOf } from "@/lib/hostel-day";
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
    period: periodAgo(0),
    residentId: residentA,
    status: "UNPAID",
    ...overrides,
  };
}

/**
 * The clock these expectations are written against.
 *
 * Frozen, and not for flake: these helpers used to step a **Gregorian** month
 * off `new Date()` and compare the result against periods the service derives,
 * so they agreed only while both sides were Gregorian. Stepping a BS month off a
 * moving "today" would put the test's own month arithmetic back in competition
 * with the module's.
 *
 * 5 September 2026 is Bhadra 20, 2083 — Bhadra 2083 runs 17 August to 16
 * September 2026, which is the anchor `bs-calendar.test.ts` pins against a
 * published Nepali calendar rather than against this module's own output.
 */
const NOW = new Date("2026-09-05T06:00:00.000Z");
const CURRENT_PERIOD = "2083-05";

/**
 * `months` back from the frozen month, as a period key.
 *
 * Bikram Sambat months, because that is what an `Invoice.period` is. The
 * distance is real calendar arithmetic and not a subtraction on a number:
 * `2083-01` minus one month is `2082-12`, and a BS year ends at Chaitra.
 */
function periodAgo(months: number) {
  return addBsMonths(CURRENT_PERIOD, -months);
}

/** `months` forward from the frozen month, as a period key. */
function periodAhead(months: number) {
  return addBsMonths(CURRENT_PERIOD, months);
}

/**
 * An instant inside the BS month `periodAgo(months)` names.
 *
 * The month's own first day, so `hostelPeriodOf` reads it back as exactly that
 * period. Anything else — the 1st of some Gregorian month, which is what this
 * built before — lands in whichever BS month happens to straddle it, and the
 * verification date the service reads would then floor the picker a month away
 * from the one the assertion names. BS month lengths run 29 to 32 days and vary
 * by year, so there is no offset that makes the two line up by construction.
 */
function dateAgo(months: number) {
  return bsPeriodBounds(periodAgo(months)).start;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only `Date`. Faking timers wholesale would stall the awaited mocks below.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  mocks.verificationFindOne.mockReturnValue(chain({ verifiedAt: dateAgo(2) }));
  mocks.hostelFindOne.mockReturnValue(chain({ createdAt: dateAgo(3) }));
  mocks.listRecentInvoices.mockResolvedValue([]);
  mocks.eventCount.mockResolvedValue(0);
  mocks.residentFind.mockReturnValue(
    chain([{ _id: new Types.ObjectId(residentA) }, { _id: new Types.ObjectId(residentB) }]),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The anchor the rest of this file leans on, asserted rather than assumed.
 *
 * Without it every expectation below is self-consistent and could still be
 * naming the wrong month: `periodAgo` and the service would agree with each
 * other while both sat a month off the calendar a hostel actually bills in.
 */
it("bills the frozen day into Bhadra 2083", () => {
  expect(bsPeriodOf(NOW)).toBe(CURRENT_PERIOD);
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

    const bhadra = (await getPeriodSummary(hostelId)).months.find(
      (month) => month.period === periodAgo(0),
    );

    expect(bhadra?.needsAttention).toBe(4);
    expect(bhadra?.paid).toBe(1);
    expect(bhadra?.total).toBe(5);
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

  it("keeps a one-off's money in the lifetime total", async () => {
    // An admission fee is real revenue with no month attached. It must not be
    // dropped from `overall` just because the roll-up below has nowhere to put
    // it — the hero on the mobile app draws its headline off this figure.
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ dueAmount: 5000, paidAmount: 5000, period: null, status: "PAID" }),
      invoice({ dueAmount: 10000, paidAmount: 10000, period: periodAgo(0), status: "PAID" }),
    ]);

    const { overall } = await getPeriodSummary(hostelId);

    expect(overall.collected).toBe(15000);
    expect(overall.due).toBe(15000);
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

/**
 * The defect: taking in a resident raised an admission-fee invoice, which the
 * `Invoice` schema stores with `period: null` because a joining fee is not rent
 * *for a month*. That row then reached the roll-up, where two things went wrong
 * at once — it became a `Map` entry keyed on `null`, and the descending sort
 * coerced that `null` to the string `"null"`, which every `YYYY-MM` sorts before.
 *
 * `months[0]` therefore stopped being the newest month and became a phantom row
 * with no period and nothing collected. Every caller that reads "this month" off
 * the front of the list — the admin Home hero on mobile above all — showed the
 * hostel zero from the moment its first resident was registered.
 */
describe("invoices that belong to no month", () => {
  it("leaves the newest real month at the front of the roll-up", async () => {
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ dueAmount: 5000, paidAmount: 5000, period: null, status: "PAID" }),
      invoice({ dueAmount: 10000, paidAmount: 10000, period: periodAgo(0), status: "PAID" }),
    ]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.months[0]!.period).toBe(periodAgo(0));
    expect(summary.months[0]!.collected).toBe(10000);
  });

  it("never emits a row without a period", async () => {
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ period: null, status: "UNPAID" }),
      invoice({ period: periodAgo(1), status: "UNPAID" }),
    ]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.months.every((month) => typeof month.period === "string")).toBe(true);
    expect(summary.months).toHaveLength(3);
  });

  it("does not let one drag the month floor or ceiling anywhere", async () => {
    // `null` sorts outside the `YYYY-MM` range in both directions depending on
    // how it is coerced; either end would build a picker full of empty months.
    mocks.listRecentInvoices.mockResolvedValue([invoice({ period: null })]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.earliestPeriod).toBe(periodAgo(2));
    expect(summary.months.map((month) => month.period)).toEqual([
      periodAgo(0),
      periodAgo(1),
      periodAgo(2),
    ]);
  });

  it("keeps it out of the month badges", async () => {
    // The table under the picker is `getInvoiceMatrix`, which filters on
    // `period` — a period-less invoice can never appear in it, so counting one
    // in a month's badge is a number with no row behind it.
    mocks.listRecentInvoices.mockResolvedValue([
      invoice({ period: null, status: "UNPAID" }),
      invoice({ period: periodAgo(0), status: "UNPAID" }),
    ]);

    const summary = await getPeriodSummary(hostelId);

    expect(summary.months[0]!.needsAttention).toBe(1);
    expect(summary.months[0]!.total).toBe(1);
  });
});
