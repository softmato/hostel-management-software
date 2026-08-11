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

/**
 * A statement reduced to a header row and its data rows.
 *
 * **This is the seam that makes the file format irrelevant.** CSV, `.xls` and
 * `.xlsx` all arrive here as the same table, so the row-mapping below — which is
 * where every provider quirk and every safety check lives — is written once. The
 * alternative, a parser per provider per format, is nine places for the same
 * "cancelled transactions do not count" rule to drift apart in.
 */
export type StatementTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export type StatementParser = {
  /**
   * Whether this parser recognises the file, judged from its header row alone.
   *
   * Kept separate from `parseTable` so an unrecognised format fails with "no
   * parser recognises this file" before any row is read, rather than as a
   * confusing error about row 3.
   */
  detect(headers: string[]): boolean;
  /**
   * Column spellings that mark the header row.
   *
   * Exports open with title and account-summary lines, so the header has to be
   * *found* rather than assumed to be line one. These must name columns the
   * provider always emits — an optional column here would match a summary line
   * and take the preamble as the table.
   */
  headerAnchors: string[];
  /** Human name for the picker and for error messages. */
  label: string;
  parseTable(table: StatementTable): StatementRow[];
  provider: StatementProvider;
  /**
   * `esewa@2`. Stored on the import, so "which parser produced these rows?"
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

/**
 * Header keys compared without case, spacing or punctuation.
 *
 * **A standalone `+` or `-` survives as a word, and that is load-bearing.**
 * Khalti's real export names its two money columns `Amount(-) Rs` and
 * `Amount(+) Rs`; stripping all punctuation collapses both to `amountrs`, and
 * since lookups go through a map keyed on the normalised name, the credit column
 * would silently overwrite the debit one. Every outgoing payment would then read
 * as money received.
 *
 * Only a *standalone* sign is kept — one with no letter or digit on either side,
 * as in `(-)`. A hyphen joining two words (`Debit-Amount`) is still punctuation
 * and is still stripped, so it goes on matching the alias `Debit Amount`.
 */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/(?<![a-z0-9])\+(?![a-z0-9])/g, "plus")
    .replace(/(?<![a-z0-9])-(?![a-z0-9])/g, "minus")
    .replace(/[^a-z0-9]/g, "");
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
 * Statuses that mean the money actually moved.
 *
 * An allowlist, not a blocklist of the failures seen in one export. A status
 * nobody has seen before must stop the import and get a human's attention —
 * treating an unknown status as settled is how a new `REVERSED` quietly starts
 * paying off invoices the day a provider introduces it.
 *
 * Shared rather than written per provider on purpose: "a cancelled transaction
 * does not settle an invoice" is the single most consequential rule in this
 * directory, and it must not be able to drift between eSewa and Khalti.
 */
const SETTLED_STATUSES = new Set([
  "complete",
  "completed",
  "success",
  "successful",
]);

/** Statuses that legitimately appear and are simply not money. */
const UNSETTLED_STATUSES = new Set([
  "cancel",
  "canceled",
  "cancelled",
  "expired",
  "fail",
  "failed",
  "initiated",
  "pending",
  "processing",
  "refunded",
  "reversed",
  "timeout",
]);

/**
 * Whether this row represents money that actually moved.
 *
 * An export with no status column at all is treated as settled — some older
 * exports have none, and every row in those is a completed transaction.
 */
export function isSettledRow(
  row: Record<string, string>,
  statusAliases: string[],
  rowNumber: number,
): boolean {
  const status = findColumn(row, statusAliases);

  if (!status) {
    return true;
  }

  const normalized = status.toLowerCase().replace(/[^a-z]/g, "");

  if (SETTLED_STATUSES.has(normalized)) {
    return true;
  }

  if (UNSETTLED_STATUSES.has(normalized)) {
    return false;
  }

  throw new StatementParseError(
    `Row ${rowNumber} has a status this parser does not recognise ("${status}"), so it cannot tell whether the money moved.`,
    rowNumber,
  );
}

/**
 * Labels a provider puts in the first column of a footer block.
 *
 * eSewa's export closes with a `Total` row inside the table and then a
 * status tally (`Total 6`, `Pending 0`, `Complete 6`, `canceled 0`, `Time out
 * 0`). None of it is a transaction, and the `Total` row in particular carries
 * real-looking amounts — reading it would invent a credit equal to the whole
 * month's takings.
 */
const SUMMARY_LABELS = new Set([
  "balance",
  "canceled",
  "cancelled",
  "closingbalance",
  "complete",
  "completed",
  "expired",
  "failed",
  "grandtotal",
  "openingbalance",
  "pending",
  "subtotal",
  "summary",
  "timeout",
  "total",
]);

/**
 * How a row below the header should be treated.
 *
 * The three outcomes are deliberate and there is no fourth. A row is a
 * transaction, or it is recognisably part of a footer, or **the file stops being
 * read**. What must never happen is a row quietly dropped for looking odd: the
 * dropped rows would be indistinguishable from residents who never paid, which
 * is the failure this whole directory is built around (target §6.4).
 *
 * The distinction that carries the weight is between eSewa's totals row — blank
 * reference, blank date, but amounts present — and a genuine transaction that
 * lost its id. Both have money on them; only the second has a date. So a row
 * with no identifier is footer *only* while it also has no date, and is an error
 * otherwise.
 */
export function classifyRow(
  row: Record<string, string>,
  options: { dateAliases: string[]; idAliases: string[] },
  rowNumber: number,
): "DATA" | "FOOTER" {
  const id = findColumn(row, options.idAliases);
  const date = findColumn(row, options.dateAliases);
  const firstValue = Object.values(row).find((value) => value.trim() !== "");

  // Checked first, and that ordering is the whole trick. eSewa's tally block
  // reads `Total | 6`, whose two cells land under the reference and date
  // columns — so by every structural test it looks like a transaction, and only
  // the label gives it away. A real transaction cannot collide with this: the
  // first populated cell of one is its reference code, never the word "total".
  if (firstValue !== undefined && SUMMARY_LABELS.has(normalizeHeader(firstValue))) {
    return "FOOTER";
  }

  // Bank exports frequently carry no transaction id at all — the bank parser
  // derives one — so for those the date alone decides. Passing no id aliases is
  // how a parser declares that.
  if (options.idAliases.length === 0) {
    if (date) return "DATA";
  } else if (id && date) {
    return "DATA";
  }

  if (!id && !date) {
    return "FOOTER";
  }

  throw new StatementParseError(
    date
      ? `Row ${rowNumber} has a date but no transaction id, so this file was not fully understood.`
      : `Row ${rowNumber} has a transaction id but no readable date, so this file was not fully understood.`,
    rowNumber,
  );
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
