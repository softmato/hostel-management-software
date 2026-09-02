import { describe, expect, it } from "vitest";

import type { AdminLedger, AdminLedgerEntry } from "@/lib/admin-api";
import {
  activeFilterCount,
  activeQuickRange,
  creditTitle,
  filterCredits,
  groupByDay,
  isPartial,
  methodOptions,
  NO_FILTER,
  quickRange,
  rangeLabel,
  statementCredits,
  statementShareText,
  statementSummary,
  type StatementFilter,
  statusOptions,
  UNKNOWN_METHOD,
  visibleTotal,
} from "@/lib/hostel-statement";

function entry(overrides: Partial<AdminLedgerEntry> = {}): AdminLedgerEntry {
  return {
    dueAmount: 5000,
    id: "inv-1",
    month: "2026-08",
    paidAmount: 5000,
    paidDate: "2026-08-24T07:53:00.000Z",
    paymentMethod: "ESEWA",
    residentId: "res-1",
    residentName: "Kartik Adhikari",
    status: "PAID",
    ...overrides,
  };
}

function ledger(entries: AdminLedgerEntry[], truncated = false): AdminLedger {
  return { entries, truncated };
}

function filter(overrides: Partial<StatementFilter> = {}): StatementFilter {
  return { ...NO_FILTER, ...overrides };
}

