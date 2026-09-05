/**
 * What a guardian is allowed to be shown, as a decision the screens can share.
 *
 * Kept apart from `lib/guardian-api.ts` because that file imports the axios
 * client and therefore React Native, which makes it unloadable from a node-side
 * Vitest file — and this rule is precisely the part worth testing.
 *
 * ## The rule
 *
 * The server gates each query by its own permission flag, so a section the
 * resident did not share comes back as an empty array — indistinguishable from
 * a section that is genuinely empty. Drawing "No payments yet" at a guardian
 * who was never granted payments is not a cosmetic slip: it is the app
 * asserting something about the ward's finances that it has no basis for, and
 * the resident's decision not to share is invisible.
 *
 * So a section whose flag is off is **absent**. Never empty, never a lock icon
 * over a blurred list, never a count of zero.
 */

import type {
  GuardianDashboard,
  GuardianPayment,
  GuardianPermissionKey,
  GuardianPermissions,
  GuardianReceipt,
} from "@/lib/guardian-api";

/** Default-deny, matching the server. A missing document shares nothing. */
export const NO_GUARDIAN_PERMISSIONS: GuardianPermissions = {
  canViewComplaintStatus: false,
  canViewFood: false,
  canViewNotices: false,
  canViewPayments: false,
  canViewReceipts: false,
  canViewSafety: false,
};

/**
 * Reads the flags off a dashboard that may not have loaded yet.
 *
 * Deny while loading, rather than defaulting open and retracting sections once
 * the payload lands — a section that flashes into view and disappears has
 * already shown the guardian that it exists.
 */
export function permissionsOf(
  dashboard: GuardianDashboard | null | undefined,
): GuardianPermissions {
  return dashboard?.permissions ?? NO_GUARDIAN_PERMISSIONS;
}

export function canSee(
  dashboard: GuardianDashboard | null | undefined,
  key: GuardianPermissionKey,
): boolean {
  return permissionsOf(dashboard)[key];
}

/** How many of the six the resident has shared. Drives the "access" summary. */
export function sharedSections(
  dashboard: GuardianDashboard | null | undefined,
): GuardianPermissionKey[] {
  const permissions = permissionsOf(dashboard);

  return (Object.keys(permissions) as GuardianPermissionKey[])
    .filter((key) => permissions[key])
    .sort();
}

/**
 * A guardian with no flags at all still has a valid account — they can see
 * their ward's name, room and hostel, and nothing else. That is a real state
 * worth naming, because the alternative is a screen of four empty cards.
 */
export function sharesNothing(dashboard: GuardianDashboard | null | undefined): boolean {
  return sharedSections(dashboard).length === 0;
}

export const GUARDIAN_PERMISSION_LABELS: Record<GuardianPermissionKey, string> = {
  canViewComplaintStatus: "Complaint status",
  canViewFood: "Meals",
  canViewNotices: "Hostel notices",
  canViewPayments: "Fees and dues",
  canViewReceipts: "Receipts",
  canViewSafety: "Night status",
};

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Statuses that still represent an obligation.
 *
 * The same list the server's `getGuardianDashboard` reduces over, so the
 * per-row arithmetic on screen agrees with the `summary.dueAmount` printed
 * above it. `OPEN` is the ledger facade's own word and appears in guardian
 * payloads; the other four come from the invoice status enum.
 */
const OPEN_STATUSES = ["OPEN", "OVERDUE", "PARTIAL", "PENDING_PROOF", "UNPAID"];

export function guardianOutstanding(payment: GuardianPayment): number {
  return OPEN_STATUSES.includes(payment.status)
    ? Math.max(payment.dueAmount - payment.paidAmount, 0)
    : 0;
}

/**
 * The dues total to show.
 *
 * Prefers the server's `summary` — it is the number the hostel would quote —
 * and falls back to summing the rows only when payments are shared but the
 * summary is somehow absent. Returns `null` when payments are not shared at
 * all, so the caller draws nothing rather than a confident NPR 0.
 */
