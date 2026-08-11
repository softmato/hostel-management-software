import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ESEWA_PARSER } from "@/modules/finance/statements/parsers/esewa";
import { readStatementTable } from "@/modules/finance/statements/parsers/source";
import { StatementParseError } from "@/modules/finance/statements/parsers/types";

/**
 * Golden tests against a **real eSewa export** (anonymised: names replaced, the
 * account number masked; the structure, spellings, `0.0` padding, totals row and
 * status tally are exactly as eSewa produced them).
 *
 * The previous fixture was invented from an assumed shape and the parser passed
 * against it while being unable to read a single real file. So the rule for this
 * file: every case here traces to something an actual export does.
 */

const FIXTURES = path.join(__dirname, "__fixtures__");

function read(name: string) {
  return fs.readFileSync(path.join(FIXTURES, name));
}

function parse(fileName: string) {
  const table = readStatementTable(
    { bytes: read(fileName), fileName },
    ESEWA_PARSER.headerAnchors,
  );

  return ESEWA_PARSER.parseTable(table);
}

function parseText(text: string) {
  const table = readStatementTable(
    { bytes: Buffer.from(text, "utf8"), fileName: "statement.csv" },
    ESEWA_PARSER.headerAnchors,
  );

  return ESEWA_PARSER.parseTable(table);
}

