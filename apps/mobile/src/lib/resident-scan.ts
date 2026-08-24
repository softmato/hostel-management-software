import type { ResidentLedger } from "@/lib/admin-manage-api";

/**
 * Turning a resident's ledger into the two sentences somebody at the door needs.
 *
 * ## "Paid till" is not "the last month they paid"
 *
 * The obvious reading — take the newest month with money against it — is wrong
 * in the case that matters. Somebody who skipped March and paid April has a
 * newest-paid month of April, and a screen saying "paid till April" is telling a
 * hostel owner to stop chasing a debt that is still outstanding. What "paid
 * till" means is *the point up to which nothing is owed*, so this walks forward
 * from move-in and stops at the first month that is short. April then shows up
 * where it belongs, in `unpaid`.
 *
 * ## A month nobody billed is not a debt
 *
 * `dueAmount: 0` is the ledger's word for a period this resident was never
 * charged for — before their move-in, a waived month, a gap in the billing run.
 * It settles rather than blocking, because a run that stalled on a month with
 * nothing owed would report "paid till January" for a resident who is straight
 * with the hostel.
 *
 * ## Periods sort as strings, on purpose
 *
 * They are `YYYY-MM`, which is lexicographically ordered by construction — so
 * this needs no date parsing, and cannot drift a month across a timezone the way
 * `new Date("2026-08")` does.
 */

export type PaymentStanding = {
  /** How many months carry a charge at all. */
  monthsBilled: number;
  monthsPaid: number;
  /** Every period still short, oldest first. */
  unpaid: ResidentLedger["months"];
  /** What has actually been collected, lifetime. */
  paid: number;
  /** The last period with nothing owed against it, walking from move-in. */
  paidThrough: string | null;
  /** What is still owed, lifetime. */
  outstanding: number;
  /** Newest first, for the card that shows the last few months. */
  recent: ResidentLedger["months"];
};

/** Nothing is owed for this period — either it is covered, or it was never billed. */
function settled(month: ResidentLedger["months"][number]) {
  return month.dueAmount <= 0 || month.paidAmount >= month.dueAmount;
}

export function paymentStanding(
  ledger: ResidentLedger | null | undefined,
  recentCount = 6,
): PaymentStanding | null {
  if (!ledger) {
    return null;
  }

  const months = [...ledger.months].sort((left, right) =>
    left.period.localeCompare(right.period),
  );

  let paidThrough: string | null = null;

  for (const month of months) {
    if (!settled(month)) {
      break;
    }

    /*
     * Only a *billed* month advances the marker. Otherwise a resident whose
     * hostel has not run billing yet would read "paid till this month" on the
     * strength of a row that says nothing was ever charged.
     */
    if (month.dueAmount > 0) {
      paidThrough = month.period;
    }
  }

  return {
    monthsBilled: ledger.totals.monthsBilled,
    monthsPaid: ledger.totals.monthsPaid,
    outstanding: ledger.totals.outstanding,
    paid: ledger.totals.paid,
    paidThrough,
    recent: [...months].reverse().slice(0, recentCount),
    unpaid: months.filter((month) => !settled(month)),
  };
}
