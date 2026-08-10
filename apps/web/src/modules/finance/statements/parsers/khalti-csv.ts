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
 * Khalti transaction-history CSV (target §6.4).
 *
 * Khalti's export differs from eSewa's in one way that matters: it has a single
 * signed `Amount` column plus a `Type` column saying whether the row was money
 * in or out, rather than separate debit and credit columns. Direction therefore
 * comes from `Type` when it is present and from the sign when it is not — and
 * when `Type` says something this parser has never seen, it **refuses** rather
 * than defaulting to credit. Defaulting would turn every unrecognised outgoing
 * payment into a resident's rent.
 */

const TXN_ID_ALIASES = [
  "Transaction Id",
  "Txn Id",
  "Idx",
  "Transaction Code",
  "Purchase Order Id",
];
const DATE_ALIASES = ["Created On", "Date", "Transaction Date", "Created At"];
const AMOUNT_ALIASES = ["Amount", "Total Amount", "Transaction Amount"];
const TYPE_ALIASES = ["Type", "Transaction Type", "Direction"];
const NAME_ALIASES = ["Name", "Customer Name", "Payer", "Sender", "From", "Mobile"];
const REMARKS_ALIASES = ["Remarks", "Purpose", "Description", "Product Name", "Detail"];

/** Words Khalti uses for money arriving, and for money leaving. */
const CREDIT_WORDS = ["credit", "cr", "received", "receive", "in", "deposit", "payment received"];
const DEBIT_WORDS = ["debit", "dr", "sent", "send", "out", "withdraw", "withdrawal", "payment"];

export const KHALTI_CSV_PARSER: StatementParser = {
  detect(headers) {
    return (
      hasAnyColumn(headers, TXN_ID_ALIASES) &&
      hasAnyColumn(headers, AMOUNT_ALIASES) &&
      hasAnyColumn(headers, DATE_ALIASES)
    );
  },
  label: "Khalti statement (CSV)",
  parse(text) {
    const { rows } = readCsv(text, TXN_ID_ALIASES);

    return rows.map((row, index) => {
      const rowNumber = index + 1;
      const parsed = parseAmount(
        requireColumn(row, AMOUNT_ALIASES, rowNumber, "amount"),
        rowNumber,
      );

      return {
        amount: parsed.amount,
        counterpartyName: findColumn(row, NAME_ALIASES),
        direction: resolveDirection(findColumn(row, TYPE_ALIASES), parsed.negative, rowNumber),
        occurredAt: parseStatementDate(
          requireColumn(row, DATE_ALIASES, rowNumber, "date"),
          rowNumber,
        ),
        providerTxnId: requireColumn(row, TXN_ID_ALIASES, rowNumber, "transaction id"),
        raw: row,
        remarks: findColumn(row, REMARKS_ALIASES),
        rowNumber,
      } satisfies StatementRow;
    });
  },
  provider: "KHALTI",
  version: "khalti-csv@1",
};

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