describe("eSewa statement parser", () => {
  it("detects the real export's header row", () => {
    expect(
      ESEWA_PARSER.detect(["Reference Code", "Date Time", "Description", "Dr.", "Cr."]),
    ).toBe(true);
  });

  it("reads the real export, skipping its eight-row preamble", () => {
    const rows = parse("esewa-statement-app-export.csv");

    // Six transactions in the file; the totals row and the status tally below
    // it are footer, not money.
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.providerTxnId)).toEqual([
      "1O2BP2Y",
      "1O2AQ4Q",
      "1O2ANPV",
      "1NWIJV9",
      "1NW2DT8",
      "1NVX5KB",
    ]);
  });

  it("reads `0.0` in the unused Dr/Cr column as 'not this side'", () => {
    const rows = parse("esewa-statement-app-export.csv");

    expect(rows.map((row) => [row.direction, row.amount])).toEqual([
      ["DEBIT", 120],
      ["CREDIT", 40],
      ["CREDIT", 10],
      ["DEBIT", 150],
      ["CREDIT", 40],
      ["CREDIT", 60],
    ]);
  });

  it("never reads the in-table totals row as a transaction", () => {
    const rows = parse("esewa-statement-app-export.csv");

    // The totals row carries Dr 270 / Cr 150. 270 appears nowhere else, so its
    // absence is the real assertion; 150 is not checked because a genuine
    // debit in this file happens to be 150 too — which is exactly why "no row
    // with the totals amount" is the wrong shape of test and the row count is
    // the right one.
    expect(rows).toHaveLength(6);
    expect(rows.some((row) => row.amount === 270)).toBe(false);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(420);
  });

  it("lifts the payer's name out of the description", () => {
    const rows = parse("esewa-statement-app-export.csv");

    expect(rows[1]).toMatchObject({
      counterpartyName: "Anita Shrestha",
      direction: "CREDIT",
      remarks: "Fund Transferred by Anita Shrestha",
    });
    // "Fund Transferred *to* X" is money leaving; the name is still the
    // counterparty, and the direction is what says which way it went.
    expect(rows[0]?.counterpartyName).toBe("Bikash Thapa");
  });

  it("reads dates as Kathmandu wall clock, not UTC", () => {
    const [first] = parse("esewa-statement-app-export.csv");

    expect(first?.occurredAt.getFullYear()).toBe(2026);
    expect(first?.occurredAt.getMonth()).toBe(7);
    expect(first?.occurredAt.getDate()).toBe(7);
    expect(first?.occurredAt.getHours()).toBe(19);
  });

  /**
   * The point of the format-agnostic table seam: an owner uploading the `.xls`
   * eSewa handed them must get byte-identical rows to the CSV they would have
   * produced by converting it by hand.
   */
  it.each([
    ["legacy .xls (BIFF8)", "esewa-statement-app-export.xls"],
    [".xlsx (OOXML)", "esewa-statement-app-export.xlsx"],
  ])("reads %s identically to the CSV", (_label, fileName) => {
    const fromCsv = parse("esewa-statement-app-export.csv");
    const fromWorkbook = parse(fileName);

    expect(fromWorkbook).toHaveLength(fromCsv.length);
    expect(
      fromWorkbook.map((row) => ({
        amount: row.amount,
        counterpartyName: row.counterpartyName,
        direction: row.direction,
        occurredAt: row.occurredAt.toISOString(),
        providerTxnId: row.providerTxnId,
        remarks: row.remarks,
      })),
    ).toEqual(
      fromCsv.map((row) => ({
        amount: row.amount,
        counterpartyName: row.counterpartyName,
        direction: row.direction,
        occurredAt: row.occurredAt.toISOString(),
        providerTxnId: row.providerTxnId,
        remarks: row.remarks,
      })),
    );
  });

  describe("refuses rather than half-reads", () => {
    const HEADER =
      "Reference Code,Date Time,Description,Dr.,Cr.,Status,Balance (NPR),Channel";

    it("excludes cancelled, pending and timed-out transactions", () => {
      const rows = parseText(
        [
          HEADER,
          "A1,2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.0,COMPLETE,500.0,App",
          "A2,2026-08-07 11:00:00.0,Fund Transferred by Shyam,0.0,900.0,Pending,500.0,App",
          "A3,2026-08-07 12:00:00.0,Fund Transferred by Hari,0.0,700.0,canceled,500.0,App",
          "A4,2026-08-07 13:00:00.0,Fund Transferred by Gita,0.0,300.0,Time out,500.0,App",
        ].join("\n"),
      );

      expect(rows.map((row) => row.providerTxnId)).toEqual(["A1"]);
    });

    it("stops on a status it has never seen rather than assuming it settled", () => {
      expect(() =>
        parseText(
          [
            HEADER,
            "A1,2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.0,ON HOLD,0.0,App",
          ].join("\n"),
        ),
      ).toThrow(/status this parser does not recognise/i);
    });

    it("stops on a part-rupee amount rather than rounding it", () => {
      expect(() =>
        parseText(
          [
            HEADER,
            "A1,2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.50,COMPLETE,0.0,App",
          ].join("\n"),
        ),
      ).toThrow(/part-rupee/i);
    });

    it("stops on a row with two genuinely non-zero sides", () => {
      expect(() =>
        parseText(
          [
            HEADER,
            "A1,2026-08-07 10:00:00.0,Adjustment,200.0,500.0,COMPLETE,0.0,App",
          ].join("\n"),
        ),
      ).toThrow(/both a credit and a debit/i);
    });

    it("stops on a transaction that lost its reference code", () => {
      // Distinct from the totals row, which has no date either. Money with a
      // date and no id is a row we failed to understand, not a footer.
      expect(() =>
        parseText(
          [
            HEADER,
            ",2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.0,COMPLETE,0.0,App",
          ].join("\n"),
        ),
      ).toThrow(/no transaction id/i);
    });

    it("stops on a transaction stranded below the totals row", () => {
      expect(() =>
        parseText(
          [
            HEADER,
            "A1,2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.0,COMPLETE,500.0,App",
            ",,Total,0.0,500.0,,,",
            "A2,2026-08-08 10:00:00.0,Fund Transferred by Sita,0.0,600.0,COMPLETE,1100.0,App",
          ].join("\n"),
        ),
      ).toThrow(/below this statement's totals row/i);
    });

    it("refuses a file with no recognisable header", () => {
      expect(() => parseText("just,some,columns\n1,2,3")).toThrow(StatementParseError);
    });

    it("refuses a statement whose transactions were all cancelled", () => {
      expect(() =>
        parseText(
          [
            HEADER,
            "A1,2026-08-07 10:00:00.0,Fund Transferred by Ram,0.0,500.0,canceled,0.0,App",
          ].join("\n"),
        ),
      ).toThrow(/no completed transactions/i);
    });
  });
});
