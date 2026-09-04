import { describe, expect, it } from "vitest";

import type { ResidentInvoice } from "@/lib/finance-api";
import {
  activeCodes,
  certifiedReceipts,
  offerProgramStats,
} from "@/lib/offer-program";

function invoice(overrides: Partial<ResidentInvoice> = {}): ResidentInvoice {
  return {
    dueAmount: 12_000,
    id: "i1",
    lines: [],
    month: "2026-08",
    paidAmount: 0,
    receipts: [],
    referenceCode: "RUP-4821-K",
    status: "UNPAID",
    ...overrides,
  };
}

describe("which reference code is live", () => {
  it("keeps an UNPAID month, which the web page drops", () => {
    // `resident-offer-program-page.tsx` filters on ["OPEN","PARTIAL","OVERDUE"]
    // and so hides the code for the commonest open status of all.
    expect(activeCodes([invoice({ status: "UNPAID" })])).toHaveLength(1);
  });

  it("keeps PENDING_PROOF, which the web page also drops", () => {
    expect(activeCodes([invoice({ status: "PENDING_PROOF" })])).toHaveLength(1);
  });

  it("keeps OPEN, PARTIAL and OVERDUE", () => {
    expect(
      activeCodes([
        invoice({ id: "a", status: "OPEN" }),
        invoice({ id: "b", status: "PARTIAL" }),
        invoice({ id: "c", status: "OVERDUE" }),
      ]),
    ).toHaveLength(3);
  });

  it("drops a settled month — its code is not the one to quote", () => {
    expect(activeCodes([invoice({ status: "PAID" })])).toEqual([]);
  });

  it("drops an open month that carries no code", () => {
    expect(activeCodes([invoice({ referenceCode: null })])).toEqual([]);
  });

  it("keeps the payload's order rather than imposing a second one", () => {
    const rows = activeCodes([
      invoice({ id: "newer", month: "2026-08" }),
      invoice({ id: "older", month: "2026-07" }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["newer", "older"]);
  });
});

describe("certified receipts", () => {
  const withReceipts = [
    invoice({
      id: "july",
      month: "2026-07",
      receipts: [
        { amount: 6_000, id: "r1", issuedAt: "2026-07-04T00:00:00.000Z", number: "R-1" },
        { amount: 6_000, id: "r2", issuedAt: "2026-07-19T00:00:00.000Z", number: "R-2" },
      ],
    }),
    invoice({
      id: "august",
      month: "2026-08",
      receipts: [
        { amount: 12_000, id: "r3", issuedAt: "2026-08-02T00:00:00.000Z", number: "R-3" },
      ],
    }),
  ];

  it("flattens every receipt and carries its month", () => {
    const receipts = certifiedReceipts(withReceipts);

    expect(receipts).toHaveLength(3);
    expect(receipts.find((row) => row.id === "r3")?.month).toBe("2026-08");
  });

  it("keeps both receipts for a month that was part-paid twice", () => {
    // One receipt per *payment*, which is why the number is the identifier.
    const july = certifiedReceipts(withReceipts).filter((row) => row.month === "2026-07");

    expect(july.map((row) => row.number)).toEqual(["R-2", "R-1"]);
  });

  it("sorts newest first", () => {
    expect(certifiedReceipts(withReceipts).map((row) => row.id)).toEqual([
      "r3",
      "r2",
      "r1",
    ]);
  });

  it("sorts an undated receipt last, not first", () => {
    // Coercing a missing date to "" — as the web does — sorts it above every
    // real date, pushing this month's genuine receipt off the first screenful.
    const rows = certifiedReceipts([
      invoice({
        receipts: [
          { amount: 1, id: "undated", issuedAt: null, number: "R-0" },
          { amount: 1, id: "dated", issuedAt: "2026-08-02T00:00:00.000Z", number: "R-9" },
        ],
      }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["dated", "undated"]);
  });

  it("carries a null month rather than inventing one", () => {
    // An admission fee belongs to no month — `Invoice.period` is nullable.
    const rows = certifiedReceipts([
      invoice({
        month: null,
        receipts: [{ amount: 5_000, id: "adm", issuedAt: null, number: "R-ADM" }],
      }),
    ]);

    expect(rows[0].month).toBeNull();
  });
});

describe("the three figures at the top", () => {
  it("counts and totals the receipts, and counts only pending claims", () => {
    expect(
      offerProgramStats({
        claims: [
          { amount: 1, id: "c1", status: "PENDING" },
          { amount: 1, id: "c2", status: "APPROVED" },
          { amount: 1, id: "c3", status: "PENDING" },
        ],
        credit: 0,
        invoices: [
          invoice({
            receipts: [
              { amount: 6_000, id: "r1", issuedAt: null, number: "R-1" },
              { amount: 4_000, id: "r2", issuedAt: null, number: "R-2" },
            ],
          }),
        ],
      }),
    ).toEqual({ certifiedAmount: 10_000, certifiedCount: 2, pendingCount: 2 });
  });

  it("is all zeroes for a resident with nothing yet", () => {
    expect(offerProgramStats({ claims: [], credit: 0, invoices: [] })).toEqual({
      certifiedAmount: 0,
      certifiedCount: 0,
      pendingCount: 0,
    });
  });
});