export function guardianDueAmount(
  dashboard: GuardianDashboard | null | undefined,
): number | null {
  if (!canSee(dashboard, "canViewPayments") || !dashboard) {
    return null;
  }

  if (dashboard.summary) {
    return dashboard.summary.dueAmount;
  }

  return dashboard.payments.reduce((sum, payment) => sum + guardianOutstanding(payment), 0);
}

/**
 * Receipts keyed by the billing month they settle.
 *
 * Receipts arrive as their own list rather than nested under the invoice, but
 * both carry `month`, so the two join without a second request. Empty whenever
 * `canViewReceipts` is off — which is why the dues row shows a dash rather than
 * claiming no receipt was ever issued.
 */
export function receiptsByMonth(receipts: GuardianReceipt[]): Map<string, GuardianReceipt> {
  const map = new Map<string, GuardianReceipt>();

  for (const receipt of receipts) {
    // Newest first from the server; the first one wins, which is the latest
    // receipt for a month that was settled in instalments.
    if (!map.has(receipt.month)) {
      map.set(receipt.month, receipt);
    }
  }

  return map;
}

/**
 * What the ward has actually paid across the invoices the guardian can see.
 *
 * The web draws this as a "Paid Amount" metric and mobile never showed it,
 * though the rows it sums were already on screen. It is the reassuring half of
 * the pair — a parent looking at "NPR 8,500 outstanding" with no sense of what
 * has been settled reads a debt rather than a rhythm.
 *
 * **Summed from `paidAmount`, not from status.** A `PARTIAL` month has real
 * money against it, and counting only `PAID` rows would report less than the
 * hostel has received. The qualifier "across shared invoices" is the honest one:
 * the guardian sees the invoices the resident shared and no others, so this is
 * not the ward's lifetime total and must never be labelled as one.
 */
export function guardianPaidAmount(
  dashboard: GuardianDashboard | null | undefined,
): number | null {
  if (!canSee(dashboard, "canViewPayments") || !dashboard) {
    return null;
  }

  return dashboard.payments.reduce(
    (sum, payment) => sum + Math.max(payment.paidAmount, 0),
    0,
  );
}

/**
 * The month the household should settle next — the **oldest** open one.
 *
 * Not the newest, and the distinction is the whole reason this is a function
 * rather than `payments[0]`. The server sends newest-first, so taking the first
 * open row points a parent whose child is two months behind at August while July
 * quietly ages into a default. `paymentStats` in `invoice-ledger.ts` holds the
 * same rule for the resident's own screen, and the two must not disagree about
 * which month is "next" for one debt.
 *
 * A missing `dueDate` sorts **last** rather than first: an invoice with no date
 * is not urgent, and treating absent as epoch-zero would put it above every real
 * one.
 */
export function guardianNextDue(payments: GuardianPayment[]): GuardianPayment | null {
  const open = payments.filter((payment) => guardianOutstanding(payment) > 0);

  return (
    [...open].sort((left, right) => {
      const leftDue = left.dueDate ? Date.parse(left.dueDate) : Number.POSITIVE_INFINITY;
      const rightDue = right.dueDate ? Date.parse(right.dueDate) : Number.POSITIVE_INFINITY;

      return leftDue - rightDue;
    })[0] ?? null
  );
}

/**
 * The most recent month with money against it.
 *
 * **Ordered by billing month, not by a payment date**, because `GuardianPayment`
 * carries none — the resident's own `ResidentInvoice` has `paidDate` and the
 * guardian projection deliberately does not, since when a family paid is a
 * detail about the household rather than about the hostel's ledger. `month` is
 * `YYYY-MM`, which sorts correctly as a string, so no parsing is involved and no
 * timezone can move a January payment into the previous year.
 *
 * `paidAmount > 0` rather than a `PAID` status: a `PARTIAL` month has real money
 * against it, and a parent who paid half of August should see August here.
 */
export function guardianLatestPaid(payments: GuardianPayment[]): GuardianPayment | null {
  return (
    [...payments]
      .filter((payment) => payment.paidAmount > 0)
      .sort((left, right) => right.month.localeCompare(left.month))[0] ?? null
  );
}
