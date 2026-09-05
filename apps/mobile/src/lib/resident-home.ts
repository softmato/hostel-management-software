import { nightStanding } from "@/lib/night-status";
import type { NightStatus } from "@/lib/resident-api";

/**
 * The strings the resident Home's hero card puts under its headline.
 *
 * Pure, and here rather than in the component, for the reason every other
 * `*-home.ts` in this folder exists: the wording is where the mistakes are, and
 * a rule about which sentence wins is worth a test rather than a code review.
 *
 * The mirror of `lib/admin-home.ts`'s `occupancyLine` / `listingState` pair —
 * the resident card answers the same two questions the hostel card does ("what
 * does this number mean" and "is anything wrong with this account"), so the two
 * files hold the same shape of helper.
 */

/**
 * The quiet line under the outstanding figure — one sentence, by priority.
 *
 * ## Claims in review outrank the amount, and that ordering is the point
 *
 * A resident who has paid at the counter, photographed the receipt and uploaded
 * it still sees the invoice as unpaid until the office approves the claim: the
 * dashboard's `dueAmount` does not move. Leading that state with "4 days
 * overdue" tells somebody who has already paid to pay again, which is the one
 * failure this line can cause that costs real money. So a claim in review is
 * said first.
 *
 * Below that it is the ordinary reading order: how many invoices, then which
 * month, then when it is due.
 *
 * One line, never two. The hero has exactly one slot for it — see
 * `<ResidentStayHero>` — and every part is written to fit a phone at 12pt.
 */
export function duesLine(input: {
  dueAmount: number;
  /**
   * `formatDueLabel(feeStatus.nextDue?.dueDate)` — "Due in 6 days", "4 days
   * overdue".
   *
   * **The earliest unsettled invoice's date, never `latestPayment`'s.** Those
   * are different invoices by construction — see `nextDue` on `feeStatus` — and
   * pairing the wrong one with a multi-invoice total is what made this line say
   * "Across 2 unpaid invoices · Due in 27 days" to somebody whose older invoice
   * was a month overdue.
   */
  dueLabel: string | null;
  pendingProofs: number;
  /** That same invoice's month, already through `dates.period`. */
  periodLabel: string | null;
  unpaidCount: number;
}): string {
  if (input.pendingProofs > 0) {
    return input.pendingProofs === 1
      ? "1 payment claim in review"
      : `${input.pendingProofs} payment claims in review`;
  }

  if (input.dueAmount <= 0) {
    return "Nothing outstanding";
  }

  /*
   * The count first when there is more than one. "NPR 17,000" against a single
   * month reads as a rent that has gone up; against two it reads as two months
   * missed, which is a different conversation with the office.
   *
   * ## `Oldest of`, and why the word is not decoration
   *
   * The two halves of this line describe **different invoices**: the count is
   * every unpaid one, the date is the earliest of them. Written as "Across 2
   * unpaid invoices · 12 days overdue" a reader fairly assumes the date covers
   * both — so the line names whose date it is. It also drops "invoices" in that
   * branch, because `Oldest of 2 unpaid invoices · 12 days overdue` is four
   * characters past what fits on a 360dp phone at 12pt and ellipses at exactly
   * the part that carries the urgency.
   */
  if (input.unpaidCount > 1) {
    return input.dueLabel
      ? `Oldest of ${input.unpaidCount} unpaid · ${input.dueLabel}`
      : `Across ${input.unpaidCount} unpaid invoices`;
  }

  return (
    [input.periodLabel, input.dueLabel].filter(Boolean).join(" · ") ||
    "Payment outstanding"
  );
}

export type StayPill = {
  /** True draws the quiet translucent pill; false draws the solid white flag. */
  settled: boolean;
  label: string;
};

/**
 * Tonight's answer, in the corner the account card keeps for its state.
 *
 * The counterpart of the admin hero's `ListingPill`, and the same rule decides
 * its two appearances: **live is quiet, anything else is a flag**, because those
 * are the two states that need different reactions from the person holding the
 * phone.
 *
 * ## It reads `nightStanding`, and does not test the status itself
 *
 * The strip this replaces compared `nightStatus.status === "VERIFIED"` — a value
 * `NIGHT_STATUSES` does not contain, so the tile could never go green no matter
 * what a resident answered. Being checked in is not a single status either: it
 * is `INSIDE_HOSTEL` or `MARKED_SAFE` **and** the answer being tonight's rather
 * than last week's, which is exactly what `nightStanding` already works out for
 * the screen that owns this data.
 *
 * An SOS on the record is called out by name. It is written by `triggerSOS` and
 * only staff can clear it, so a resident who has since marked themselves safe
 * must not see a card implying the alert is gone.
 */
export function stayPill(status: NightStatus, now: Date = new Date()): StayPill {
  if (status.status === "SOS_TRIGGERED") {
    return { label: "SOS active", settled: false };
  }

  return nightStanding(status, now).answered
    ? { label: "Checked in", settled: true }
    : { label: "Not checked in", settled: false };
}
