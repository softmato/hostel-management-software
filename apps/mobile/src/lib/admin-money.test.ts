import { describe, expect, it } from "vitest";

import type { AdminInvoiceRow } from "@/lib/admin-api";
import { amountOwed, invoiceSegment, outstandingRows } from "@/lib/admin-money";

function row(
  fullName: string,
  displayStatus: string,
  payment: { dueAmount: number; paidAmount: number } | null,
): AdminInvoiceRow {
  return {
    displayStatus,
    payment: payment
      ? {
          dueAmount: payment.dueAmount,
          id: `invoice-${fullName}`,
          month: "2026-08",
          paidAmount: payment.paidAmount,
          status: displayStatus,
        }
      : null,
    resident: { fullName, id: `resident-${fullName}`, moveInDate: "2026-01-01" },
  };
}

describe("amountOwed", () => {
  it("is the unpaid remainder, not the invoice total", () => {
    expect(amountOwed(row("Asha", "PARTIAL", { dueAmount: 8000, paidAmount: 3000 }))).toBe(
      5000,
    );
  });

  it("is zero for a resident nobody billed", () => {
    // NOT_BILLED needs attention, but nothing is *owed* — there is no invoice.
    expect(amountOwed(row("Bimal", "NOT_BILLED", null))).toBe(0);
  });

  it("never goes negative on an overpayment", () => {
    // Two months settled in one transfer. A negative owes-column would render
    // as a debt with a minus sign, which reads as an error rather than credit.
    expect(amountOwed(row("Chitra", "PAID", { dueAmount: 8000, paidAmount: 16000 }))).toBe(
      0,
    );
  });
});

describe("outstandingRows", () => {
  it("drops settled rows and keeps unbilled ones", () => {
    const rows = [
      row("Asha", "PAID", { dueAmount: 8000, paidAmount: 8000 }),
      row("Bimal", "NOT_BILLED", null),
      row("Chitra", "OVERDUE", { dueAmount: 8000, paidAmount: 0 }),
    ];

    // A resident nobody billed is the case the obvious "has an unpaid invoice"
    // filter hides, and it is the one with nothing chasing it.
    expect(outstandingRows(rows).map((entry) => entry.resident.fullName)).toEqual([
      "Chitra",
      "Bimal",
    ]);
  });

  it("puts the biggest hole in the month first", () => {
    const rows = [
      row("Asha", "PARTIAL", { dueAmount: 8000, paidAmount: 7000 }),
      row("Bimal", "UNPAID", { dueAmount: 12000, paidAmount: 0 }),
    ];

    expect(outstandingRows(rows)[0]?.resident.fullName).toBe("Bimal");
  });

  it("breaks ties on the name so the list does not reshuffle on refresh", () => {
    // Several residents owing exactly one month's rent is the normal case, and
    // an unstable sort moves the row somebody is reaching for under their thumb.
    const rows = [
      row("Chitra", "UNPAID", { dueAmount: 8000, paidAmount: 0 }),
      row("Asha", "UNPAID", { dueAmount: 8000, paidAmount: 0 }),
      row("Bimal", "UNPAID", { dueAmount: 8000, paidAmount: 0 }),
    ];

    expect(outstandingRows(rows).map((entry) => entry.resident.fullName)).toEqual([
      "Asha",
      "Bimal",
      "Chitra",
    ]);
  });

  it("does not mutate the array it was given", () => {
    // `money.data.invoices.rows` is the fetched payload; sorting it in place
    // would reorder the source behind React's back.
    const rows = [
      row("Chitra", "UNPAID", { dueAmount: 4000, paidAmount: 0 }),
      row("Asha", "UNPAID", { dueAmount: 9000, paidAmount: 0 }),
    ];

    outstandingRows(rows);

    expect(rows.map((entry) => entry.resident.fullName)).toEqual(["Chitra", "Asha"]);
  });
});

describe("invoiceSegment", () => {
  const rows = [
    row("Asha", "OVERDUE", { dueAmount: 9000, paidAmount: 0 }),
    row("Bimal", "UNPAID", { dueAmount: 8000, paidAmount: 0 }),
    row("Chitra", "NOT_BILLED", null),
    row("Deepa", "PAID", { dueAmount: 8000, paidAmount: 8000 }),
    row("Elina", "PARTIAL", { dueAmount: 8000, paidAmount: 3000 }),
  ];

  it("defaults to everyone who owes, most owed first", () => {
    expect(invoiceSegment(rows, "owing").map((entry) => entry.resident.fullName)).toEqual([
      "Asha",
      "Bimal",
      "Elina",
      "Chitra",
    ]);
  });

  it("isolates overdue, which is a phone call", () => {
    expect(invoiceSegment(rows, "overdue").map((entry) => entry.resident.fullName)).toEqual([
      "Asha",
    ]);
  });

  it("isolates unbilled, which is a billing run nobody has done", () => {
    expect(invoiceSegment(rows, "unbilled").map((entry) => entry.resident.fullName)).toEqual([
      "Chitra",
    ]);
  });

  it("shows the settled by name, since there is no amount to rank them by", () => {
    expect(invoiceSegment(rows, "settled").map((entry) => entry.resident.fullName)).toEqual([
      "Deepa",
    ]);
  });

  it("never puts a settled row in a segment that owes", () => {
    // The whole tab is about money that has not arrived. A PAID row leaking
    // into `owing` would be a person somebody calls to chase a settled bill.
    for (const segment of ["owing", "overdue", "unbilled"] as const) {
      expect(
        invoiceSegment(rows, segment).some((entry) => entry.displayStatus === "PAID"),
      ).toBe(false);
    }
  });

  it("does not mutate the array it was given", () => {
    const source = [...rows];

    invoiceSegment(source, "settled");

    expect(source.map((entry) => entry.resident.fullName)).toEqual(
      rows.map((entry) => entry.resident.fullName),
    );
  });
});
