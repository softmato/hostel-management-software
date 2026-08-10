/**
 * Khalti and bank parsers — Block 4 item 4.4 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §6.4).
 *
 * Same posture as the eSewa parser: golden fixtures, and most of the assertions
 * are about refusing. Two additions specific to these formats:
 *
 * - Khalti carries direction in a `Type` word rather than in separate columns,
 *   so an unrecognised word must fail rather than default — a default of CREDIT
 *   turns every outgoing payment into somebody's rent.
 * - Bank rows often carry no reference number, so the dedupe key is derived.
 *   The test that matters is that the *same file* read twice derives the *same*
 *   ids, because that is what makes an overlapping re-upload a no-op.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isValidReferenceCode } from "@/modules/finance/reference-code";
import { BANK_CSV_PARSER } from "@/modules/finance/statements/parsers/bank-csv";
import { KHALTI_CSV_PARSER } from "@/modules/finance/statements/parsers/khalti-csv";
import { peekHeaders } from "@/modules/finance/statements/parsers/csv";
import { resolveParser } from "@/modules/finance/statements/parsers/registry";

const KHALTI = readFileSync(
  path.join(__dirname, "__fixtures__", "khalti-statement.csv"),
  "utf8",
);
const BANK = readFileSync(
  path.join(__dirname, "__fixtures__", "bank-statement.csv"),
  "utf8",
);
const ESEWA = readFileSync(
  path.join(__dirname, "__fixtures__", "esewa-statement.csv"),
  "utf8",
);

describe("Khalti CSV parser", () => {
  it("reads every row of a real export", () => {
    const rows = KHALTI_CSV_PARSER.parse(KHALTI);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.providerTxnId)).toEqual([
      "KHL880011",
      "KHL880012",
      "KHL880013",
    ]);
  });

  it("takes direction from the Type column, not the sign", () => {
    const rows = KHALTI_CSV_PARSER.parse(KHALTI);

    expect(rows.map((row) => row.direction)).toEqual(["CREDIT", "DEBIT", "CREDIT"]);
  });

  it("keeps the remark, where the reference code lives", () => {
    const [first] = KHALTI_CSV_PARSER.parse(KHALTI);

    expect(first?.remarks).toContain("RUP-4821-P");
    expect(isValidReferenceCode("RUP-4821-P")).toBe(true);
  });

  it("refuses a transaction type it does not recognise", () => {
    const odd = KHALTI.replace(",Credit,Sabina", ",Settlement,Sabina");

    expect(() => KHALTI_CSV_PARSER.parse(odd)).toThrow(/does not recognise/i);
  });

  it("refuses a part-rupee amount", () => {
    expect(() => KHALTI_CSV_PARSER.parse(KHALTI.replace('"9,000"', '"9,000.25"'))).toThrow(
      /whole rupees/i,
    );
  });

  it("carries its own version", () => {
    expect(KHALTI_CSV_PARSER.version).toBe("khalti-csv@1");
  });
});

describe("bank CSV parser", () => {
  it("reads deposits and withdrawals into one directional column", () => {
    const rows = BANK_CSV_PARSER.parse(BANK);

    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.direction === "CREDIT")).toHaveLength(4);
    expect(rows.find((row) => row.direction === "DEBIT")?.amount).toBe(5000);
  });

  it("reads DD/MM/YYYY day-first, as declared", () => {
    const [first] = BANK_CSV_PARSER.parse(BANK);

    expect(first?.occurredAt.getDate()).toBe(2);
    expect(first?.occurredAt.getMonth()).toBe(7);
  });

  it("passes the narration through, since it is the only reference a bank has", () => {
    const [first] = BANK_CSV_PARSER.parse(BANK);

    expect(first?.remarks).toBe("FT SUMAN TAMANG RUP-5J20-7");
    expect(isValidReferenceCode("RUP-5J20-7")).toBe(true);
  });

  it("derives the same ids when the same file is read twice", () => {
    // This is what makes a re-uploaded overlapping range a no-op for rows that
    // carry no reference number of their own.
    expect(BANK_CSV_PARSER.parse(BANK).map((row) => row.providerTxnId)).toEqual(
      BANK_CSV_PARSER.parse(BANK).map((row) => row.providerTxnId),
    );
  });

  it("does not collapse two identical-looking rows onto one id", () => {
    const rows = BANK_CSV_PARSER.parse(BANK);
    const ids = rows.map((row) => row.providerTxnId);

    expect(new Set(ids).size).toBe(rows.length);
  });

  it("prefers a real reference number when the bank provides one", () => {
    const withRef = BANK.replace("Date,Narration,", "Date,Reference No,Narration,").replace(
      /^(\d{2}\/\d{2}\/\d{4}),/gm,
      "$1,REF001,",
    );
    const rows = BANK_CSV_PARSER.parse(withRef);

    expect(rows[0]?.providerTxnId).toBe("REF001");
  });

  it("refuses a row with neither a deposit nor a withdrawal", () => {
    const empty = BANK.replace('ATM WDL KATHMANDU,"5,000",,"1,27,000"', 'ATM WDL KATHMANDU,,,"1,27,000"');

    expect(() => BANK_CSV_PARSER.parse(empty)).toThrow(/neither a deposit nor a withdrawal/i);
  });

  it("refuses a row with both", () => {
    const both = BANK.replace(',,"8,000","1,20,000"', ',"100","8,000","1,20,000"');

    expect(() => BANK_CSV_PARSER.parse(both)).toThrow(/both a deposit and a withdrawal/i);
  });
});

describe("the registry keeps the three formats apart", () => {
  it("routes each fixture to its own parser", () => {
    expect(resolveParser("ESEWA", ESEWA)).toBe(
      resolveParser("ESEWA", ESEWA),
    );
    expect(resolveParser("KHALTI", KHALTI).version).toBe("khalti-csv@1");
    expect(resolveParser("BANK", BANK).version).toBe("bank-csv@1");
  });

  it("refuses a bank file uploaded as an eSewa statement, and names what it is", () => {
    expect(() => resolveParser("ESEWA", BANK)).toThrow(/bank statement/i);
  });

  it("does not let the bank parser claim an eSewa export", () => {
    expect(BANK_CSV_PARSER.detect(peekHeaders(ESEWA))).toBe(false);
  });
});
