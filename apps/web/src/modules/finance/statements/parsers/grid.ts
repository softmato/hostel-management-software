import {
  type StatementTable,
  StatementParseError,
  normalizeHeader,
} from "@/modules/finance/statements/parsers/types";

/**
 * A rectangular grid of cell text into a header row plus data rows.
 *
 * Every format funnels through here — papaparse hands over a grid, and so does
 * the workbook reader — so preamble skipping is written once and behaves
 * identically whether the owner uploaded a CSV or the `.xls` their wallet
 * actually gave them.
 */

const MAX_PREAMBLE_ROWS = 25;

/**
 * Locates the header row and returns everything below it.
 *
 * The header is *found*, not assumed: wallet and bank exports open with a title
 * and an account summary — eSewa's real export spends eight rows on a date
 * range, a generation timestamp and the account holder's number before the
 * columns begin. Treating row one as the header there yields a table of
 * nonsense with no error at all, which is the silent partial read this module
 * exists to prevent.
 *
 * Bounded to the first {@link MAX_PREAMBLE_ROWS} rows: past that, a file with no
 * recognisable header is the wrong file, not a statement with a long preamble.
 * Scanning a 10,000-row export would eventually find a false header.
 */
export function tableFromGrid(
  grid: string[][],
  headerAnchors: string[],
): StatementTable {
  const wanted = new Set(headerAnchors.map(normalizeHeader));
  const limit = Math.min(grid.length, MAX_PREAMBLE_ROWS);

  for (let index = 0; index < limit; index += 1) {
    const cells = grid[index] ?? [];

    if (cells.some((cell) => wanted.has(normalizeHeader(cell)))) {
      return buildTable(grid, index);
    }
  }

  throw new StatementParseError(
    "No recognisable column header was found in this file. The statement format may have changed.",
  );
}

function buildTable(grid: string[][], headerIndex: number): StatementTable {
  const rawHeaders = (grid[headerIndex] ?? []).map((cell) => cell.trim());

  // Trailing empties come from exports that pad every row to the widest one.
  // A blank header cannot be looked up by name, so its column is dropped — but
  // only after the last named column, never from the middle, where a blank
  // would mean the header row itself is misaligned with the data.
  let width = rawHeaders.length;

  while (width > 0 && rawHeaders[width - 1] === "") {
    width -= 1;
  }

  const headers = rawHeaders.slice(0, width);

  if (headers.length === 0) {
    throw new StatementParseError("This file has no column headers.");
  }

  const blankIndex = headers.indexOf("");

  if (blankIndex !== -1) {
    throw new StatementParseError(
      `Column ${blankIndex + 1} of the header row has no name, so the columns cannot be read reliably.`,
    );
  }

  const rows: Record<string, string>[] = [];

  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const cells = grid[index] ?? [];

    if (cells.every((cell) => cell.trim() === "")) {
      continue;
    }

    // A row wider than the header means the two are misaligned, and every
    // column lookup past that point would read the wrong cell.
    if (cells.length > headers.length) {
      const extra = cells.slice(headers.length).filter((cell) => cell.trim() !== "");

      if (extra.length > 0) {
        throw new StatementParseError(
          `Row ${rows.length + 1} has more values than the header has columns, so this file was not fully understood.`,
          rows.length + 1,
        );
      }
    }

    const record: Record<string, string> = {};

    headers.forEach((header, column) => {
      record[header] = (cells[column] ?? "").trim();
    });

    rows.push(record);
  }

  if (rows.length === 0) {
    throw new StatementParseError("This statement has no transaction rows.");
  }

  return { headers, rows };
}
