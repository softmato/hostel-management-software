import * as XLSX from "xlsx";

import { tableFromGrid } from "@/modules/finance/statements/parsers/grid";
import {
  type StatementTable,
  StatementParseError,
} from "@/modules/finance/statements/parsers/types";

/**
 * Excel statements — the format wallets actually hand out (target §6.4).
 *
 * eSewa's web export is a legacy BIFF8 `.xls`; Khalti's is an OOXML `.xlsx`.
 * Neither is a CSV, and asking an owner to open the file and re-save it before
 * every reconciliation is the kind of step that quietly ends with them not
 * reconciling at all.
 *
 * **Everything is read as text and nothing is coerced.** `raw: false` makes
 * SheetJS hand over each cell as the string the sheet displays, which keeps a
 * single path into {@link tableFromGrid} for all three formats and — more
 * importantly — keeps the existing money and date readers as the only code that
 * ever interprets a value. Letting the spreadsheet layer decide that `120.0` is
 * a float and `2026-08-07` is a Date would put two more interpreters in a path
 * whose whole design is that exactly one thing understands each column.
 *
 * The date caveat that makes this non-obvious: a cell formatted as a date in
 * Excel is stored as a serial number, and `raw: false` renders it using the
 * sheet's own format string. `dateNF` pins that rendering to an unambiguous
 * ISO-ish shape so a workbook authored under a `MM/DD/YY` locale cannot reach
 * `parseStatementDate`, which reads slashed dates day-first by declaration.
 */

/** Cap on cells, not bytes: a small file can still hold a very large sheet. */
const MAX_CELLS = 200_000;

/** Matches the preamble bound in `grid.ts` — a header below this is not one. */
const MAX_HEADER_SCAN_ROWS = 25;

export function isWorkbook(bytes: Buffer): boolean {
  // OLE2 compound file (legacy .xls) and the zip container (.xlsx). Magic bytes
  // rather than the filename, because the extension is whatever the browser
  // guessed and the owner may well have renamed it.
  return (
    bytes.length >= 4 &&
    ((bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0) ||
      (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04))
  );
}

export function readWorkbook(bytes: Buffer, headerAnchors: string[]): StatementTable {
  return tableFromGrid(gridFromWorkbook(bytes, headerAnchors), headerAnchors);
}

/**
 * Every cell that could plausibly be a column header, for the registry's
 * detection pass.
 *
 * The CSV equivalent scans the first lines and offers every non-empty cell;
 * this does the same across the leading rows of each sheet. Over-offering is
 * safe — `detect` matches on specific spellings, and a false candidate that no
 * parser claims changes nothing.
 */
export function headerCandidates(bytes: Buffer): string[] {
  const book = XLSX.read(bytes, {
    cellFormula: false,
    cellHTML: false,
    raw: false,
    sheetRows: MAX_HEADER_SCAN_ROWS,
    type: "buffer",
  });

  const found: string[] = [];

  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];

    if (!sheet) continue;

    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });

    for (const row of grid) {
      for (const cell of row ?? []) {
        const text = String(cell ?? "").trim();

        if (text) found.push(text);
      }
    }
  }

  return found;
}

/**
 * Reads the sheet the statement is on, as a grid of display text.
 *
 * Sheet choice is not "the first one": exports sometimes lead with a cover or
 * summary sheet. The sheet carrying a header anchor is the statement, and if
 * more than one qualifies the file is refused rather than guessed at — picking
 * the earlier one could reconcile against a sample sheet.
 */
function gridFromWorkbook(bytes: Buffer, headerAnchors: string[]): string[][] {
  let book: XLSX.WorkBook;

  try {
    book = XLSX.read(bytes, {
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      dateNF: "yyyy-mm-dd hh:mm:ss",
      raw: false,
      type: "buffer",
    });
  } catch (cause) {
    throw new StatementParseError(
      `This file could not be opened as a spreadsheet: ${
        cause instanceof Error ? cause.message : "unknown error"
      }.`,
    );
  }

  const candidates = book.SheetNames.filter((name) =>
    sheetHasAnchor(book.Sheets[name], headerAnchors),
  );

  if (candidates.length === 0) {
    throw new StatementParseError(
      "No recognisable column header was found in this file. The statement format may have changed.",
    );
  }

  if (candidates.length > 1) {
    throw new StatementParseError(
      `This workbook has ${candidates.length} sheets that look like statements (${candidates.join(", ")}). Upload one sheet at a time.`,
    );
  }

  const sheet = book.Sheets[candidates[0]!]!;

  assertWithinLimits(sheet);

  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
    blankrows: true,
    defval: "",
    header: 1,
    raw: false,
  });

  return grid.map((row) => (row ?? []).map((cell) => String(cell ?? "")));
}

function sheetHasAnchor(
  sheet: XLSX.WorkSheet | undefined,
  headerAnchors: string[],
): boolean {
  if (!sheet) return false;

  const wanted = new Set(headerAnchors.map(normalize));

  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;

    const cell = sheet[key] as XLSX.CellObject | undefined;
    const text = cell?.w ?? (typeof cell?.v === "string" ? cell.v : null);

    if (text && wanted.has(normalize(text))) {
      return true;
    }
  }

  return false;
}

/** Mirrors `normalizeHeader`, kept local so this file has no cycle back to types. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertWithinLimits(sheet: XLSX.WorkSheet) {
  const reference = sheet["!ref"];

  if (!reference) {
    throw new StatementParseError("This sheet is empty.");
  }

  const range = XLSX.utils.decode_range(reference);
  const cells =
    (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);

  if (cells > MAX_CELLS) {
    throw new StatementParseError(
      "This spreadsheet is too large to read. Export a shorter date range.",
    );
  }
}
