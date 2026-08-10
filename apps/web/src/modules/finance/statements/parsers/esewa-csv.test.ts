/**
 * eSewa CSV parser — Block 4 item 4.1 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §6.4).
 *
 * The rule these tests exist to hold is the non-negotiable one: **a parser
 * either reads a file completely or refuses it.** Most of what follows is
 * therefore not "does it parse" but "does it refuse" — a truncated file, an
 * unreadable amount, a part-rupee value, a row with both debit and credit. Each
 * of those, tolerated, would produce an import that looks successful and is
 * short by some number of residents nobody can name.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isValidReferenceCode } from "@/modules/finance/reference-code";
import { ESEWA_CSV_PARSER } from "@/modules/finance/statements/parsers/esewa-csv";
import { peekHeaders } from "@/modules/finance/statements/parsers/csv";
import { resolveParser } from "@/modules/finance/statements/parsers/registry";
import { StatementParseError } from "@/modules/finance/statements/parsers/types";

const FIXTURE = readFileSync(
  path.join(__dirname, "__fixtures__", "esewa-statement.csv"),
  "utf8",
);

describe("eSewa CSV parser", () => {
  it("reads every row of a real export, preamble and all", () => {
    const rows = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.providerTxnId)).toEqual([
      "ESW4471190",
      "ESW4471191",
      "ESW4471192",
      "ESW4471193",
      "ESW4471194",
    ]);
  });

  it("separates credits from debits", () => {
    const rows = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(rows.filter((row) => row.direction === "CREDIT")).toHaveLength(4);

    const debit = rows.find((row) => row.direction === "DEBIT");

    expect(debit?.providerTxnId).toBe("ESW4471193");
    expect(debit?.amount).toBe(1500);
  });

  it("strips thousands separators into whole rupees", () => {
    const [first] = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(first?.amount).toBe(12000);
    expect(Number.isInteger(first?.amount)).toBe(true);
  });

  it("keeps the remark verbatim, so a reference code survives to the ladder", () => {
    const rows = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(rows[0]?.remarks).toBe("RUP-4821-P August rent");
    expect(isValidReferenceCode("RUP-4821-P")).toBe(true);
    // The spaced, lower-case form a resident actually types.
    expect(isValidReferenceCode("rup 5J20 7")).toBe(true);
  });

  it("reads the timestamp as local wall clock, not UTC", () => {
    const [first] = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(first?.occurredAt.getFullYear()).toBe(2026);
    expect(first?.occurredAt.getMonth()).toBe(7);
    expect(first?.occurredAt.getDate()).toBe(2);
    expect(first?.occurredAt.getHours()).toBe(9);
  });

  it("keeps the whole source row for the event payload", () => {
    const [first] = ESEWA_CSV_PARSER.parse(FIXTURE);

    expect(first?.raw.Balance).toBe("45,300");
  });

  it("carries a stored version, so a past import is re-parseable", () => {
    expect(ESEWA_CSV_PARSER.version).toBe("esewa-csv@1");
  });
});

describe("refusing rather than under-reading", () => {
  it("fails on a truncated file rather than returning the rows it managed", () => {
    // A download cut off mid-row: the header and two good rows survive.
    const truncated = FIXTURE.split("\n").slice(0, 7).join("\n") + '\n3,2026-08-06 11:20:00,"ESW447';

    expect(() => ESEWA_CSV_PARSER.parse(truncated)).toThrow(StatementParseError);
  });

  it("fails on an amount it cannot read", () => {
    const corrupted = FIXTURE.replace('"12,000"', "twelve thousand");

    expect(() => ESEWA_CSV_PARSER.parse(corrupted)).toThrow(/row 1/i);
  });

  it("fails on a part-rupee amount instead of rounding it away", () => {
    const paisa = FIXTURE.replace('"12,000"', '"12,000.50"');

    expect(() => ESEWA_CSV_PARSER.parse(paisa)).toThrow(/whole rupees/i);
  });

  it("fails on a row carrying both a debit and a credit", () => {
    const both = FIXTURE.replace(
      ',,"12,000","45,300"',
      ',"500","12,000","45,300"',
    );

    expect(() => ESEWA_CSV_PARSER.parse(both)).toThrow(/both a credit and a debit/i);
  });

  it("fails on a missing date column rather than defaulting to today", () => {
    const noDate = FIXTURE.replace("S.N.,Date,", "S.N.,Posted On,").replace(
      /^\d,2026-08/gm,
      (match) => match,
    );

    // The column is renamed to something no alias covers, so every row loses
    // its date. The parser must not silently substitute a value.
    expect(() => ESEWA_CSV_PARSER.parse(noDate)).toThrow(StatementParseError);
  });

  it("fails when there is no recognisable header at all", () => {
    expect(() => ESEWA_CSV_PARSER.parse("just some prose\nand another line\n")).toThrow(
      /no recognisable column header/i,
    );
  });

  it("fails when the statement has a header but no transactions", () => {
    const headerOnly = FIXTURE.split("\n").slice(0, 5).join("\n");

    expect(() => ESEWA_CSV_PARSER.parse(headerOnly)).toThrow(/no transaction rows/i);
  });
});

describe("registry", () => {
  it("recognises the fixture as an eSewa export", () => {
    expect(ESEWA_CSV_PARSER.detect(peekHeaders(FIXTURE))).toBe(true);
    expect(resolveParser("ESEWA", FIXTURE)).toBe(ESEWA_CSV_PARSER);
  });

  it("refuses a file that is not the provider the owner chose", () => {
    expect(() => resolveParser("ESEWA", "name,email\nSuman,a@b.c\n")).toThrow(
      /does not look like/i,
    );
  });
});
