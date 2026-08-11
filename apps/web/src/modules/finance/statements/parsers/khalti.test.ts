import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { KHALTI_CSV_PARSER } from "@/modules/finance/statements/parsers/khalti-csv";
import { resolveParser } from "@/modules/finance/statements/parsers/registry";
import { readStatementTable } from "@/modules/finance/statements/parsers/source";
import { normalizeHeader } from "@/modules/finance/statements/parsers/types";

/**
 * Golden tests against a **real Khalti export** (anonymised: names and the
 * wallet number replaced; column names, the split date/time, the `Amount(-) Rs`
 * / `Amount(+) Rs` pair and the state column are exactly as Khalti produced
 * them). One cancelled row was appended, because the real file happened to
 * contain only completed ones and that is the case with teeth.
 */

const FIXTURE = "khalti-transaction-history.xlsx";

function parse(fileName: string) {
  const bytes = fs.readFileSync(path.join(__dirname, "__fixtures__", fileName));

  return KHALTI_CSV_PARSER.parseTable(
    readStatementTable({ bytes, fileName }, KHALTI_CSV_PARSER.headerAnchors),
  );
}

describe("Khalti statement parser", () => {
  it("recognises the real export", () => {
    const bytes = fs.readFileSync(path.join(__dirname, "__fixtures__", FIXTURE));

    expect(resolveParser("KHALTI", { bytes, fileName: FIXTURE }).version).toBe(
      "khalti@2",
    );
  });

  /**
   * The bug this pins is invisible and total: both money columns collapse to
   * the same key under a normaliser that strips all punctuation, so the credit
   * column overwrites the debit one and every outgoing payment reads as money
   * received.
   */
  it("keeps `Amount(-) Rs` and `Amount(+) Rs` apart when normalising", () => {
    expect(normalizeHeader("Amount(-) Rs")).not.toBe(normalizeHeader("Amount(+) Rs"));
  });

  it("still strips a hyphen that joins two words", () => {
    expect(normalizeHeader("Debit-Amount")).toBe(normalizeHeader("Debit Amount"));
  });

  it("reads direction from the amount pair, not from the transaction type", () => {
    const rows = parse(FIXTURE);

    expect(rows.map((row) => [row.direction, row.amount])).toEqual([
      ["DEBIT", 600],
      ["CREDIT", 600],
    ]);
  });

  it("joins the split date and time columns", () => {
    const [first] = parse(FIXTURE);

    expect(first?.occurredAt.getFullYear()).toBe(2026);
    expect(first?.occurredAt.getMonth()).toBe(6);
    expect(first?.occurredAt.getDate()).toBe(29);
    // Without the time column this would be midnight, and two transfers of the
    // same amount on one day could not be told apart.
    expect(first?.occurredAt.getHours()).toBe(7);
    expect(first?.occurredAt.getMinutes()).toBe(59);
  });

  it("reads the counterparty from the end of the transfer the money came from", () => {
    const [outgoing, incoming] = parse(FIXTURE);

    // Outgoing: the recipient. Incoming: the payer — reading `To` here would
    // name the hostel's own wallet on every row and match nobody.
    expect(outgoing?.counterpartyName).toBe("Kirana Store");
    expect(incoming?.counterpartyName).toBe("Example Bank Limited");
  });

  it("keeps the typed remark, where a reference code would live", () => {
    const [, incoming] = parse(FIXTURE);

    // Unlike eSewa, Khalti has fields a resident can type into, so Tier A of
    // the matching ladder is available for this provider.
    expect(incoming?.remarks).toBe("Movie tickets");
  });

  it("excludes a cancelled transaction even when it carries a reference code", () => {
    const rows = parse(FIXTURE);

    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.providerTxnId === "zz9CancelledTxnId")).toBe(false);
    expect(rows.some((row) => row.remarks?.includes("RUP-4821-P"))).toBe(false);
  });
});
