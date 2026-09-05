import type { ResidentInvoice } from "@/lib/finance-api";

/**
 * An invoice's money, as a statement that ties out.
 *
 * The resident's question on this screen is never "what is the status enum" —
 * it is "I paid NPR 4,000 last week, why does it still say I owe money". So the
 * detail view is a running balance: the charge, then every settled payment, and
 * what is left after each.
 *
 * ## The line that makes it honest
 *
 * `paidAmount` comes from the ledger — the sum of settled payment events.
 * `receipts` is a different set: receipts voided when their payment was
 * reversed are **excluded** by the server, so a resident cannot keep a document
 * asserting a payment the ledger no longer counts. The two therefore disagree
 * whenever a payment settled without a receipt issued yet, or a receipt was
 * voided.
 *
 * A statement built from receipts alone would end on a balance that does not
 * match the number in bold at the top of the same screen, which reads as a bug
 * in the hostel's accounting. So the difference is emitted as its own line
 * rather than absorbed silently: the rows always sum to `paidAmount`, and the
 * closing balance always equals the headline.
 */

export type LedgerLine = {
  /** Signed: the charge is positive, payments are negative. */
  amount: number;
  /** What is still owed after this line. */
  balance: number;
  date: string | null;
  kind: "charge" | "receipt" | "unreceipted";
  label: string;
};

export function invoiceLedger(invoice: ResidentInvoice): LedgerLine[] {
  const lines: LedgerLine[] = [];
  let balance = invoice.dueAmount;

  lines.push({
    amount: invoice.dueAmount,
    balance,
    date: invoice.dueDate ?? null,
    kind: "charge",
    label: "Amount billed",
  });

  // The server sorts receipts newest-first for the list view; a running balance
  // only reads correctly the other way round.
  const receipts = [...invoice.receipts].sort((a, b) => {
    const left = a.issuedAt ? Date.parse(a.issuedAt) : 0;
    const right = b.issuedAt ? Date.parse(b.issuedAt) : 0;

    return left - right;
  });

  let receipted = 0;

  for (const receipt of receipts) {
    balance -= receipt.amount;
    receipted += receipt.amount;

    lines.push({
      amount: -receipt.amount,
      balance,
      date: receipt.issuedAt,
      kind: "receipt",
      label: `Receipt ${receipt.number}`,
    });
  }

  // Rounded to paisa before comparing: floating-point subtraction on two equal
  // amounts can leave a 1e-13 residue, and a "NPR 0.00 settled elsewhere" row
  // is worse than the gap it explains.
  const unreceipted = Math.round((invoice.paidAmount - receipted) * 100) / 100;

  if (unreceipted > 0) {
    balance -= unreceipted;

    lines.push({
      amount: -unreceipted,
      balance,
      date: invoice.paidDate ?? null,
      kind: "unreceipted",
      label: "Settled, receipt pending",
    });
  }

  return lines;
}

/** What the headline shows: never negative, because an overpayment is credit. */
/**
 * What to call an invoice that belongs to no month.
 *
 * `Invoice.period` is nullable and one-off invoices have no month — an
 * admission fee is the one every resident gets. Every screen renders the month
 * through `formatPeriod`, which correctly answers `—` for a null, and a list row
 * titled `—` over a due date is a row that names nothing. On the Payments tab
 * that dash was also the *focus* invoice's name on the painted card, so a new
 * resident whose only open bill was their admission fee opened the screen to
 * `Next due: —`.
 *
 * The invoice already knows what it is: its first line's description is the
 * charge itself ("Admission fee", "Security deposit"), snapshotted when the
 * invoice was issued and therefore still right after the fee schedule it came
 * from is closed. Migrated history has no lines, so the fallback is a plain
 * noun rather than a dash.
 *
 * Returns `null` for an invoice that *does* have a month, so a caller can write
 * `oneOffLabel(invoice) ?? dates.period(invoice.month)` and get the month
 * whenever there is one.
 */
export function oneOffLabel(invoice: ResidentInvoice): string | null {
  if (invoice.month) {
    return null;
  }

  const charges = chargeDescriptions(invoice);

  return charges.length > 0 ? charges.join(" + ") : "One-off invoice";
}

/**
 * The charges on a one-off invoice, in the order they were written.
 *
 * Credits are left out — a referral discount is not a thing the resident is
 * being asked to pay for, and "Admission fee + Referral discount" reads as two
 * charges. Positive lines only, so the label lists what the money is *for*.
 *
 * This is why joining reads `Admission fee + Security deposit` rather than
 * `Admission fee`: both are on one invoice under one reference code, and a
 * label naming only the first understates what is owed by the size of the
 * deposit — which is usually the larger half.
 */
function chargeDescriptions(invoice: ResidentInvoice): string[] {
  return invoice.lines
    .filter((line) => line.amount > 0 && line.description.trim().length > 0)
    .map((line) => line.description.trim());
}

