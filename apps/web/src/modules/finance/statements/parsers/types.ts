import { FinanceServiceError } from "@/modules/finance/finance.errors";

/**
 * The contract every statement parser implements (target §6.4).
 *
 * A parser's job is to turn one provider's export into rows this system can
 * match, or to **refuse**. There is no third outcome, and that is the single
 * most important rule in this directory: a statement import that reads 60 of 84
 * rows and says nothing is worse than one that fails, because the 24 missing
 * rows are indistinguishable from residents who did not pay. Every helper below
 * throws rather than skipping, and `parse` has no "errors" channel to drain into
 * a warning nobody reads.
 *
 * Pure module: no I/O, no database, no clock. Parsers are given text and return
 * rows, which is what makes golden-file testing against real exports possible.
 */

export type StatementProvider = "ESEWA" | "KHALTI" | "BANK";

export type StatementRow = {
  /** Whole NPR rupees, always positive; `direction` carries the sign. */
  amount: number;
  /** Who the money came from, as the provider spells it. Fuzzy-matched later. */
  counterpartyName: string | null;
  direction: "CREDIT" | "DEBIT";
  /** When the money moved, per the provider — not when we read the file. */
  occurredAt: Date;
  /** The provider's own transaction id. The dedupe key; never synthesised. */
  providerTxnId: string;
  /** The whole source record, kept verbatim for `PaymentEvent.rawPayload`. */
  raw: Record<string, string>;
  /** Free text where a resident's reference code is most likely to appear. */
  remarks: string | null;
  /** 1-based data row, so an error can point at a line the owner can find. */
  rowNumber: number;
};

export type StatementParseResult = {
  parserVersion: string;
  provider: StatementProvider;
  rows: StatementRow[];
};

export type StatementParser = {
  /**
   * Whether this parser recognises the file, judged from its header row alone.
   *
   * Kept separate from `parse` so an unrecognised format fails with "no parser
   * recognises this file" before any row is read, rather than as a confusing
   * error about row 3.
   */
  detect(headers: string[]): boolean;
  /** Human name for the picker and for error messages. */
  label: string;
  parse(text: string): StatementRow[];
  provider: StatementProvider;
  /**
   * `esewa-csv@1`. Stored on the import, so "which parser produced these rows?"
   * is answerable after the code has moved on (target §6.4).
   */
  version: string;
};

/**
 * The only error a parser raises. Carries the row number when it has one, so
 * the owner is told *where* the file stopped making sense.
 */
export class StatementParseError extends FinanceServiceError {
  rowNumber: number | null;

  constructor(message: string, rowNumber: number | null = null) {
    super(message, "STATEMENT_UNREADABLE");
    this.name = "StatementParseError";
    this.rowNumber = rowNumber;
  }
}

/** Header keys compared without case, spacing or punctuation. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Finds a column by any of its accepted spellings.
 *
 * Providers rename columns between exports without notice ("Txn ID" becoming
 * "Transaction Id"), so each parser lists the spellings it has seen. An alias
 * that stops appearing is not silently tolerated: `requireColumn` is what
 * callers use for anything the match depends on.
 */
export function findColumn(
  row: Record<string, string>,
  aliases: string[],
): string | null {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]),
  );

  for (const alias of aliases) {
    const value = normalized.get(normalizeHeader(alias));

    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

export function requireColumn(
  row: Record<string, string>,
  aliases: string[],
  rowNumber: number,
  label: string,
): string {
  const value = findColumn(row, aliases);

  if (value === null) {
    throw new StatementParseError(
      `Row ${rowNumber} has no ${label}. The statement format may have changed.`,
      rowNumber,
    );
  }

  return value;
}

export function hasAnyColumn(headers: string[], aliases: string[]): boolean {
  const normalized = new Set(headers.map(normalizeHeader));

  return aliases.some((alias) => normalized.has(normalizeHeader(alias)));
}

/**
 * Parses a money column into whole rupees.
 *
 * Strips thousands separators, currency words and the parenthesised-negative
 * convention some bank exports use. A trailing `.00` is accepted because every
 * provider writes one; **a non-zero fraction is a hard failure**, not a rounding
 * opportunity — ADR-1's guarantee that summing the ledger is exact holds only
 * while nothing writes a paisa, and quietly discarding one here would put the
 * discrepancy in the drift report of whoever inherits this.
 */
export function parseAmount(
  raw: string,
  rowNumber: number,
): { amount: number; negative: boolean } {
  const trimmed = raw.trim();
  const parenthesised = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/[()]/g, "")
    .replace(/(npr|rs\.?|nrs\.?|₹|रु)/gi, "")
    .replace(/,/g, "")
    .replace(/\s/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new StatementParseError(
      `Row ${rowNumber} has an amount this parser cannot read: "${raw}".`,
      rowNumber,
    );
  }

  const value = Number(cleaned);
  const magnitude = Math.abs(value);

  if (!Number.isInteger(magnitude)) {
    throw new StatementParseError(
      `Row ${rowNumber} has a part-rupee amount (${raw}). This system records whole rupees only.`,
      rowNumber,
    );
  }

  if (magnitude === 0) {
    throw new StatementParseError(
      `Row ${rowNumber} has a zero amount.`,
      rowNumber,
    );
  }

  return { amount: magnitude, negative: parenthesised || value < 0 };
}

/**
 * Parses a date in one of the shapes providers actually export.
 *
 * **`DD/MM/YYYY` is read day-first, and that is a decision, not an assumption**
 * — every provider here is Nepali and exports day-first. Guessing per row from
 * whether the first field exceeds 12 would read `03/04/2025` differently from
 * `13/04/2025` in the same file, which is how a payment silently lands in the
 * wrong month. A parser whose provider is ever seen exporting month-first must
 * declare it, not have it inferred.
 *
 * Dates are read as local time deliberately: a statement's timestamps are wall
 * clock in Kathmandu, and forcing UTC would shift late-evening payments into the
 * next day and out of their billing period.
 */
export function parseStatementDate(raw: string, rowNumber: number): Date {
  const trimmed = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    trimmed,
  );

  if (iso) {
    return build(iso[1]!, iso[2]!, iso[3]!, iso[4], iso[5], iso[6]);
  }

  const dayFirst =
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      trimmed,
    );

  if (dayFirst) {
    return build(dayFirst[3]!, dayFirst[2]!, dayFirst[1]!, dayFirst[4], dayFirst[5], dayFirst[6]);
  }

  throw new StatementParseError(
    `Row ${rowNumber} has a date this parser cannot read: "${raw}".`,
    rowNumber,
  );

  function build(
    year: string,
    month: string,
    day: string,
    hour?: string,
    minute?: string,
    second?: string,
  ): Date {
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0),
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      throw new StatementParseError(
        `Row ${rowNumber} has an impossible date: "${raw}".`,
        rowNumber,
      );
    }

    return date;
  }
}
