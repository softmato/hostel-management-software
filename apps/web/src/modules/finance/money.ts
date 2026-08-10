import { FinanceServiceError } from "@/modules/finance/finance.errors";

/**
 * Money, in whole Nepali rupees (ADR-1, plan §3.1).
 *
 * `1500` means NPR 1,500. There are no paisa anywhere in this system: the
 * product prices, displays, and issues receipts in whole rupees, so storing
 * minor units would exist only in the database and cost a conversion at every
 * boundary.
 *
 * The integrity that minor units would have bought comes instead from
 * **enforcing integrality**. Whole rupees below 2^53 are exactly representable,
 * so summing an event log of them is exact and `LEDGER_DRIFT` can never fire on
 * rounding noise. That guarantee holds only while nothing writes a fraction —
 * which is why {@link assertWholeRupees} throws instead of rounding, and why
 * rounding happens at the point of computation (here) rather than at display.
 *
 * Pure module: no I/O, no database, no dates beyond what callers pass in.
 */

export const CURRENCY = "NPR";

/** The largest amount that is still exactly representable. */
const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;

/**
 * Throws unless `amount` is a whole, finite rupee value.
 *
 * Deliberately **not** forgiving: a caller holding `1499.9999999` has already
 * lost the property this module exists to protect, and silently rounding here
 * would hide the arithmetic that produced it. `label` names the field so the
 * error points at the caller rather than at this function.
 */
export function assertWholeRupees(amount: number, label = "amount"): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new FinanceServiceError(
      `${label} must be a finite number of rupees.`,
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  if (!Number.isInteger(amount)) {
    throw new FinanceServiceError(
      `${label} must be a whole number of rupees, received ${amount}.`,
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  if (Math.abs(amount) > MAX_SAFE_AMOUNT) {
    throw new FinanceServiceError(
      `${label} is too large to represent exactly.`,
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  return amount;
}

export function isWholeRupees(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isInteger(amount) &&
    Math.abs(amount) <= MAX_SAFE_AMOUNT
  );
}

/**
 * Rounds to the nearest rupee, half away from zero.
 *
 * `Math.round` breaks ties towards +∞, so it rounds -0.5 to -0! and biases a
 * long run of .5 cases upward. Away-from-zero keeps a reversal the exact mirror
 * of the credit it reverses, which matters because the two are summed together.
 *
 * This is the **only** sanctioned way to turn a fractional computation into a
 * storable amount. Call it before storage, never after (target §3.5).
 */
export function roundToRupee(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new FinanceServiceError(
      "Cannot round a non-finite amount.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  return Math.sign(amount) * Math.round(Math.abs(amount));
}

/**
 * Exact sum of an event log. Every input must already be whole rupees — a
 * fraction reaching here means something bypassed {@link roundToRupee}, and the
 * ledger's exactness claim is void from that point on, so it throws.
 */
export function sumAmounts(amounts: number[], label = "amount"): number {
  let total = 0;

  for (const amount of amounts) {
    total += assertWholeRupees(amount, label);
  }

  return assertWholeRupees(total, "total");
}

/**
 * Prorates a monthly charge across the days actually occupied (target §3.5).
 *
 * Rounds **once**, at the end, to the nearest rupee. A full month — or more,
 * which a caller can produce from an inclusive day count — is the untouched
 * monthly amount rather than a computed approximation of it, so twelve full
 * months bill exactly twelve times the rent with no drift.
 */
export function prorate(
  monthlyAmount: number,
  billableDays: number,
  daysInMonth: number,
): number {
  assertWholeRupees(monthlyAmount, "monthly amount");

  if (!Number.isInteger(billableDays) || !Number.isInteger(daysInMonth)) {
    throw new FinanceServiceError(
      "Day counts must be whole numbers.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  if (daysInMonth <= 0) {
    throw new FinanceServiceError(
      "A month must have at least one day.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  if (billableDays <= 0) {
    return 0;
  }

  if (billableDays >= daysInMonth) {
    return monthlyAmount;
  }

  return roundToRupee((monthlyAmount / daysInMonth) * billableDays);
}

/**
 * Splits `amount` into `parts` whole-rupee shares that sum back to exactly
 * `amount`. The remainder goes to the earliest shares rather than vanishing —
 * three ways of 1,000 is [334, 333, 333], never 999 (target §9.4: never destroy
 * money).
 */
export function splitAmount(amount: number, parts: number): number[] {
  assertWholeRupees(amount);

  if (!Number.isInteger(parts) || parts <= 0) {
    throw new FinanceServiceError(
      "Cannot split into a non-positive number of parts.",
      "AMOUNT_OUT_OF_BOUNDS",
    );
  }

  const base = Math.trunc(amount / parts);
  const remainder = amount - base * parts;
  const step = Math.sign(remainder);

  return Array.from({ length: parts }, (_, index) =>
    index < Math.abs(remainder) ? base + step : base,
  );
}

/**
 * "NPR 12,000" — the canonical rendering. Grouping is en-US because Nepali
 * lakh/crore grouping is not what this product's screens or receipts use today;
 * changing it is a product decision, not a formatting detail.
 */
export function formatNPR(amount: number): string {
  assertWholeRupees(amount);

  return `${CURRENCY} ${amount.toLocaleString("en-US")}`;
}
