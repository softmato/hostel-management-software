/**
 * The portal boundary — Block 2 item 2.8 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md, §2.8.1 "Screen vocabulary".
 *
 * These tests exist because this boundary is **invisible to the compiler**. A
 * route's response type is a caller-side generic, so a service that returns
 * `period` where the screen reads `month` type-checks perfectly and renders
 * blank cells. That is exactly what happened twice during 2.8 — once on the
 * matrix row shape, once on `month` itself — and both were found by reading the
 * render code rather than by any tool.
 *
 * Every assertion below is a field name a screen depends on. Changing one is a
 * breaking change to the portal, and Block 3 is where they change together.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCurrentResident: vi.fn(),
  hostelFindById: vi.fn(),
  invoiceFind: vi.fn(),
  scheduleFindOne: vi.fn(),
  listRecentInvoices: vi.fn(),
  listResidentInvoices: vi.fn(),
  listReviewQueue: vi.fn(),
  receiptFind: vi.fn(),
  residentFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/credit-balance.service", () => ({
  getCreditAmount: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/modules/finance/ledger-read.service", () => ({
  listRecentInvoices: mocks.listRecentInvoices,
  listResidentInvoices: mocks.listResidentInvoices,
}));

vi.mock("@/modules/finance/review.service", () => ({
  listReviewQueue: mocks.listReviewQueue,
}));

vi.mock("@/modules/residents/resident-access", () => ({
  findCurrentResident: mocks.findCurrentResident,
}));

/*
 * The matrix prices its unbilled rows, so it now reads the rate card and the
 * hostel's listed room rents. Both are mocked at the **model**, not at
 * `fee-schedule.service`: the arithmetic that turns a rate into a projected
 * amount is the thing worth exercising here, and stubbing the service would
 * leave these tests asserting a mock's opinion of what a resident owes.
 */
vi.mock("@hostel/db/models/FeeSchedule", () => ({
  FeeScheduleModel: { findOne: mocks.scheduleFindOne },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findById: mocks.hostelFindById },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { find: mocks.invoiceFind },
}));

vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: { find: mocks.receiptFind },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));

import {
  getInvoiceMatrix,
  getResidentFinanceView,
  toPortalInvoice,
} from "@/modules/finance/invoice-list.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");

const ledgerInvoice = {
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  dueAmount: 12000,
  dueDate: new Date("2026-08-31T00:00:00.000Z"),
  hostelId: hostelId.toString(),
  id: invoiceId.toString(),
  method: "BANK_TRANSFER",
  paidAmount: 5000,
  paidDate: new Date("2026-08-10T00:00:00.000Z"),
  period: "2026-08",
  residentId: residentId.toString(),
  status: "PARTIAL",
};

function lean<T>(rows: T) {
  return {
    lean: vi.fn().mockResolvedValue(rows),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCurrentResident.mockResolvedValue({ _id: residentId, hostelId });
  mocks.listResidentInvoices.mockResolvedValue([ledgerInvoice]);
  mocks.listRecentInvoices.mockResolvedValue([ledgerInvoice]);
  mocks.listReviewQueue.mockResolvedValue([]);
  mocks.invoiceFind.mockReturnValue(lean([]));
  mocks.hostelFindById.mockReturnValue(lean(null));
  mocks.scheduleFindOne.mockReturnValue(lean(null));
  mocks.receiptFind.mockReturnValue(lean([]));
  mocks.residentFind.mockReturnValue(lean([]));
});

describe("toPortalInvoice — the screens' field names", () => {
  it("renames period to month", () => {
    // The facade says `period`; every screen has said `month` since it was
    // built, and each of the older consumers renames it in its own serializer.
    expect(toPortalInvoice(ledgerInvoice).month).toBe("2026-08");
  });

  it("keeps the amounts under the names the screens read", () => {
    expect(toPortalInvoice(ledgerInvoice)).toMatchObject({
      dueAmount: 12000,
      id: invoiceId.toString(),
      method: "BANK_TRANSFER",
      paidAmount: 5000,
      status: "PARTIAL",
    });
  });

  it("does not leak `period` alongside `month`", () => {
    // Two names for one value is how a screen ends up reading the stale one.
    expect(toPortalInvoice(ledgerInvoice)).not.toHaveProperty("period");
  });
});

