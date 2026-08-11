import {
  type StatementParser,
  type StatementRow,
  StatementParseError,
  classifyRow,
  findColumn,
  hasAnyColumn,
  isSettledRow,
  parseAmount,
  parseStatementDate,
  requireColumn,
} from "@/modules/finance/statements/parsers/types";

/**
 * Khalti transaction history (target §6.4).
 *
 * **Written against a real export**, which is a different shape from the one
 * this parser originally assumed, in four ways:
 *
 * 1. money is in a **pair** of columns, `Amount(-) Rs` and `Amount(+) Rs`, not
 *    one signed `Amount` steered by a `Type` word;
 * 2. those two names normalise to the same key once punctuation is stripped, so
 *    `normalizeHeader` had to learn to keep a standalone sign — without that
 *    fix the credit column overwrites the debit one and every outgoing payment
 *    reads as money received;
 * 3. the timestamp is split across `Transaction Date` and `Transaction Time`;
 * 4. there is a `Transaction State` column, so cancelled and pending rows are
 *    present and must not settle anything.
 *
 * The older single-`Amount`-plus-`Type` layout is still supported, because a
 * hostel may hold exports from before Khalti changed it.
 *
 * **Unlike eSewa, Khalti carries free text a resident can actually write in** —
 * `Purpose`, `Remarks` and `Reference` are all present — so Tier A of the
 * matching ladder is available here. All three are collected, because a code
 * could land in any of them depending on which screen the resident paid from.
 */

const TXN_ID_ALIASES = [
  "Transaction ID",
  "Transaction Id",
  "Txn Id",
  "Idx",
  "Transaction Code",
  "Purchase Order Id",
];
const DATE_ALIASES = ["Transaction Date", "Created On", "Date", "Created At"];
const TIME_ALIASES = ["Transaction Time", "Time"];
const STATE_ALIASES = ["Transaction State", "Status", "Transaction Status", "State"];
const CREDIT_ALIASES = ["Amount(+) Rs", "Amount(+)", "Credit", "Cr Amount", "Received"];
const DEBIT_ALIASES = ["Amount(-) Rs", "Amount(-)", "Debit", "Dr Amount", "Sent"];
const AMOUNT_ALIASES = ["Amount", "Total Amount", "Transaction Amount"];
const TYPE_ALIASES = ["Type", "Direction"];
const FROM_ALIASES = ["From", "Sender", "Payer"];
const TO_ALIASES = ["To", "Receiver", "Payee"];
const NAME_ALIASES = ["Name", "Customer Name", "Fullname", "Username", "Mobile"];
/** Every field a human could have typed a reference code into. */
const REMARKS_ALIASES = ["Remarks", "Purpose", "Reference", "Detail", "Product Name"];
const DESCRIPTION_ALIASES = ["Description", "Service", "Transaction Type"];

/** Words Khalti uses for money arriving, and for money leaving. */
const CREDIT_WORDS = [
  "credit",
  "cr",
  "received",
  "receive",
  "in",
  "deposit",
  "payment received",
];
const DEBIT_WORDS = [
  "debit",
  "dr",
  "sent",
  "send",
  "out",
  "withdraw",
  "withdrawal",
  "payment",
];

export const KHALTI_CSV_PARSER: StatementParser = {
  detect(headers) {
    return (
      hasAnyColumn(headers, TXN_ID_ALIASES) &&
      hasAnyColumn(headers, DATE_ALIASES) &&
      (hasAnyColumn(headers, AMOUNT_ALIASES) ||
        hasAnyColumn(headers, CREDIT_ALIASES) ||
        hasAnyColumn(headers, DEBIT_ALIASES))
    );
  },
  headerAnchors: TXN_ID_ALIASES,
  label: "Khalti statement",
  parseTable({ rows }) {
    const parsed: StatementRow[] = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 1;

      if (
        classifyRow(
          row,
          { dateAliases: DATE_ALIASES, idAliases: TXN_ID_ALIASES },
          rowNumber,
        ) === "FOOTER"
      ) {
        return;
      }

      if (!isSettledRow(row, STATE_ALIASES, rowNumber)) {
        return;
      }

      const { amount, direction } = readMoney(row, rowNumber);

      parsed.push({
        amount,
        counterpartyName: counterparty(row, direction),
        direction,
        occurredAt: parseStatementDate(timestamp(row, rowNumber), rowNumber),
        providerTxnId: requireColumn(row, TXN_ID_ALIASES, rowNumber, "transaction id"),
        raw: row,
        remarks: remarksFrom(row),
        rowNumber,
      } satisfies StatementRow);
    });

    if (parsed.length === 0) {
      throw new StatementParseError(
        "This statement has no completed transactions in it.",
      );
    }

    return parsed;
  },
  provider: "KHALTI",
  version: "khalti@2",
};

