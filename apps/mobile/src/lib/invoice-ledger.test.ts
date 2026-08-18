import { describe, expect, it } from "vitest";

import type { ResidentInvoice } from "@/lib/finance-api";
import { invoiceLedger, outstanding, totalOutstanding } from "@/lib/invoice-ledger";

function invoice(overrides: Partial<ResidentInvoice> = {}): ResidentInvoice {
  return {
    dueAmount: 8500,
    id: "inv-1",
    // The ledger is built from totals and receipts, never from the breakdown:
    // a paid invoice's lines still sum to the full charge, so adding them in
    // would double the opening balance.
    lines: [],
    month: "2026-08",
    paidAmount: 0,
    receipts: [],
    referenceCode: "HH-AUG-01",
    status: "UNPAID",
    ...overrides,
  };
}

describe("invoiceLedger", () => {
  it("opens with the charge and closes on what is owed", () => {
    const lines = invoiceLedger(invoice());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amount: 8500, balance: 8500, kind: "charge" });
  });

  it("walks receipts oldest-first, even though the server sends them newest-first", () => {
    const lines = invoiceLedger(
      invoice({
        paidAmount: 8500,
        receipts: [
          { amount: 6500, id: "r2", issuedAt: "2026-08-20T04:00:00.000Z", number: "R-02" },
          { amount: 2000, id: "r1", issuedAt: "2026-08-05T04:00:00.000Z", number: "R-01" },
        ],
        status: "PAID",
      }),
    );

    expect(lines.map((line) => line.label)).toEqual([
      "Amount billed",
      "Receipt R-01",
      "Receipt R-02",
    ]);
    expect(lines.map((line) => line.balance)).toEqual([8500, 6500, 0]);
  });

  it("names the gap when the ledger has settled more than the receipts show", () => {
    // A payment can settle before its receipt is issued, and a receipt voided
    // with a reversed payment is excluded by the server. Absorbing the
    // difference silently would end the statement on a balance that disagrees
    // with the headline on the same screen.
    const lines = invoiceLedger(
      invoice({
        paidAmount: 8500,
        receipts: [
          { amount: 2000, id: "r1", issuedAt: "2026-08-05T04:00:00.000Z", number: "R-01" },
        ],
        status: "PAID",
      }),
    );

    expect(lines.at(-1)).toMatchObject({
      amount: -6500,
      balance: 0,
      kind: "unreceipted",
    });
  });

  it("emits no gap line for a floating-point residue", () => {
    const lines = invoiceLedger(
      invoice({
        dueAmount: 1200.3,
        paidAmount: 0.1 + 0.2,
        receipts: [{ amount: 0.3, id: "r1", issuedAt: null, number: "R-01" }],
      }),
    );

    expect(lines.map((line) => line.kind)).toEqual(["charge", "receipt"]);
  });

  it("does not invent a payment line when receipts exceed the settled total", () => {
    // Shouldn't happen, but a positive-only guard means a data oddity shows up
    // as a balance that looks wrong rather than as a fabricated credit.
    const lines = invoiceLedger(
      invoice({
        paidAmount: 1000,
        receipts: [{ amount: 3000, id: "r1", issuedAt: null, number: "R-01" }],
      }),
    );

    expect(lines.map((line) => line.kind)).toEqual(["charge", "receipt"]);
  });
});

describe("outstanding totals", () => {
  it("treats an overpaid month as zero, not as a negative", () => {
    expect(outstanding(invoice({ dueAmount: 8500, paidAmount: 9000 }))).toBe(0);
  });

  it("counts only the statuses that are still an obligation", () => {
    const total = totalOutstanding([
      invoice({ dueAmount: 8500, id: "a", paidAmount: 0, status: "OVERDUE" }),
      invoice({ dueAmount: 8500, id: "b", paidAmount: 4000, status: "PARTIAL" }),
      invoice({ dueAmount: 8500, id: "c", paidAmount: 8500, status: "PAID" }),
      invoice({ dueAmount: 8500, id: "d", paidAmount: 0, status: "VOID" }),
    ]);

    expect(total).toBe(8500 + 4500);
  });

  it("does not let an overpaid month cancel out an unpaid one", () => {
    const total = totalOutstanding([
      invoice({ dueAmount: 8500, id: "a", paidAmount: 12000, status: "PARTIAL" }),
      invoice({ dueAmount: 8500, id: "b", paidAmount: 0, status: "UNPAID" }),
    ]);

    expect(total).toBe(8500);
  });
});
