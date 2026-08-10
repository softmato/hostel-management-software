import Papa from "papaparse";

import {
  StatementParseError,
  normalizeHeader,
} from "@/modules/finance/statements/parsers/types";

/**
 * CSV reading shared by every provider parser.
 *
 * Two things here are not incidental:
 *
 * **Preamble skipping.** Wallet and bank exports routinely open with title and
 * account-summary lines before the real header — eSewa's begins with the account
 * name and a date range. Papaparse given such a file takes the title row as the
 * header and returns a table of nonsense with no error at all, which is exactly
 * the silent-partial-read this module exists to prevent. So the header row is
 * located by looking for a column the parser says it needs, and everything above
 * it is dropped.
 *
 * **Errors are fatal.** Papaparse reports malformed rows and carries on. Here
 * any error, on any row, fails the whole file (target §6.4).
 */

export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

const MAX_PREAMBLE_LINES = 25;

/**
 * Reads a CSV whose header row contains at least one of `requiredAliases`.
 *
 * `requiredAliases` is how the preamble is told apart from the header, so it
 * must name a column the provider always emits, not an optional one.
 */
export function readCsv(text: string, requiredAliases: string[]): CsvTable {
  const withoutBom = text.replace(/^﻿/, "");
  const body = stripPreamble(withoutBom, requiredAliases);

  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  // Every error, including a field-count mismatch on a single row. Papaparse
  // would happily return the other rows; that is the silent partial read.
  const fatal = parsed.errors[0];

  if (fatal) {
    throw new StatementParseError(
      `This file could not be read as CSV${
        typeof fatal.row === "number" ? ` (row ${fatal.row + 1})` : ""
      }: ${fatal.message}. The statement format may have changed.`,
      typeof fatal.row === "number" ? fatal.row + 1 : null,
    );
  }

  const headers = (parsed.meta.fields ?? []).filter((field) => field.trim() !== "");

  if (headers.length === 0) {
    throw new StatementParseError("This file has no column headers.");
  }

  const rows = parsed.data.filter((row) =>
    Object.values(row).some((value) => (value ?? "").trim() !== ""),
  );

  if (rows.length === 0) {
    throw new StatementParseError("This statement has no transaction rows.");
  }

  return { headers, rows };
}

/**
 * Drops title and summary lines above the header row.
 *
 * Bounded to the first {@link MAX_PREAMBLE_LINES} lines: past that, a file that
 * still has no recognisable header is not a statement with a long preamble, it
 * is the wrong file — and scanning a 10,000-row export for a header that is not
 * there would find a false one eventually.
 */
function stripPreamble(text: string, requiredAliases: string[]): string {
  const wanted = new Set(requiredAliases.map(normalizeHeader));
  const lines = text.split(/\r?\n/);
  const limit = Math.min(lines.length, MAX_PREAMBLE_LINES);

  for (let index = 0; index < limit; index += 1) {
    const line = lines[index]!;

    if (line.trim() === "") {
      continue;
    }

    // Parse the single line so quoted commas inside a header are handled the
    // same way the real parse will handle them.
    const cells = (Papa.parse<string[]>(line).data[0] ?? []).map((cell) =>
      normalizeHeader(String(cell)),
    );

    if (cells.some((cell) => wanted.has(cell))) {
      return lines.slice(index).join("\n");
    }
  }

  throw new StatementParseError(
    "No recognisable column header was found in this file. The statement format may have changed.",
  );
}

/**
 * Reads the headers of a file without committing to a parser, so the registry
 * can ask each parser whether it recognises the format.
 *
 * Returns an empty list rather than throwing: "nothing recognised this file" is
 * the registry's error to raise, with the list of formats it does support, and a
 * CSV-shaped complaint from here would bury that.
 */
export function peekHeaders(text: string): string[] {
  const withoutBom = text.replace(/^﻿/, "");
  const lines = withoutBom.split(/\r?\n/).slice(0, MAX_PREAMBLE_LINES);
  const headers: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }

    const cells = Papa.parse<string[]>(line).data[0] ?? [];

    headers.push(...cells.map((cell) => String(cell).trim()).filter(Boolean));
  }

  return headers;
}
