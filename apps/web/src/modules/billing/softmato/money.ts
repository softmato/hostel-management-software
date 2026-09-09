import "server-only";

/**
 * Rupees here, paisa there — and the conversion in exactly one place.
 *
 * This codebase stores subscription money as **whole rupees**: every amount
 * field is `positiveWholeRupees` or `nullableWholeRupees`, validated integer,
 * and `finance-fields.ts` explains why. Softmato's API is **integer paisa**
 * everywhere, in both directions, and has no floats at all.
 *
 * So the two systems disagree by a factor of a hundred and agree about
 * everything else — both refuse fractions. That makes the conversion exact in
 * one direction and only *usually* exact in the other, which is the entire
 * reason this is a file rather than a `* 100` at each call site.
 *
 * **Rupees to paisa is total.** Any whole rupee amount is a whole paisa amount.
 *
 * **Paisa to rupees is not.** Softmato can report `123456` paisa — NPR 1,234.56
 * — because a provider fee or a partial refund is not obliged to land on a
 * rupee boundary. Nothing in our schema can hold that. So `paisaToRupees`
 * refuses rather than rounding: a silent `Math.round` here is how a ledger
 * ends up a rupee out with no record of which side moved, and the accountant
 * finds it before we do.
 */

/** Softmato's own guidance, worth keeping where the conversion happens. */
export const PAISA_PER_RUPEE = 100;

export function rupeesToPaisa(rupees: number): number {
  if (!Number.isInteger(rupees)) {
    throw new Error(
      `Subscription amounts are whole rupees; received ${rupees}. Nothing upstream should be able to produce a fraction here.`,
    );
  }

  return rupees * PAISA_PER_RUPEE;
}

/**
 * Paisa back to whole rupees, or an error naming the amount.
 *
 * Callers that must survive a sub-rupee figure — displaying what a provider
 * actually charged, say — should format the paisa directly rather than asking
 * for a number this cannot give them.
 */
export function paisaToRupees(paisa: number): number {
  if (!Number.isInteger(paisa)) {
    throw new Error(`Softmato reported a fractional paisa amount: ${paisa}.`);
  }

  if (paisa % PAISA_PER_RUPEE !== 0) {
    throw new Error(
      `Softmato reported ${paisa} paisa, which is not a whole number of rupees. This subscription's schema cannot hold it.`,
    );
  }

  return paisa / PAISA_PER_RUPEE;
}

/** `123456` → `"1,234.56"`. For display only — never fed back into a total. */
export function formatPaisa(paisa: number): string {
  const rupees = Math.trunc(paisa / PAISA_PER_RUPEE);
  const remainder = Math.abs(paisa % PAISA_PER_RUPEE);

  return `${rupees.toLocaleString("en-IN")}.${String(remainder).padStart(2, "0")}`;
}
