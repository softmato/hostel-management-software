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
  invoiceFind: vi.fn(),
  listRecentInvoices: vi.fn(),
  listResidentInvoices: vi.fn(),
  listReviewQueue: vi.fn(),
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

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { find: mocks.invoiceFind },
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
  return { lean: vi.fn().mockResolvedValue(rows), select: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCurrentResident.mockResolvedValue({ _id: residentId, hostelId });
  mocks.listResidentInvoices.mockResolvedValue([ledgerInvoice]);
  mocks.listRecentInvoices.mockResolvedValue([ledgerInvoice]);
  mocks.listReviewQueue.mockResolvedValue([]);
  mocks.invoiceFind.mockReturnValue(lean([]));
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

  it("totals under `due` and `collected`, which the metric cards read", async () => {
    mocks.invoiceFind.mockReturnValue(
      lean([{ _id: invoiceId, period: "2026-08", residentId, status: "PARTIAL" }]),
    );

    const matrix = await getInvoiceMatrix(hostelId, "2026-08");

    expect(matrix.totals).toMatchObject({ collected: 5000, due: 12000 });
  });
});
