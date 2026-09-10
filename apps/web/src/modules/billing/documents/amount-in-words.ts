/**
 * `150` → `One Hundred Fifty Rupees Only`.
 *
 * The line every Nepali invoice and receipt carries under the figure, and the
 * reason it carries it: a figure can be altered with a pen and a words line
 * cannot, so the two together are what makes the amount on a paper document
 * hard to dispute. It is not decoration and it is not a translation — it is the
 * second, redundant statement of the same number, and the whole value of it is
 * that the redundancy is checkable.
 *
 * ## The South Asian numbering system, not the international one
 *
 * Nepal groups by **lakh** (100,000) and **crore** (10,000,000), not by million
 * and billion. `1,50,000` is *One Lakh Fifty Thousand*, and an owner reading
 * "One Hundred Fifty Thousand" on a document issued in Kathmandu would be
 * reading a foreign convention on their own paperwork. The grouping is why this
 * cannot be an off-the-shelf number-to-words package: nearly all of them are
 * built on thousands.
 *
 * ## Whole rupees only, deliberately
 *
 * Every subscription amount in this codebase is a whole rupee — the schema
 * enforces it, and `softmato/money.ts` explains at length why a fractional one
 * is refused rather than rounded. So there is no paisa clause here, and a
 * fractional input throws rather than being silently floored. A words line that
 * disagreed with the figure above it by fifty paisa would defeat the only
 * purpose it has.
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
] as const;

/** 0–99. Empty for zero, so callers can concatenate groups without a filter. */
function underHundred(value: number): string {
  if (value < 20) {
    return ONES[value];
  }

  const tens = TENS[Math.floor(value / 10)];
  const ones = ONES[value % 10];

  return ones ? `${tens} ${ones}` : tens;
}

/** 0–999. */
function underThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = underHundred(value % 100);

  if (!hundreds) {
    return rest;
  }

  const lead = `${ONES[hundreds]} Hundred`;

  return rest ? `${lead} ${rest}` : lead;
}

/**
 * The groups, largest first, in the sizes this system actually uses.
 *
 * Lakh is two digits wide because the next word up takes over at a hundred of
 * them. Crore is three, which carries this to `Nine Hundred Ninety Nine Crore`
 * — the point where the convention wants `Arab` and this stops rather than
 * guesses. `MAX` below is that ceiling, stated as a refusal instead of a wrong
 * answer, because the one thing a words line may never be is plausible and
 * incorrect.
 */
const GROUPS: { divisor: number; name: string; width: "two" | "three" }[] = [
  { divisor: 10_000_000, name: "Crore", width: "three" },
  { divisor: 100_000, name: "Lakh", width: "two" },
  { divisor: 1_000, name: "Thousand", width: "three" },
];

/** One rupee short of `Arab`, the first word this does not know. */
const MAX = 10_000_000_000 - 1;

export function amountInWords(rupees: number): string {
  if (!Number.isInteger(rupees) || rupees < 0) {
    throw new Error(
      `An amount in words is only defined for a whole, non-negative number of rupees; received ${rupees}.`,
    );
  }

  if (rupees > MAX) {
    throw new Error(
      `${rupees} is past Arab, which this does not spell. No document in this product reaches it, and a wrong words line is worse than a missing one.`,
    );
  }

  if (rupees === 0) {
    return "Zero Rupees Only";
  }

  const parts: string[] = [];
  let rest = rupees;

  for (const group of GROUPS) {
    const count = Math.floor(rest / group.divisor);

    if (count > 0) {
      const spoken =
        group.width === "two" ? underHundred(count) : underThousand(count);

      parts.push(`${spoken} ${group.name}`);
      rest -= count * group.divisor;
    }
  }

  if (rest > 0) {
    parts.push(underThousand(rest));
  }

  return `${parts.join(" ")} Rupees Only`;
}
