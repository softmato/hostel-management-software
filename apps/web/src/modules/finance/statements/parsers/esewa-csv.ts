import { readCsv } from "@/modules/finance/statements/parsers/csv";
import {
  type StatementParser,
  type StatementRow,
  StatementParseError,
  findColumn,
  hasAnyColumn,
  parseAmount,
  parseStatementDate,
  requireColumn,
} from "@/modules/finance/statements/parsers/types";

/**
 * eSewa transaction-statement CSV (target §6.4).
 *
 * eSewa exports one row per transaction with separate debit and credit columns,
 * a transaction code, the counterparty's name, and a free-text remark — which is
 * where the resident's reference code lands when they type it into the "purpose"
 * field. That remark is the whole reason Tier 0.5 works, so it is read into
 * `remarks` even though it is optional; the ladder degrades to Tier C without it
 * rather than failing.
 *
 * Column spellings vary between the web export and the app export, which is why
 * every column is looked up through an alias list.
 */

const TXN_ID_ALIASES = [
  "Transaction Code",
  "Transaction Id",
  "Txn Id",
  "Transaction Number",
  "Reference Id",
];
const DATE_ALIASES = ["Date", "Transaction Date", "Date Time", "Datetime"];
const CREDIT_ALIASES = ["Credit", "Cr Amount", "Credit Amount", "Received"];
const DEBIT_ALIASES = ["Debit", "Dr Amount", "Debit Amount", "Paid"];
const AMOUNT_ALIASES = ["Amount", "Transaction Amount"];
const NAME_ALIASES = [
  "Name",
  "Counterparty",
  "Sender Name",
  "Payer Name",
  "From",
  "Sender",
];
const REMARKS_ALIASES = [
  "Remarks",
  "Remark",
  "Description",
  "Particulars",
  "Purpose",
  "Narration",
];

export const ESEWA_CSV_PARSER: StatementParser = {
  detect(headers) {
    // Both conditions, not either: "Transaction Code" alone also appears in
    // bank exports, and matching on it would hand a bank file to this parser
    // and produce a confusing row-level error instead of "unrecognised format".
    return (
      hasAnyColumn(headers, TXN_ID_ALIASES) &&
      (hasAnyColumn(headers, CREDIT_ALIASES) ||
        hasAnyColumn(headers, AMOUNT_ALIASES))
    );
  },
  label: "eSewa statement (CSV)",
  parse(text) {
    const { rows } = readCsv(text, TXN_ID_ALIASES);

    return rows.map((row, index) => {
      const rowNumber = index + 1;
      const providerTxnId = requireColumn(
        row,
        TXN_ID_ALIASES,
        rowNumber,
        "transaction id",
      );
      const occurredAt = parseStatementDate(
        requireColumn(row, DATE_ALIASES, rowNumber, "date"),
        rowNumber,
      );

      const { amount, direction } = readMoney(row, rowNumber);

      return {
        amount,
        counterpartyName: findColumn(row, NAME_ALIASES),
        direction,
        occurredAt,
        providerTxnId,
        raw: row,
        remarks: findColumn(row, REMARKS_ALIASES),
        rowNumber,
      } satisfies StatementRow;
    });
  },
  provider: "ESEWA",
  version: "esewa-csv@1",
};

/**
 * Reads the amount from whichever shape this export uses.
 *
 * Two layouts exist in the wild: separate Credit/Debit columns, or one signed
 * Amount column. A row with **both** a credit and a debit is not a layout this
 * parser understands, and is refused rather than guessed at — picking one would
 * silently halve or double a day's takings.
 */
function readMoney(
  row: Record<string, string>,
  rowNumber: number,
): { amount: number; direction: "CREDIT" | "DEBIT" } {
  const credit = findColumn(row, CREDIT_ALIASES);
  const debit = findColumn(row, DEBIT_ALIASES);

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

  const signed = requireColumn(row, AMOUNT_ALIASES, rowNumber, "amount");
  const parsed = parseAmount(signed, rowNumber);

  return {
    amount: parsed.amount,
    direction: parsed.negative ? "DEBIT" : "CREDIT",
  };
}