/**
 * The date and the time, which the real export keeps in separate columns.
 *
 * Joined rather than taking the date alone: two transfers of the same amount on
 * the same day are common, and without the time the matching ladder cannot tell
 * them apart or order them.
 */
function timestamp(row: Record<string, string>, rowNumber: number): string {
  const date = requireColumn(row, DATE_ALIASES, rowNumber, "date");
  const time = findColumn(row, TIME_ALIASES);

  // A date column that already carries a time needs nothing appended; the older
  // layout writes "2026-08-03 10:05:11" in one cell.
  if (!time || /\d:\d/.test(date)) {
    return date;
  }

  return `${date} ${time}`;
}

/**
 * Reads the amount from whichever layout this export uses.
 *
 * A zero or blank in one side of the pair means "not this side". Two genuinely
 * non-zero sides are refused rather than guessed at.
 */
function readMoney(
  row: Record<string, string>,
  rowNumber: number,
): { amount: number; direction: "CREDIT" | "DEBIT" } {
  const credit = nonZero(findColumn(row, CREDIT_ALIASES));
  const debit = nonZero(findColumn(row, DEBIT_ALIASES));

  if (credit && debit) {
    throw new StatementParseError(
      `Row ${rowNumber} has both a credit and a debit amount, which this parser cannot interpret.`,
      rowNumber,
    );
  }

  if (credit) {
    return { amount: parseAmount(credit, rowNumber).amount, direction: "CREDIT" };
  }

  if (debit) {
    return { amount: parseAmount(debit, rowNumber).amount, direction: "DEBIT" };
  }

  const hasPair =
    findColumn(row, CREDIT_ALIASES) !== null || findColumn(row, DEBIT_ALIASES) !== null;

  if (hasPair) {
    throw new StatementParseError(
      `Row ${rowNumber} has a zero amount on both the credit and debit sides.`,
      rowNumber,
    );
  }

  const signed = parseAmount(
    requireColumn(row, AMOUNT_ALIASES, rowNumber, "amount"),
    rowNumber,
  );

  return {
    amount: signed.amount,
    direction: resolveDirection(findColumn(row, TYPE_ALIASES), signed.negative, rowNumber),
  };
}

/**
 * Who the money came from, or went to.
 *
 * Direction decides which column to read: on an incoming transfer the payer is
 * in `From`, and reading `To` there would name the hostel's own wallet on every
 * single row and match nobody.
 *
 * The trailing `(9709155982)` is stripped from the name but kept in the raw row,
 * so name similarity is scored against a name rather than against a name plus
 * ten digits that are the same length as it.
 */
function counterparty(
  row: Record<string, string>,
  direction: "CREDIT" | "DEBIT",
): string | null {
  const party =
    findColumn(row, direction === "CREDIT" ? FROM_ALIASES : TO_ALIASES) ??
    findColumn(row, NAME_ALIASES);

  if (!party) return null;

  return party.replace(/\s*\([^)]*\)\s*$/, "").trim() || party.trim();
}

/**
 * Every free-text field joined, because a resident's reference code could be in
 * any of them.
 *
 * `Description` is included only as a fallback — it is provider-generated prose
 * ("Payment of Rs 600.0 to …"), and putting it alongside the typed fields on
 * every row would bury a real remark in boilerplate.
 */
function remarksFrom(row: Record<string, string>): string | null {
  const typed = REMARKS_ALIASES.map((alias) => findColumn(row, [alias])).filter(
    (value): value is string => Boolean(value),
  );
  const unique = [...new Set(typed)];

  if (unique.length > 0) {
    return unique.join(" · ");
  }

  return findColumn(row, DESCRIPTION_ALIASES);
}

function resolveDirection(
  type: string | null,
  negative: boolean,
  rowNumber: number,
): "CREDIT" | "DEBIT" {
  if (!type) {
    return negative ? "DEBIT" : "CREDIT";
  }

  const word = type.trim().toLowerCase();

  if (CREDIT_WORDS.includes(word)) {
    return "CREDIT";
  }

  if (DEBIT_WORDS.includes(word)) {
    return "DEBIT";
  }

  // Never a default. An unrecognised type silently read as CREDIT turns every
  // outgoing payment into somebody's rent.
  throw new StatementParseError(
    `Row ${rowNumber} has a transaction type this parser does not recognise: "${type}".`,
    rowNumber,
  );
}

/** `"0.00"`, `"0"` and blank all mean the column is not the one in play. */
function nonZero(value: string | null): string | null {
  if (value === null) return null;

  const numeric = Number(value.replace(/[,\s]/g, ""));

  return Number.isFinite(numeric) && numeric === 0 ? null : value;
}