/**
 * What a list row calls an invoice, and what it says underneath.
 *
 * ## Why the month was the wrong title
 *
 * The row used to be titled `Bhadra` over `Due Aswin 15`. Two month names, one
 * row, nothing saying which was which — and neither of them says what the row
 * *is*. A resident scanning their payments wants to know "rent" before they want
 * to know "Bhadra"; the month is which rent, not what.
 *
 * So the charge leads and the month explains it: **Monthly rent** over **Due
 * Bhadra**. The one-off invoice already had a charge to lead with — its lines —
 * and now names both of them.
 *
 * ## And a part month says which days instead
 *
 * A resident admitted mid-month owes part of it, and a row reading `Monthly
 * rent` over `Due Bhadra` leaves the smaller figure beside it unexplained —
 * which is the one thing on this screen somebody is most likely to query.
 * `prorationBasis` is snapshotted on the line at issue time and already reads
 * `Bhadra 19–31 · 13 of 31 days`, so the row carries it verbatim rather than
 * re-deriving a span from dates the client would have to convert itself.
 *
 * It **replaces** the due line rather than joining it. Both would be three
 * facts on one row of a list, and the span already names the month — so `Due
 * Bhadra · Bhadra 19–31 · 13 of 31 days` says "Bhadra" twice to fit less in.
 *
 * Pure, and tested, because this is the sentence a resident reads before
 * deciding whether their bill is right.
 */
export type InvoiceRowCopy = {
  /** The days a part month covers, or null when the whole month is charged. */
  proration: string | null;
  /** `Due Bhadra`, or the days a part month covers, or a one-off's due date. */
  subtitle: string;
  /** `Monthly rent`, or `Admission fee + Security deposit`. */
  title: string;
};

export function invoiceRowCopy(
  invoice: ResidentInvoice,
  monthLabel: (period: string | null) => string,
  dateLabel: (date: string | null | undefined) => string,
): InvoiceRowCopy {
  const proration =
    invoice.lines.find((line) => line.prorationBasis)?.prorationBasis?.trim() || null;

  if (!invoice.month) {
    return {
      proration,
      subtitle: invoice.dueDate ? `Due ${dateLabel(invoice.dueDate)}` : "Payable now",
      title: oneOffLabel(invoice) ?? "One-off invoice",
    };
  }

  return {
    proration,
    /*
     * The billing month, not the due date. Those are different facts — Bhadra's
     * rent falls due on Bhadra 31 — and the row used to show only the second,
     * in a title that read like a date.
     */
    subtitle: proration ?? `Due ${monthLabel(invoice.month)}`,
    title: "Monthly rent",
  };
}

export function outstanding(invoice: ResidentInvoice): number {
  return Math.max(invoice.dueAmount - invoice.paidAmount, 0);
}

/**
 * Sums what is still owed across every invoice.
 *
 * Matches the server's own `buildFeeSummary`: only the statuses that still
 * represent an obligation count, and each is floored at zero so a month that
 * was overpaid cannot mask a month that was not.
 */
const OPEN_STATUSES = ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF", "OPEN"];

export function totalOutstanding(invoices: ResidentInvoice[]): number {
  return invoices.reduce(
    (sum, invoice) =>
      OPEN_STATUSES.includes(invoice.status) ? sum + outstanding(invoice) : sum,
    0,
  );
}

/** Is this month still an obligation? The same list `totalOutstanding` sums. */
export function isOpenInvoice(invoice: ResidentInvoice): boolean {
  return OPEN_STATUSES.includes(invoice.status);
}

export type PaymentFilter = "all" | "open" | "settled";

export function filterInvoices(
  invoices: ResidentInvoice[],
  filter: PaymentFilter,
): ResidentInvoice[] {
  if (filter === "all") {
    return invoices;
  }

  return invoices.filter((invoice) =>
    filter === "open" ? isOpenInvoice(invoice) : !isOpenInvoice(invoice),
  );
}

export type PaymentStats = {
  /** The month the resident is actually here to deal with, or null. */
  nextDue: ResidentInvoice | null;
  /** The most recent month with money against it, for "you last paid…". */
  lastPaid: ResidentInvoice | null;
  overdueCount: number;
  settledCount: number;
};

/**
 * The four facts the payments screen leads with, ported from the web's `stats`.
 *
 * **`nextDue` is the earliest open month, not the newest.** The list arrives
 * newest-first, so taking the first open row would point a resident who is two
 * months behind at August while July quietly ages into a default. The one to
 * settle first is always the oldest debt.
 *
 * A missing `dueDate` sorts last rather than first: an invoice with no date is
 * not urgent, and treating absent as epoch-zero would put it above every real
 * one.
 */