describe("the resident's view", () => {
  it("returns invoices and claims under the keys the page reads", async () => {
    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.month).toBe("2026-08");
    expect(Array.isArray(view.claims)).toBe(true);
  });

  it("hands the screen the receipt for a settled month", async () => {
    // The download link is the whole point of surfacing this: a resident who
    // needs proof of rent should not have to email the hostel for it.
    const receiptId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

    mocks.receiptFind.mockReturnValue(
      lean([
        {
          _id: receiptId,
          amount: 12000,
          invoiceId,
          receiptNumber: "RCP-EDU-2026-08-00001",
        },
      ]),
    );

    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.receipts).toEqual([
      {
        amount: 12000,
        id: receiptId.toString(),
        issuedAt: null,
        number: "RCP-EDU-2026-08-00001",
      },
    ]);
  });

  it("keeps every receipt on a month paid in instalments", async () => {
    // One receipt per settled *payment*, so a month paid twice has two — and the
    // earlier one used to vanish from the screen the moment the second was
    // issued, which is precisely when the resident goes looking for it.
    const first = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");
    const second = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e2");

    mocks.receiptFind.mockReturnValue(
      lean([
        {
          _id: second,
          amount: 11940,
          invoiceId,
          issuedAt: new Date("2026-08-11T00:00:00.000Z"),
          receiptNumber: "RCP-EDU-2026-08-00002",
        },
        {
          _id: first,
          amount: 60,
          invoiceId,
          issuedAt: new Date("2026-08-05T00:00:00.000Z"),
          receiptNumber: "RCP-EDU-2026-08-00001",
        },
      ]),
    );

    const view = await getResidentFinanceView({} as never);

    // Newest first, and both reachable.
    expect(view.invoices[0]!.receipts.map((receipt) => receipt.number)).toEqual([
      "RCP-EDU-2026-08-00002",
      "RCP-EDU-2026-08-00001",
    ]);
    expect(view.invoices[0]!.receipts[1]!.amount).toBe(60);
  });

  it("carries the reference code onto the payments page", async () => {
    // The Resident Offer Program banner names the code for the open month, so it
    // has to reach the screen without opening the pay panel — which is where the
    // code used to live, and where a resident paying from habit never goes.
    mocks.invoiceFind.mockReturnValue(
      lean([{ _id: invoiceId, referenceCode: "EDU-0001-F" }]),
    );

    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.referenceCode).toBe("EDU-0001-F");
  });

  it("reports no code rather than guessing when the invoice has none", async () => {
    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.referenceCode).toBeNull();
  });

  it("explains what the month is made of", async () => {
    // Until this landed, a resident could see *what* they owed and never *why*:
    // `Invoice.lines` held the breakdown and `toPortalInvoice` dropped it, so a
    // pro-rated first month or an admission fee was indistinguishable from a
    // billing mistake.
    mocks.invoiceFind.mockReturnValue(
      lean([
        {
          _id: invoiceId,
          lines: [
            {
              amount: 12000,
              basis: "SCHEDULE",
              bedType: "DOUBLE",
              description: "Room rent",
              feeScheduleId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1"),
              prorationBasis: "18/31 days",
            },
            {
              amount: -1000,
              basis: "CREDIT",
              description: "Carried credit",
            },
          ],
          referenceCode: "EDU-0001-F",
        },
      ]),
    );

    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.lines).toEqual([
      {
        amount: 12000,
        basis: "SCHEDULE",
        bedType: "DOUBLE",
        description: "Room rent",
        prorationBasis: "18/31 days",
      },
      // A credit line stays negative — the sign is the meaning (target §9.4),
      // and an absolute value here would read as a second charge.
      {
        amount: -1000,
        basis: "CREDIT",
        bedType: null,
        description: "Carried credit",
        prorationBasis: null,
      },
    ]);
  });

  it("does not hand the resident the fee schedule id", async () => {
    // Internal tracing handle: it means nothing to a resident and there is no
    // route that would resolve it.
    mocks.invoiceFind.mockReturnValue(
      lean([
        {
          _id: invoiceId,
          lines: [
            {
              amount: 12000,
              basis: "SCHEDULE",
              description: "Room rent",
              feeScheduleId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1"),
            },
          ],
        },
      ]),
    );

    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.lines[0]).not.toHaveProperty("feeScheduleId");
  });

  it("returns an empty breakdown rather than undefined for an invoice with no lines", async () => {
    // Migrated history has none, and a screen mapping over `undefined` throws.
    const view = await getResidentFinanceView({} as never);

    expect(view.invoices[0]!.lines).toEqual([]);
  });

  it("never offers a voided receipt", async () => {
    // A receipt voided with its reversed payment must stop being downloadable,
    // or the resident keeps a document asserting money the ledger dropped.
    await getResidentFinanceView({} as never);

    expect(mocks.receiptFind).toHaveBeenCalledWith(
      expect.objectContaining({ residentId, voidedAt: null }),
    );
  });

  it("scopes the read to the caller's own resident record", async () => {
    await getResidentFinanceView({} as never);

    expect(mocks.listResidentInvoices).toHaveBeenCalledWith({ hostelId, residentId });
  });
});

