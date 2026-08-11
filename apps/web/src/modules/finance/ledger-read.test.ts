/**
 * The ledger read facade — Block 2 items 2.4 and 2.8 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md.
 *
 * The `legacy` and `dual` branches are gone with `Payment` (item 2.8), and with
 * them the tests that compared the two sources. What remains is the risk that
 * outlives the cutover: **the facade must answer in the vocabulary its consumers
 * still speak.** `OPEN` is what the database calls it; `UNPAID` is what the
 * screens branch on, and a mismatch breaks them while passing every test that
 * only checks numbers. Block 3 moves the screens over one at a time, and until
 * then this translation is load-bearing.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceAggregate: vi.fn(),
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { aggregate: mocks.invoiceAggregate },
}));

import {
  countInvoicesByStatus,
  latestInvoicePerResident,
  ledgerFilterFor,
  legacyStatusFor,
  listResidentInvoices,
  outstandingForResident,
} from "@/modules/finance/ledger-read.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");

function ledgerRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: invoiceId,
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    dueDate: new Date("2026-08-31T00:00:00.000Z"),
    hasPendingClaim: false,
    hostelId,
    method: "BANK",
    paidAmount: 5000,
    paidDate: new Date("2026-08-10T00:00:00.000Z"),
    period: "2026-08",
    residentId,
    status: "PARTIAL",
    totalAmount: 12000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoiceAggregate.mockResolvedValue([]);
});

/** The `$match` the pipeline opens with — the ledger equivalent of a filter. */
function matchStageOf(call: unknown[]): Record<string, unknown> {
  const stages = call[0] as { $match?: Record<string, unknown> }[];

  return stages[0]!.$match!;
}

function stagesOf(call: unknown[]): Record<string, unknown>[] {
  return call[0] as Record<string, unknown>[];
}

describe("ledgerFilterFor — the translated invoice query", () => {
  it("excludes voided invoices from every read", () => {
    // A void is a decision to un-bill. It is not a balance of zero, and letting
    // one into a total would understate what a hostel billed.
    expect(ledgerFilterFor({})).toEqual({ status: { $ne: "VOID" } });
  });

  it("maps a period scope onto the invoice's own field", () => {
    expect(ledgerFilterFor({ period: "2026-08" })).toMatchObject({ period: "2026-08" });
    expect(ledgerFilterFor({ periods: ["2026-07", "2026-08"] })).toMatchObject({
      period: { $in: ["2026-07", "2026-08"] },
    });
  });

  it("narrows to the owing statuses when unsettledOnly is set", () => {
    expect(ledgerFilterFor({ unsettledOnly: true }).status).toEqual({
      $in: ["OPEN", "PARTIAL", "OVERDUE"],
    });
  });

  it("scopes by hostel, resident and id", () => {
    expect(ledgerFilterFor({ hostelId, residentId })).toMatchObject({
      hostelId,
      residentId,
    });
    expect(ledgerFilterFor({ invoiceIds: [invoiceId] })).toMatchObject({
      _id: { $in: [invoiceId] },
    });
  });

  it("does not put the settlement window on the invoice", () => {
    // `paidDate` is derived from an event and does not exist until the join has
    // run, so filtering on it here would silently match nothing.
    expect(ledgerFilterFor({ settledFrom: new Date() })).not.toHaveProperty("paidDate");
  });
});

describe("legacyStatusFor — the vocabulary the consumers still speak", () => {
  it.each([
    ["DRAFT", "UNPAID"],
    ["OPEN", "UNPAID"],
    ["PARTIAL", "PARTIAL"],
    ["OVERDUE", "OVERDUE"],
    ["PAID", "PAID"],
    ["WRITTEN_OFF", "WRITTEN_OFF"],
  ])("maps %s to %s", (invoiceStatus, legacy) => {
    expect(legacyStatusFor(invoiceStatus)).toBe(legacy);
  });

  it("reports a claim awaiting review as PENDING_PROOF", () => {
    expect(legacyStatusFor("OPEN", true)).toBe("PENDING_PROOF");
    expect(legacyStatusFor("PARTIAL", true)).toBe("PENDING_PROOF");
  });

  it("does not let a pending claim mask a settled or overdue invoice", () => {
    // Legacy never wrote PENDING_PROOF over these, and inventing it here would
    // hide an overdue invoice from the one list an owner chases.
    expect(legacyStatusFor("PAID", true)).toBe("PAID");
    expect(legacyStatusFor("OVERDUE", true)).toBe("OVERDUE");
  });
});

