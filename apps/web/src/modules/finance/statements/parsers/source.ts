import { readCsv, peekHeaders } from "@/modules/finance/statements/parsers/csv";
import {
  headerCandidates,
  isWorkbook,
  readWorkbook,
} from "@/modules/finance/statements/parsers/workbook";
import {
  type StatementTable,
  StatementParseError,
} from "@/modules/finance/statements/parsers/types";

/**
 * One uploaded statement, whatever shape it arrived in (target §6.4).
 *
 * The format is decided by **magic bytes, never the filename or the declared
 * MIME type**. Both of those are the client's word: browsers disagree about
 * whether a `.csv` is `text/csv` or `text/plain`, and an owner who renames
 * `statement.xls` to `statement.csv` because an earlier version of this screen
 * demanded it would otherwise have their file read as text and fail with a
 * baffling error about row 1.
 */

export type StatementBytes = {
  bytes: Buffer;
  fileName: string | null;
};

export function readStatementTable(
  source: StatementBytes,
  headerAnchors: string[],
): StatementTable {
  if (isWorkbook(source.bytes)) {
    return readWorkbook(source.bytes, headerAnchors);
  }

  return readCsv(decodeText(source.bytes), headerAnchors);
}

/**
 * The headers the registry shows each parser, so detection works before a
 * format is committed to.
 *
 * A workbook cannot be sniffed cheaply the way a CSV's first lines can, so it is
 * opened once here and once again in {@link readStatementTable}. That is a
 * deliberate trade: statements are capped well below the size where reading a
 * sheet twice matters, and threading a half-parsed workbook through the registry
 * would couple detection to the format it is supposed to be independent of.
 */
export function peekStatementHeaders(source: StatementBytes): string[] {
  if (!isWorkbook(source.bytes)) {
    return peekHeaders(decodeText(source.bytes));
  }

  // Detection needs headers, but finding headers in a workbook needs anchors,
  // which is what detection is trying to establish. Broken by reading the sheet
  // with no anchors at all: every non-empty cell in the first rows becomes a
  // candidate header, exactly as `peekHeaders` does for CSV.
  try {
    return headerCandidates(source.bytes);
  } catch {
    return [];
  }
}

/**
 * Bytes to text, refusing anything that is not valid UTF-8.
 *
 * `Buffer.toString("utf8")` replaces undecodable bytes with U+FFFD and reports
 * nothing, so a Windows-1252 export with a Nepali name in it would parse
 * "successfully" into mojibake and match against nobody. Better to say the
 * encoding is wrong.
 */
function decodeText(bytes: Buffer): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  if (text.includes("�")) {
    throw new StatementParseError(
      "This file is not valid UTF-8 text. Re-export it, or upload the original .xls or .xlsx instead.",
    );
  }

  return text;
}
