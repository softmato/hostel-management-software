import { describe, expect, it } from "vitest";

import type { ResidentClaim, ResidentInvoice } from "@/lib/finance-api";
import {
  activeCodes,
  certifiedReceipts,
  offerProgramStats,
} from "@/lib/offer-program";

/**
 * The claim shape the route actually returns — a `ReviewQueueRow`, keyed
 * `eventId` and dated `occurredAt`. These fixtures said `id` until 2026-09-05
 * and so agreed with a client type that had never matched the wire.
 */
function claim(eventId: string, status: string): ResidentClaim {
  return {
    amount: 1,
    eventId,
    invoiceId: null,
    method: "ESEWA",
    period: null,
    rejectionReason: null,
    status,
    transactionCode: null,
  };
}

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

describe("the summary figures", () => {
  it("counts and totals the receipts, and counts only pending claims", () => {
    expect(
      offerProgramStats({
        claims: [
          claim("c1", "PENDING"),
          claim("c2", "APPROVED"),
          claim("c3", "PENDING"),
        ],
        credit: 0,
        invoices: [
          invoice({
            paidAmount: 11_200,
            receipts: [
              { amount: 6_000, id: "r1", issuedAt: null, number: "R-1" },
              { amount: 4_000, id: "r2", issuedAt: null, number: "R-2" },
            ],
          }),
        ],
      }),
    ).toEqual({
      certifiedAmount: 10_000,
      certifiedCount: 2,
      pendingCount: 2,
      totalPaid: 11_200,
    });
  });

  /*
   * The gap between the two totals is the screen's whole reason for showing
   * both: 1,200 of what this resident paid has been reconciled but not yet
   * receipted, and a screen printing only the certified figure would tell them
   * they had paid 10,000.
   */
  it("counts money that is paid but not yet receipted", () => {
    const stats = offerProgramStats({
      claims: [],
      credit: 0,
      invoices: [invoice({ paidAmount: 11_200 })],
    });

    expect(stats.totalPaid).toBe(11_200);
    expect(stats.certifiedAmount).toBe(0);
  });

  it("is all zeroes for a resident with nothing yet", () => {
    expect(offerProgramStats({ claims: [], credit: 0, invoices: [] })).toEqual({
      certifiedAmount: 0,
      certifiedCount: 0,
      pendingCount: 0,
      totalPaid: 0,
    });
  });
});