describe("reading the ledger", () => {
  it("answers from the invoice collection", async () => {
    await listResidentInvoices({ hostelId, residentId });

    expect(mocks.invoiceAggregate).toHaveBeenCalled();
  });

  it("returns an invoice in the shape the screens expect", async () => {
    mocks.invoiceAggregate.mockResolvedValue([ledgerRow({ status: "OPEN" })]);

    const [invoice] = await listResidentInvoices({ hostelId, residentId });

    expect(invoice).toMatchObject({
      dueAmount: 12000,
      // `totalAmount` and the settled-event sum, renamed at the boundary.
      method: "BANK_TRANSFER",
      paidAmount: 5000,
      period: "2026-08",
      status: "UNPAID",
    });
  });

  it("joins the balance cache and the latest settlement", async () => {
    await listResidentInvoices({ hostelId, residentId });

    const lookups = stagesOf(mocks.invoiceAggregate.mock.calls[0]!)
      .filter((stage) => "$lookup" in stage)
      .map((stage) => (stage.$lookup as { from: string }).from);

    expect(lookups).toEqual(["invoicebalances", "paymentevents", "paymentevents"]);
  });

  it("applies the settlement window after the join, not before", async () => {
    const settledFrom = new Date("2026-08-01T00:00:00.000Z");

    await listResidentInvoices({ hostelId, residentId, settledFrom });

    const stages = stagesOf(mocks.invoiceAggregate.mock.calls[0]!);
    const windowStage = stages.findIndex(
      (stage) =>
        "$match" in stage &&
        Object.hasOwn(stage.$match as Record<string, unknown>, "paidDate"),
    );
    const addFieldsStage = stages.findIndex((stage) => "$addFields" in stage);

    expect(windowStage).toBeGreaterThan(addFieldsStage);
  });

  it("sums outstanding per invoice, clamped, so an overpayment cannot cancel a debt", async () => {
    mocks.invoiceAggregate.mockResolvedValue([{ outstanding: 7000 }]);

    await expect(outstandingForResident({ hostelId, residentId })).resolves.toBe(7000);

    expect(matchStageOf(mocks.invoiceAggregate.mock.calls[0]!).status).toEqual({
      $in: ["OPEN", "PARTIAL", "OVERDUE"],
    });

    const group = stagesOf(mocks.invoiceAggregate.mock.calls[0]!).find(
      (stage) => "$group" in stage,
    );

    expect(JSON.stringify(group)).toContain("$max");
  });

  it("merges statuses that collapse to one word", async () => {
    // DRAFT and OPEN are both UNPAID. Grouping before translation and summing
    // after is the only way their counts survive.
    mocks.invoiceAggregate.mockResolvedValue([
      { _id: { hasPendingClaim: false, value: "DRAFT" }, count: 2 },
      { _id: { hasPendingClaim: false, value: "OPEN" }, count: 3 },
      { _id: { hasPendingClaim: true, value: "OPEN" }, count: 1 },
    ]);

    await expect(countInvoicesByStatus({ hostelId })).resolves.toEqual({
      PENDING_PROOF: 1,
      UNPAID: 5,
    });
  });

  it("keys the latest invoice per resident by resident, not by invoice", async () => {
    mocks.invoiceAggregate.mockResolvedValue([
      ledgerRow({ period: "2026-08" }),
      ledgerRow({ _id: new Types.ObjectId(), period: "2026-07" }),
    ]);

    const latest = await latestInvoicePerResident([residentId]);

    expect(latest.size).toBe(1);
    expect(latest.get(residentId.toString())?.period).toBe("2026-08");
  });
});


describe("ledgerFilterFor casts ids for the aggregation pipeline", () => {
  /**
   * Mongoose casts `find()` filters against the schema. It does **not** cast an
   * aggregation `$match`, and this filter is only ever spent inside one. A
   * caller holding an id as a string — anything out of a URL segment, a JSON
   * body or a `toString()` — therefore matched nothing at all, with no error:
   * the owner's per-resident history rendered "NOT BILLED" for every month of a
   * resident who had three invoices.
   */
  it("turns a string residentId into an ObjectId", () => {
    const filter = ledgerFilterFor({ residentId: residentId.toString() });

    expect(filter.residentId).toBeInstanceOf(Types.ObjectId);
    expect(String(filter.residentId)).toBe(residentId.toString());
  });

  it("turns a string hostelId into an ObjectId", () => {
    const filter = ledgerFilterFor({ hostelId: hostelId.toString() });

    expect(filter.hostelId).toBeInstanceOf(Types.ObjectId);
  });

  it("casts every id in the plural forms too", () => {
    const filter = ledgerFilterFor({
      hostelIds: [hostelId.toString()],
      invoiceIds: [invoiceId.toString()],
      residentIds: [residentId.toString()],
    }) as Record<string, { $in: unknown[] }>;

    expect(filter.hostelId!.$in[0]).toBeInstanceOf(Types.ObjectId);
    expect(filter.residentId!.$in[0]).toBeInstanceOf(Types.ObjectId);
    expect(filter._id!.$in[0]).toBeInstanceOf(Types.ObjectId);
  });

  it("leaves an ObjectId it was already given alone", () => {
    expect(ledgerFilterFor({ residentId }).residentId).toBe(residentId);
  });

  it("passes a malformed id through rather than throwing", () => {
    // It matches nothing, which is the same answer a bad id deserves — but a
    // read must not turn one into a 500.
    expect(ledgerFilterFor({ residentId: "not-an-id" }).residentId).toBe("not-an-id");
  });
});