describe("statementCredits", () => {
  it("keeps only the entries money actually arrived against", () => {
    const credits = statementCredits(
      ledger([
        entry({ id: "paid", paidAmount: 5000 }),
        entry({ id: "raised", paidAmount: 0, paidDate: undefined, status: "OPEN" }),
      ]),
    );

    expect(credits.map((credit) => credit.id)).toEqual(["paid"]);
  });

  it("sorts newest first and breaks ties on the id so the list cannot reshuffle", () => {
    const credits = statementCredits(
      ledger([
        entry({ id: "b", paidDate: "2026-08-01T00:00:00.000Z" }),
        entry({ id: "c", paidDate: "2026-08-24T00:00:00.000Z" }),
        entry({ id: "a", paidDate: "2026-08-24T00:00:00.000Z" }),
      ]),
    );

    expect(credits.map((credit) => credit.id)).toEqual(["a", "c", "b"]);
  });

  it("accumulates the running total from the oldest row up", () => {
    const credits = statementCredits(
      ledger([
        entry({ id: "new", paidAmount: 100, paidDate: "2026-08-24T00:00:00.000Z" }),
        entry({ id: "mid", paidAmount: 200, paidDate: "2026-08-20T00:00:00.000Z" }),
        entry({ id: "old", paidAmount: 300, paidDate: "2026-08-10T00:00:00.000Z" }),
      ]),
    );

    expect(credits.map((credit) => credit.runningTotal)).toEqual([600, 500, 300]);
  });

  it("refuses to guess a running total when the ledger was truncated", () => {
    const credits = statementCredits(
      ledger([entry({ paidAmount: 100 }), entry({ id: "inv-2", paidAmount: 200 })], true),
    );

    expect(credits.every((credit) => credit.runningTotal === null)).toBe(true);
  });

  it("falls back to the raised date when nothing recorded a paid date", () => {
    const [credit] = statementCredits(
      ledger([entry({ createdAt: "2026-07-01T00:00:00.000Z", paidDate: undefined })]),
    );

    expect(credit.receivedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("names an unmapped provider rather than leaving the method blank", () => {
    const [credit] = statementCredits(
      ledger([entry({ method: undefined, paymentMethod: undefined })]),
    );

    expect(credit.method).toBe(UNKNOWN_METHOD);
  });

  it("reads `method` when the serializer only sent that half of the pair", () => {
    const [credit] = statementCredits(
      ledger([entry({ method: "CASH", paymentMethod: undefined })]),
    );

    expect(credit.method).toBe("CASH");
  });

  it("survives a ledger that never loaded", () => {
    expect(statementCredits(null)).toEqual([]);
  });
});

describe("filterCredits", () => {
  const credits = statementCredits(
    ledger([
      entry({ id: "esewa", paymentMethod: "ESEWA", remarks: "Bill sharing" }),
      entry({
        id: "cash",
        paidAmount: 3000,
        paymentMethod: "CASH",
        residentName: "Prahlad Kumar Mahato",
        status: "PARTIAL",
      }),
      entry({
        id: "old",
        paidDate: "2026-06-02T00:00:00.000Z",
        paymentMethod: "KHALTI",
      }),
    ]),
  );

  it("passes everything through when nothing is set", () => {
    expect(filterCredits(credits, NO_FILTER)).toHaveLength(3);
  });

  it("narrows to one method", () => {
    expect(filterCredits(credits, filter({ method: "CASH" })).map((row) => row.id)).toEqual([
      "cash",
    ]);
  });

  it("narrows to one status", () => {
    expect(filterCredits(credits, filter({ status: "PARTIAL" })).map((row) => row.id)).toEqual([
      "cash",
    ]);
  });

  it("searches the row as one string, across fields", () => {
    expect(filterCredits(credits, filter({ query: "prahlad" })).map((row) => row.id)).toEqual([
      "cash",
    ]);
    expect(filterCredits(credits, filter({ query: "bill sharing" })).map((row) => row.id)).toEqual(
      ["esewa"],
    );
    expect(filterCredits(credits, filter({ query: "august 2026" })).map((row) => row.id)).toEqual([
      // Same paid date, so the id tiebreak orders them — see `byNewestFirst`.
      "cash",
      "esewa",
      "old",
    ]);
  });

  it("includes both ends of the date range", () => {
    const inside = filterCredits(credits, filter({ from: "2026-06-02", to: "2026-06-02" }));

    expect(inside.map((row) => row.id)).toEqual(["old"]);
  });

  it("excludes a credit with no date from any date range", () => {
    const undated = statementCredits(
      ledger([entry({ createdAt: undefined, id: "nowhere", paidDate: undefined })]),
    );

    expect(filterCredits(undated, filter({ from: "2000-01-01" }))).toHaveLength(0);
    expect(filterCredits(undated, NO_FILTER)).toHaveLength(1);
  });
});

describe("quickRange", () => {
  const now = new Date("2026-08-26T06:00:00.000Z");

  it("counts the day it is run on as one of the days", () => {
    expect(quickRange(7, now)).toEqual({ from: "2026-08-20", to: "2026-08-26" });
  });

  it("recognises a range it produced, and only that", () => {
    expect(activeQuickRange(filter(quickRange(30, now)), now)).toBe(30);
    expect(activeQuickRange(filter({ from: "2026-08-01", to: "2026-08-26" }), now)).toBeNull();
    expect(activeQuickRange(NO_FILTER, now)).toBeNull();
  });
});

describe("activeFilterCount", () => {
  it("counts a date range once however many ends are set", () => {
    expect(activeFilterCount(filter({ from: "2026-08-01" }))).toBe(1);
    expect(activeFilterCount(filter({ from: "2026-08-01", to: "2026-08-26" }))).toBe(1);
  });

  it("ignores a query that is only whitespace", () => {
    expect(activeFilterCount(filter({ query: "   " }))).toBe(0);
  });

  it("adds the independent filters up", () => {
    expect(
      activeFilterCount(filter({ from: "2026-08-01", method: "CASH", query: "a", status: "PAID" })),
    ).toBe(4);
  });
});

describe("option lists", () => {
  const credits = statementCredits(
    ledger([
      entry({ id: "1", paymentMethod: "KHALTI" }),
      entry({ id: "2", paymentMethod: "CASH", status: "PARTIAL" }),
      entry({ id: "3", paymentMethod: "CASH" }),
    ]),
  );

  it("offers each method once, in a stable order", () => {
    expect(methodOptions(credits)).toEqual(["CASH", "KHALTI"]);
  });

  it("offers each status once", () => {
    expect(statusOptions(credits)).toEqual(["PAID", "PARTIAL"]);
  });
});

describe("groupByDay", () => {
  it("groups by the Kathmandu day, keeping the order it was given", () => {
    const credits = statementCredits(
      ledger([
        entry({ id: "a", paidAmount: 100, paidDate: "2026-08-24T07:00:00.000Z" }),
        entry({ id: "b", paidAmount: 200, paidDate: "2026-08-24T09:00:00.000Z" }),
        entry({ id: "c", paidAmount: 300, paidDate: "2026-08-22T09:00:00.000Z" }),
      ]),
    );

    const days = groupByDay(credits);

    expect(days).toHaveLength(2);
    expect(days[0].credits.map((row) => row.id)).toEqual(["b", "a"]);
    expect(days[0].total).toBe(300);
    expect(days[1].total).toBe(300);
  });

  it("splits a UTC day that Kathmandu calls two days", () => {
    /* 18:20 UTC on the 23rd is 00:05 on the 24th in Nepal (+05:45). */
    const credits = statementCredits(
      ledger([
        entry({ id: "late", paidDate: "2026-08-23T18:20:00.000Z" }),
        entry({ id: "early", paidDate: "2026-08-23T10:00:00.000Z" }),
      ]),
    );

    expect(groupByDay(credits)).toHaveLength(2);
  });

  it("heads a day with its weekday and both calendars", () => {
    const credits = statementCredits(ledger([entry({ paidDate: "2026-08-24T07:00:00.000Z" })]));

    expect(groupByDay(credits)[0].label).toMatch(/^Mon · .* · 24 Aug 2026$/);
  });

  it("collects undated credits rather than dropping them", () => {
    const credits = statementCredits(
      ledger([entry({ createdAt: undefined, paidDate: undefined })]),
    );

    expect(groupByDay(credits)[0].label).toBe("Date not recorded");
  });
});

describe("statementSummary", () => {
  const now = new Date("2026-08-26T06:00:00.000Z");

  it("totals what landed this month, whatever month it was billed for", () => {
    const credits = statementCredits(
      ledger([
        entry({ id: "july-rent", month: "2026-07", paidAmount: 4000 }),
        entry({ id: "august-rent", paidAmount: 5000 }),
        entry({ id: "last-month", paidAmount: 9000, paidDate: "2026-07-15T00:00:00.000Z" }),
      ]),
    );

    expect(statementSummary(credits, "AD", now)).toEqual({
      count: 2,
      periodLabel: "August 2026",
      total: 9000,
    });
  });

  it("reports a zero month rather than the lifetime figure", () => {
    const credits = statementCredits(
      ledger([entry({ paidDate: "2025-01-01T00:00:00.000Z" })]),
    );

    expect(statementSummary(credits, "AD", now).total).toBe(0);
  });
});

describe("row copy", () => {
  it("names the month a credit is for", () => {
    const [credit] = statementCredits(ledger([entry()]));

    expect(creditTitle(credit, "AD")).toBe("August 2026 rent from Kartik Adhikari");
  });

  it("says one-off rather than borrowing a month it has none of", () => {
    const [credit] = statementCredits(ledger([entry({ month: null })]));

    expect(creditTitle(credit, "AD")).toBe("One-off charge from Kartik Adhikari");
  });

  it("does not start with a space when the resident could not be resolved", () => {
    const [credit] = statementCredits(ledger([entry({ residentName: "" })]));

    expect(creditTitle(credit, "AD")).toBe("August 2026 rent from a resident");
  });

  /*
   * The bug this pins: the sheet's "For" row went through `dates.period` and
   * read `Shrawan 2083`, while the title directly above it went through
   * `formatPeriod` and read `August 2026` — the same month, in two calendars,
   * on the same card.
   */
  it("spells the month in the calendar the portal is set to", () => {
    const [credit] = statementCredits(ledger([entry()]));

    expect(creditTitle(credit, "BS")).toBe("Shrawan 2083 rent from Kartik Adhikari");
    expect(rangeLabel(filter({ from: "2026-08-20", to: "2026-08-26" }), "BS")).toBe(
      "4 Bhadra 2083 to 10 Bhadra 2083",
    );
    expect(
      statementSummary(
        statementCredits(ledger([entry({ paidAmount: 5000 })])),
        "BS",
        new Date("2026-08-26T06:00:00.000Z"),
      ).periodLabel,
    ).toBe("Shrawan 2083");
  });

  it("finds a row by either calendar's month name, whatever is on screen", () => {
    // The search index is not the display. An owner reading Nepali dates types
    // "bhadra"; one reading English types "august"; both mean this row.
    const credits = statementCredits(ledger([entry()]));

    expect(filterCredits(credits, filter({ query: "august 2026" }))).toHaveLength(1);
    expect(filterCredits(credits, filter({ query: "shrawan" }))).toHaveLength(1);
  });

  it("knows a part payment from a settled one", () => {
    const [part] = statementCredits(ledger([entry({ dueAmount: 5000, paidAmount: 3000 })]));
    const [whole] = statementCredits(ledger([entry()]));

    expect(isPartial(part)).toBe(true);
    expect(isPartial(whole)).toBe(false);
  });
});

describe("visibleTotal", () => {
  it("adds up what is on screen", () => {
    const credits = statementCredits(
      ledger([entry({ id: "a", paidAmount: 1200.5 }), entry({ id: "b", paidAmount: 800 })]),
    );

    expect(visibleTotal(credits)).toBe(2000.5);
  });
});

describe("rangeLabel", () => {
  it("names both ends, one end, or neither", () => {
    expect(rangeLabel(filter({ from: "2026-08-20", to: "2026-08-26" }), "AD")).toBe(
      "20 Aug 2026 to 26 Aug 2026",
    );
    expect(rangeLabel(filter({ from: "2026-08-20", to: "2026-08-20" }), "AD")).toBe("20 Aug 2026");
    expect(rangeLabel(filter({ from: "2026-08-20" }), "AD")).toBe("20 Aug 2026 onwards");
    expect(rangeLabel(filter({ to: "2026-08-26" }), "AD")).toBe("Up to 26 Aug 2026");
    expect(rangeLabel(NO_FILTER, "AD")).toBe("All time");
  });
});

describe("statementShareText", () => {
  const credits = statementCredits(
    ledger([entry({ id: "a", paidAmount: 5000 }), entry({ id: "b", paidAmount: 3000 })]),
  );

  it("describes the filtered view, not the lifetime figure", () => {
    expect(
      statementShareText({
        calendar: "AD",
        credits,
        filter: filter({ from: "2026-08-20", to: "2026-08-26" }),
        hostelName: "Green View Hostel",
      }),
    ).toBe(
      [
        "Green View Hostel — statement",
        "20 Aug 2026 to 26 Aug 2026",
        "2 payments · NPR 8,000 received",
      ].join("\n"),
    );
  });

  it("falls back to a generic first line for a warden with no single hostel", () => {
    expect(
      statementShareText({ calendar: "AD", credits: [], filter: NO_FILTER, hostelName: "" }),
    ).toBe(["Hostel statement", "All time", "0 payments · NPR 0 received"].join("\n"));
  });

  it("says payment, singular, when there is one", () => {
    expect(
      statementShareText({
        calendar: "AD",
        credits: credits.slice(0, 1),
        filter: NO_FILTER,
        hostelName: "",
      }),
    ).toContain("1 payment · ");
  });
});

describe("the amount floor", () => {
  const credits = statementCredits(
    ledger([
      entry({ id: "big", paidAmount: 5000 }),
      entry({ id: "small", paidAmount: 800 }),
    ]),
  );

  it("hides anything under the floor", () => {
    expect(filterCredits(credits, filter({ minAmount: "1000" })).map((row) => row.id)).toEqual([
      "big",
    ]);
  });

  it("treats a half-typed or nonsense value as no floor", () => {
    expect(filterCredits(credits, filter({ minAmount: "" }))).toHaveLength(2);
    expect(filterCredits(credits, filter({ minAmount: "-" }))).toHaveLength(2);
    expect(filterCredits(credits, filter({ minAmount: "0" }))).toHaveLength(2);
    expect(activeFilterCount(filter({ minAmount: "abc" }))).toBe(0);
    expect(activeFilterCount(filter({ minAmount: "1000" }))).toBe(1);
  });
});
