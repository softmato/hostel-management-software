import { describe, expect, it } from "vitest";

import type { ResidentLedger } from "@/lib/admin-manage-api";
import { paymentStanding } from "@/lib/resident-scan";

function month(
  period: string,
  dueAmount: number,
  paidAmount: number,
): ResidentLedger["months"][number] {
  return {
    dueAmount,
    dueDate: null,
    invoiceId: period,
    paidAmount,
    payments: [],
    period,
    status: paidAmount >= dueAmount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",
  };
}

function ledger(months: ResidentLedger["months"]): ResidentLedger {
  const paid = months.reduce((total, entry) => total + entry.paidAmount, 0);
  const due = months.reduce((total, entry) => total + entry.dueAmount, 0);

  return {
    months,
    resident: {
      fullName: "Asha Karki",
      id: "r1",
      moveInDate: null,
      phone: null,
      roomType: null,
    },
    totals: {
      monthsBilled: months.filter((entry) => entry.dueAmount > 0).length,
      monthsPaid: months.filter((entry) => entry.paidAmount >= entry.dueAmount).length,
      outstanding: Math.max(due - paid, 0),
      paid,
    },
  };
}

describe("paymentStanding", () => {
  it("stops 'paid till' at the first month that is short", () => {
    // The bug this exists to prevent: taking the newest month with money on it
    // would report April, and tell an owner to stop chasing an unpaid March.
    const standing = paymentStanding(
      ledger([
        month("2026-02", 8000, 8000),
        month("2026-03", 8000, 0),
        month("2026-04", 8000, 8000),
      ]),
    );

    expect(standing?.paidThrough).toBe("2026-02");
    expect(standing?.unpaid.map((entry) => entry.period)).toEqual(["2026-03"]);
  });

  it("treats a partial month as unpaid", () => {
    const standing = paymentStanding(
      ledger([month("2026-02", 8000, 8000), month("2026-03", 8000, 3000)]),
    );

    expect(standing?.paidThrough).toBe("2026-02");
    expect(standing?.unpaid.map((entry) => entry.period)).toEqual(["2026-03"]);
  });

  it("steps over a month nobody billed rather than stalling on it", () => {
    // `dueAmount: 0` is "never charged" — a waived month, or the gap before the
    // billing run caught up. Stopping there would report a debt that is not one.
    const standing = paymentStanding(
      ledger([
        month("2026-02", 8000, 8000),
        month("2026-03", 0, 0),
        month("2026-04", 8000, 8000),
      ]),
    );

    expect(standing?.paidThrough).toBe("2026-04");
    expect(standing?.unpaid).toEqual([]);
  });

  it("does not claim a paid-through month when nothing was ever billed", () => {
    const standing = paymentStanding(ledger([month("2026-02", 0, 0)]));

    expect(standing?.paidThrough).toBeNull();
  });

  it("orders regardless of how the server sent the months", () => {
    const standing = paymentStanding(
      ledger([
        month("2026-04", 8000, 0),
        month("2026-02", 8000, 8000),
        month("2026-03", 8000, 8000),
      ]),
    );

    expect(standing?.paidThrough).toBe("2026-03");
    expect(standing?.recent[0]?.period).toBe("2026-04");
  });

  it("is null when the ledger was refused, not an empty standing", () => {
    // `viewPayments` is a separate grant. Null means "we were not allowed to
    // look"; a zeroed standing would read as "they owe nothing".
    expect(paymentStanding(null)).toBeNull();
  });
});
