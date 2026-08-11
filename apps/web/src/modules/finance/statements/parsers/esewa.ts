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
 * eSewa transaction statement (target §6.4).
 *
 * **Written against a real export**, which turned out to differ from the
 * assumed shape in four ways that each made the file unreadable — every one of
 * them is pinned by a fixture in `esewa.test.ts`:
 *
 * 1. the id column is `Reference Code`, which was not among the accepted
 *    spellings, so detection refused the file outright;
 * 2. the unused side of a transaction is `0.0`, not blank, so every row looked
 *    like it carried both a debit and a credit;
 * 3. a `Total` row sits *inside* the table, carrying the month's summed amounts
 *    with no date and no reference — reading it invents a credit the size of a
 *    month's takings;
 * 4. there is a `Status` column, and `Pending`, `canceled` and `Time out` rows
 *    appear in it. Settling an invoice from a cancelled transaction is the worst
 *    outcome this parser can produce, and nothing upstream would catch it.
 *
 * **There is no remarks field.** The export carries `Description` and nothing
 * else free-text, and for a wallet transfer that reads "Fund Transferred by
 * Suman Tamang" — the payer's name, never the resident's reference code. So a
 * resident cannot get `RUP-4821-K` into an eSewa wallet statement no matter what
 * they type, and Tier A of the matching ladder is structurally unavailable for
 * this provider. The name is lifted out of the description instead, which is
 * what lets the ladder reach Tier C. That is a property of eSewa's export, not
 * a gap here, and the reconcile screen should not promise otherwise.
 */

const TXN_ID_ALIASES = [
  "Reference Code",
  "Transaction Code",
  "Transaction Id",
  "Txn Id",
  "Transaction Number",
  "Reference Id",
];
const DATE_ALIASES = ["Date Time", "Date", "Transaction Date", "Datetime"];
const CREDIT_ALIASES = ["Cr.", "Cr", "Credit", "Cr Amount", "Credit Amount", "Received"];
const DEBIT_ALIASES = ["Dr.", "Dr", "Debit", "Dr Amount", "Debit Amount", "Paid"];
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
const STATUS_ALIASES = ["Status", "Transaction Status", "State"];

/**
 * `Fund Transferred by Suman Tamang` → `Suman Tamang`.
 *
 * Both directions are captured. `by`/`from` is the payer on an incoming
 * transfer, which is the one the matching ladder needs; `to`/`for` is the
 * recipient on an outgoing one, which nothing matches against but which makes
 * the reconcile screen's debit rows readable instead of blank.
 */
const DESCRIPTION_PARTY =
  /(?:transferred|received|payment|paid|sent)\s+(?:by|from|to|for)\s+(.+)$/i;

export const ESEWA_PARSER: StatementParser = {
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
  headerAnchors: TXN_ID_ALIASES,
  label: "eSewa statement",
  parseTable({ rows }) {
    const parsed: StatementRow[] = [];
    let reachedFooter = false;

    rows.forEach((row, index) => {
      const rowNumber = index + 1;

      // Once the totals row is behind us everything below is the status tally.
      // Classifying rather than breaking keeps the guarantee that a real
      // transaction stranded below the footer is an error, not a silent drop.
      const kind = classifyRow(
        row,
        { dateAliases: DATE_ALIASES, idAliases: TXN_ID_ALIASES },
        rowNumber,
      );

      if (kind === "FOOTER") {
        reachedFooter = true;

        return;
      }

      if (reachedFooter) {
        throw new StatementParseError(
          `Row ${rowNumber} is a transaction below this statement's totals row, so this file was not fully understood.`,
          rowNumber,
        );
      }

      if (!isSettledRow(row, STATUS_ALIASES, rowNumber)) {
        return;
      }

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
      const description = findColumn(row, REMARKS_ALIASES);

      parsed.push({
        amount,
        counterpartyName: findColumn(row, NAME_ALIASES) ?? payerFrom(description),
        direction,
        occurredAt,
        providerTxnId,
        raw: row,
        remarks: description,
        rowNumber,
      });
    });

    if (parsed.length === 0) {
      throw new StatementParseError(
        "This statement has no completed transactions in it.",
      );
    }

    return parsed;
  },
  provider: "ESEWA",
  version: "esewa@2",
};

/**
 * Reads the amount from whichever shape this export uses.
 *
 * Two layouts exist in the wild: separate Credit/Debit columns, or one signed
 * Amount column. **A zero in one of a Dr/Cr pair means "not this side", not "an
 * amount of zero"** — the real export writes `0.0` rather than leaving the cell
 * empty, and reading that as a populated column made every single row look like
 * it carried both a debit and a credit.
 *
 * A row with two genuinely non-zero sides is still refused rather than guessed
 * at: picking one would silently halve or double a day's takings.
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

  // Both sides zero. Not an amount this parser can place, and not something to
  // wave through — `parseAmount` already refuses a zero, and it should here too.
  if (hasPair) {
    throw new StatementParseError(
      `Row ${rowNumber} has a zero amount on both the debit and credit sides.`,
      rowNumber,
    );
  }

  const signed = requireColumn(row, AMOUNT_ALIASES, rowNumber, "amount");
  const parsed = parseAmount(signed, rowNumber);

  return {
    amount: parsed.amount,
    direction: parsed.negative ? "DEBIT" : "CREDIT",
  };
}

/** `"0.0"`, `"0"`, `"0.00"` all mean the column is not the one in play. */
function nonZero(value: string | null): string | null {
  if (value === null) return null;

  const numeric = Number(value.replace(/[,\s]/g, ""));

  return Number.isFinite(numeric) && numeric === 0 ? null : value;
}

function payerFrom(description: string | null): string | null {
  if (!description) return null;

  const match = DESCRIPTION_PARTY.exec(description.trim());

  return match?.[1]?.trim() || null;
}
