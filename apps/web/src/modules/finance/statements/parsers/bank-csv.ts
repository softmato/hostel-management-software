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
 * Nepali bank account-statement CSV (target §6.4).
 *
 * There is no single bank format — NIC Asia, Nabil, Global IME and Siddhartha
 * each export their own columns. This parser targets the shape they share: a
 * date, a narration, separate withdrawal and deposit columns, and a running
 * balance. That shared shape is why one parser covers "BANK" rather than one per
 * bank; where a bank diverges enough to break, it earns its own `bank-<name>@1`
 * rather than a widening of this one, because every alias added here is another
 * chance to read the wrong column confidently.
 *
 * **The narration is the important field.** A bank transfer carries no
 * structured reference — the resident types the code into the "purpose" or
 * "remarks" box, and that text is the only thing linking the credit to an
 * invoice. It is read into `remarks` and passed to the ladder verbatim.
 *
 * **The cheque/instrument number is not a transaction id.** Banks reuse and
 * leave it blank; using it as the dedupe key would collapse unrelated rows onto
 * each other. Where no transaction id column exists, one is derived from the
 * fields that together identify the row — see {@link deriveTxnId}.
 */

const TXN_ID_ALIASES = [
  "Transaction Id",
  "Txn Id",
  "Reference No",
  "Reference Number",
  "Transaction Reference",
  "Tran Id",
];
const DATE_ALIASES = [
  "Date",
  "Transaction Date",
  "Value Date",
  "Txn Date",
  "Posting Date",
];
const NARRATION_ALIASES = [
  "Narration",
  "Description",
  "Particulars",
  "Remarks",
  "Transaction Remarks",
  "Details",
];
const DEPOSIT_ALIASES = ["Deposit", "Credit", "Cr Amount", "Deposit Amount", "Credit Amount"];
const WITHDRAWAL_ALIASES = [
  "Withdrawal",
  "Debit",
  "Dr Amount",
  "Withdrawal Amount",
  "Debit Amount",
];
const BALANCE_ALIASES = ["Balance", "Running Balance", "Closing Balance"];

/**
 * Columns only a bank export has.
 *
 * Needed because `Credit`/`Debit` are accepted spellings of the money columns
 * *for parsing*, and a wallet export has those too — detection on them alone
 * makes this parser claim an eSewa file. Detection has to discriminate where
 * column lookup can afford to be liberal, so it additionally requires one of
 * these. A bank whose export carries none of them is refused with a reason
 * rather than read by a parser that would misread it.
 */
const BANK_MARKERS = [
  "Narration",
  "Particulars",
  "Details",
  "Deposit",
  "Withdrawal",
  "Value Date",
];

export const BANK_CSV_PARSER: StatementParser = {
  detect(headers) {
    return (
      hasAnyColumn(headers, DATE_ALIASES) &&
      hasAnyColumn(headers, DEPOSIT_ALIASES) &&
      hasAnyColumn(headers, WITHDRAWAL_ALIASES) &&
      hasAnyColumn(headers, BANK_MARKERS)
    );
  },
  label: "bank statement (CSV)",
  parse(text) {
    const { rows } = readCsv(text, DATE_ALIASES);
    const seen = new Map<string, number>();

    return rows.map((row, index) => {
      const rowNumber = index + 1;
      const occurredAt = parseStatementDate(
        requireColumn(row, DATE_ALIASES, rowNumber, "date"),
        rowNumber,
      );
      const deposit = findColumn(row, DEPOSIT_ALIASES);
      const withdrawal = findColumn(row, WITHDRAWAL_ALIASES);

      if (deposit && withdrawal) {
        throw new StatementParseError(
          `Row ${rowNumber} has both a deposit and a withdrawal, which this parser cannot interpret.`,
          rowNumber,
        );
      }

      if (!deposit && !withdrawal) {
        throw new StatementParseError(
          `Row ${rowNumber} has neither a deposit nor a withdrawal amount.`,
          rowNumber,
        );
      }

      const narration = findColumn(row, NARRATION_ALIASES);
      const parsed = parseAmount(deposit ?? withdrawal!, rowNumber);

      return {
        amount: parsed.amount,
        // A bank narration is the payer's name *and* their message run together;
        // the ladder searches both fields, so it goes in both rather than being
        // split on a guess about where one ends.
        counterpartyName: narration,
        direction: deposit ? "CREDIT" : "DEBIT",
        occurredAt,
        providerTxnId:
          findColumn(row, TXN_ID_ALIASES) ??
          deriveTxnId(
            { amount: parsed.amount, narration, occurredAt },
            findColumn(row, BALANCE_ALIASES),
            seen,
          ),
        raw: row,
        remarks: narration,
        rowNumber,
      } satisfies StatementRow;
    });
  },
  provider: "BANK",
  version: "bank-csv@1",
};

/**
 * A stable identifier for a bank row that carries no reference number.
 *
 * Built from date, amount, narration and running balance — the fields that
 * together make a statement line unique — so that **re-importing an overlapping
 * range recognises the same row again**, which is the whole point of having a
 * transaction id at all. A random id would make every re-upload duplicate
 * everything, and using the date and amount alone would collide two residents
 * paying the same rent on the same day.
 *
 * The occurrence counter is the last resort for a bank that emits no balance:
 * two genuinely identical lines in one file get `#1` and `#2`, which is stable
 * as long as the export order is, and export order is the one thing bank
 * statements are reliably consistent about.
 */
function deriveTxnId(
  row: { amount: number; narration: string | null; occurredAt: Date },
  balance: string | null,
  seen: Map<string, number>,
): string {
  const base = [
    row.occurredAt.toISOString().slice(0, 10),
    row.amount,
    (row.narration ?? "").toUpperCase().replace(/\s+/g, " ").trim(),
    (balance ?? "").replace(/[,\s]/g, ""),
  ].join("|");

  const occurrence = (seen.get(base) ?? 0) + 1;

  seen.set(base, occurrence);

  return `derived:${base}#${occurrence}`;
}
