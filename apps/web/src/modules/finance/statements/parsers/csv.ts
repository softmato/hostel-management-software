import Papa from "papaparse";

import { tableFromGrid } from "@/modules/finance/statements/parsers/grid";
import {
  type StatementTable,
  StatementParseError,
} from "@/modules/finance/statements/parsers/types";

/**
 * CSV reading shared by every provider parser.
 *
 * The file is parsed **without** papaparse's header mode and handed to
 * {@link tableFromGrid} as a plain grid. That indirection is what lets a CSV and
 * an `.xls` of the same statement produce byte-identical rows: header location,
 * preamble skipping and column alignment all happen in one place instead of
 * once per format.
 *
 * **Errors are fatal.** Papaparse reports malformed rows and carries on. Here
 * any error, on any row, fails the whole file (target §6.4).
 */

const MAX_PREAMBLE_LINES = 25;

export function readCsv(text: string, headerAnchors: string[]): StatementTable {
  return tableFromGrid(gridFromCsv(text), headerAnchors);
}

function gridFromCsv(text: string): string[][] {
  const parsed = Papa.parse<string[]>(stripBom(text), {
    header: false,
    skipEmptyLines: false,
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

  return parsed.data.map((row) => (row ?? []).map((cell) => String(cell ?? "")));
}

function stripBom(text: string): string {
  return text.replace(/^﻿/, "");
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
  const lines = stripBom(text).split(/\r?\n/).slice(0, MAX_PREAMBLE_LINES);
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