describe("the admin matrix", () => {
  beforeEach(() => {
    mocks.residentFind.mockReturnValue(
      lean([
        {
          _id: residentId,
          firstName: "Asha",
          lastName: "Rai",
          moveInDate: new Date("2026-08-17T00:00:00.000Z"),
          phone: "9800000000",
          roomNumber: "201",
        },
      ]),
    );
  });

  it("names the row fields the way the screen renders them", async () => {
    mocks.invoiceFind.mockReturnValue(
      lean([{ _id: invoiceId, period: "2026-08", residentId, status: "PARTIAL" }]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    // `payment` and `resident`, not `invoice` and `residentId`.
    expect(matrix.rows[0]).toMatchObject({
      displayStatus: "PARTIAL",
      payment: { dueAmount: 12000, month: "2026-08" },
      resident: { fullName: "Asha Rai", phone: "9800000000" },
    });
    expect(matrix.month).toBe("2026-08");
  });

  it("gives moveInDate as an ISO string, which the pro-rated flag compares", async () => {
    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    // The screen does `moveInDate.startsWith(month)`, so a Date here would throw.
    expect(matrix.rows[0]!.resident.moveInDate).toBe("2026-08-17T00:00:00.000Z");
  });

  it("shows a resident with no invoice as NOT_BILLED rather than inventing one", async () => {
    // The predecessor of this function billed them instead (item 2.5).
    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.rows[0]).toMatchObject({ displayStatus: "NOT_BILLED", payment: null });
    expect(matrix.totals.notBilled).toBe(1);
  });

  it("says what an unbilled row would cost, and that nothing has run yet", async () => {
    /*
     * "Not billed" on its own is a dead end for the reader: it says neither how
     * much this resident owes for the month nor whether anybody has to act. The
     * projection is the billing run's own arithmetic — a 17 August move-in is
     * 15/31 of 12,000 — and it is a projection, not a debt: `payment` stays null
     * and nothing is written.
     */
    mocks.scheduleFindOne.mockReturnValue(
      lean({
        _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1"),
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        hostelId,
        rates: [{ bedType: "DOUBLE_SHARING", monthlyAmount: 12000 }],
      }),
    );
    mocks.residentFind.mockReturnValue(
      lean([
        {
          _id: residentId,
          bedType: "DOUBLE_SHARING",
          firstName: "Asha",
          lastName: "Rai",
          moveInDate: new Date("2026-08-17T00:00:00.000Z"),
          phone: "9800000000",
        },
      ]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.rows[0]!.notBilled).toEqual({ amount: 5806, reason: "NOT_YET_RUN" });
    expect(matrix.rows[0]!.payment).toBeNull();
  });

  it("names the reason when nothing can price the resident at all", async () => {
    // No rate card and no listed rent for the room type. The amount is null
    // rather than zero — nobody knows what this costs, and a zero would read as
    // "they owe nothing", which is a different and false claim.
    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.rows[0]!.notBilled).toEqual({
      amount: null,
      reason: "FEE_SCHEDULE_MISSING",
    });
  });

  it("prices an unbilled row from the hostel's listed rent when there is no card", async () => {
    mocks.hostelFindById.mockReturnValue(
      lean({ roomConfigurations: [{ monthlyRent: 6200, roomType: "Shared" }] }),
    );
    mocks.residentFind.mockReturnValue(
      lean([
        {
          _id: residentId,
          firstName: "Asha",
          lastName: "Rai",
          moveInDate: new Date("2026-08-01T00:00:00.000Z"),
          roomType: "Shared",
        },
      ]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.rows[0]!.notBilled).toEqual({ amount: 6200, reason: "NOT_YET_RUN" });
  });

  it("carries no projection on a row that already has an invoice", async () => {
    // `notBilled` answers "why is there no invoice". There is one.
    mocks.invoiceFind.mockReturnValue(
      lean([{ _id: invoiceId, period: "2026-08", residentId, status: "PARTIAL" }]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.rows[0]!.notBilled).toBeNull();
  });

  it("does not list a resident in a month they had not moved into yet", async () => {
    /*
     * The July-hostel / August-resident case. Before this, the query asked for
     * the whole roster with no reference to the period, so somebody who moved in
     * on 17 August was drawn on July's matrix as an unbilled debtor — a red
     * count against a month they did not live there for.
     *
     * The filter is Mongo's, so what is asserted is the query: the period's last
     * instant, and an explicit allowance for a resident whose start date is
     * simply unknown.
     */
    await getInvoiceMatrix(hostelId, "2026-07");

    expect(mocks.residentFind).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { moveInDate: { $lte: new Date("2026-07-31T23:59:59.999Z") } },
          { moveInDate: null },
          { moveInDate: { $exists: false } },
        ],
      }),
    );
  });

  it("does not put a resident who has not been admitted on the owing list", async () => {
    /*
     * `PENDING` used to be in this filter alongside `ACTIVE`, and the row it
     * produced was unclearable: nothing bills a resident who has not been
     * admitted, so they sat in **Owing** marked `NOT_BILLED` for ever and
     * inflated the count the screen exists to state.
     *
     * The filter is Mongo's, so what is asserted is the query.
     */
    await getInvoiceMatrix(hostelId, "2026-08");

    expect(mocks.residentFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE" }),
    );
  });

  it("totals under `due` and `collected`, which the metric cards read", async () => {
    mocks.invoiceFind.mockReturnValue(
      lean([{ _id: invoiceId, period: "2026-08", residentId, status: "PARTIAL" }]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.totals).toMatchObject({ collected: 5000, due: 12000 });
  });
});

describe("the matrix and soft-deleted residents", () => {
  /**
   * The matrix deliberately keeps a resident who left mid-period: they were
   * billed, and dropping the row would hide money still owed. That lookup had
   * no `isDeleted` guard, so it also resurrected residents who had been
   * *deleted* — the payments screen listed two people while the dashboard,
   * which filters properly, counted one. Deletion means gone from the product,
   * not gone unless they happen to owe something.
   */
  it("never pulls a deleted resident back in through their open invoice", async () => {
    const goneId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");

    mocks.residentFind.mockReturnValue(lean([]));
    mocks.invoiceFind.mockReturnValue(
      lean([
        {
          _id: invoiceId,
          period: "2026-08",
          residentId: goneId,
          status: "OPEN",
          totalAmount: 16839,
        },
      ]),
    );
    mocks.listRecentInvoices.mockResolvedValue([]);

    await getInvoiceMatrix(hostelId, "2026-08");

    expect(mocks.residentFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ isDeleted: { $ne: true } }),
    );
  });
});