export function paymentStats(invoices: ResidentInvoice[]): PaymentStats {
  const open = invoices.filter(isOpenInvoice);

  const nextDue =
    [...open].sort((left, right) => {
      const leftDue = left.dueDate ? Date.parse(left.dueDate) : Number.POSITIVE_INFINITY;
      const rightDue = right.dueDate ? Date.parse(right.dueDate) : Number.POSITIVE_INFINITY;

      return leftDue - rightDue;
    })[0] ?? null;

  const lastPaid =
    [...invoices]
      .filter((invoice) => invoice.paidAmount > 0)
      .sort((left, right) => {
        const leftPaid = left.paidDate ? Date.parse(left.paidDate) : 0;
        const rightPaid = right.paidDate ? Date.parse(right.paidDate) : 0;

        return rightPaid - leftPaid;
      })[0] ?? null;

  return {
    lastPaid,
    nextDue,
    overdueCount: invoices.filter((invoice) => invoice.status === "OVERDUE").length,
    settledCount: invoices.filter((invoice) => !isOpenInvoice(invoice)).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Grouping                                                                   */
/* -------------------------------------------------------------------------- */

export type InvoiceYear = {
  invoices: ResidentInvoice[];
  /** `"2026"` / `"2083 BS"`, or `null` for the rows that carry no date at all. */
  year: string | null;
};

/**
 * The Gregorian year an invoice belongs to, straight off its date strings.
 *
 * `slice(0, 4)` on both: `month` is `YYYY-MM` and `dueDate` is an ISO instant,
 * and the year is the first four characters of each. Parsing the instant would
 * move a January due date into the previous year for a phone west of UTC, which
 * is a row in the wrong section for no gain.
 *
 * The default, and correct only for a reader on the Gregorian calendar — see
 * {@link groupInvoicesByYear}.
 */
export function gregorianInvoiceYear(invoice: ResidentInvoice): string | null {
  return invoice.month?.slice(0, 4) ?? invoice.dueDate?.slice(0, 4) ?? null;
}

/**
 * The invoice list, cut into years.
 *
 * `NOTES.md` §5 — "lists are grouped by date, headings outside the cards" — is
 * the reference set's most repeated list rule, and it is what the payments
 * screen was missing: a flat card of twenty rows, each one a month, with the
 * year written nowhere. A resident in their second year had `Jan` twice in one
 * column with nothing to tell the two apart.
 *
 * ## Where the year comes from when there is no month
 *
 * `month` is `null` on a one-off invoice — the admission fee every resident
 * gets is the common case — so it cannot be the only source or the first
 * invoice of every tenancy falls out of the list's ordering. `dueDate` is the
 * fallback, which puts an admission fee in the year it was actually charged.
 *
 * An invoice with **neither** goes into a trailing `year: null` group rather
 * than being filed under a guess. Screens draw that one under a plain heading;
 * inventing a year for it would put a row in a section a resident could then
 * not find it in.
 *
 * ## The year is the caller's, because the reader has a calendar
 *
 * This used to slice `"2026"` off the period key and call that the heading. On a
 * phone set to Bikram Sambat — the default, and what a resident in Nepal
 * actually reads — that printed a `2026` heading over a card whose every row
 * said `2083 BS`. Two calendars in one list, with nothing saying so.
 *
 * Relabelling the group would not have fixed it either: a Gregorian year spans
 * two BS ones, so `2026` genuinely holds both `2082 BS` and `2083 BS`, and a
 * single BS heading over it would be wrong for the rows on one side of Baisakh
 * 1. The **grouping itself** has to happen in the reader's calendar, which is
 * why `yearOf` is a parameter and `useDates()` supplies it.
 *
 * {@link gregorianInvoiceYear} stays the default, so a caller with no reader —
 * a test, an export — still gets the calendar-free answer.
 *
 * ## Order is the caller's, and is preserved
 *
 * The server sends newest-first and `filterInvoices` keeps that, so this walks
 * the list once and appends. It does not sort — a group order derived from the
 * key would silently disagree with the row order inside it the day the server
 * changes its mind about direction.
 */
export function groupInvoicesByYear(
  invoices: ResidentInvoice[],
  yearOf: (invoice: ResidentInvoice) => string | null = gregorianInvoiceYear,
): InvoiceYear[] {
  const groups: InvoiceYear[] = [];
  const index = new Map<string, InvoiceYear>();

  for (const invoice of invoices) {
    // An empty string is a resolver that could not answer — a date outside the
    // BS converter's table — and is filed with the undated rows rather than
    // under a heading with no name on it.
    const year = yearOf(invoice) || null;
    const key = year ?? "\u0000undated";

    const existing = index.get(key);

    if (existing) {
      existing.invoices.push(invoice);
      continue;
    }

    const group: InvoiceYear = { invoices: [invoice], year };

    index.set(key, group);
    groups.push(group);
  }

  return groups;
}
