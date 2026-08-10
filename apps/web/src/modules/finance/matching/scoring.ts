/**
 * Tier C confidence, and the sentence that explains it (target §7).
 *
 * Tier C exists because most real payments carry no reference code: the resident
 * paid from their own wallet, typed nothing in the remark, and the only things
 * linking that credit to an invoice are the amount, the time, and a name the
 * provider spelled its own way. This module turns those weak signals into a
 * ranked suggestion **and a reason in words**.
 *
 * The reason is not decoration. A confidence percentage tells an owner nothing
 * they can check; "matches Suman Tamang — name similar, owes exactly this
 * amount" tells them precisely which claim to disbelieve. Every score therefore
 * carries the signals that produced it, and a candidate that cannot be explained
 * is not offered.
 *
 * **Nothing here settles anything.** Tier C never auto-settles (target §7); the
 * output is a suggestion an owner confirms. That is what lets the weights below
 * be generous — the cost of a bad suggestion is a declined one-tap button, not
 * misapplied money.
 *
 * Pure module: no I/O, no database, no clock beyond the dates passed in.
 */

export type MatchCandidate = {
  /** Bed or room label, shown so the owner recognises the person. */
  bedLabel?: string | null;
  /** Used only for the weakest signal — see `TIME_NEAR_DUE`. */
  dueDate?: Date | null;
  invoiceId: string;
  /** What this invoice still owes, in whole rupees. */
  outstanding: number;
  period: string;
  /** The invoice's own code, used to detect a code aimed at a different invoice. */
  referenceCode: string | null;
  residentId: string;
  residentName: string;
};

export type ScoringInput = {
  /** The credit being matched. */
  amount: number;
  /** Name as the provider spelled it, e.g. "S. TAMANG". */
  counterpartyName: string | null;
  occurredAt: Date;
  /**
   * The invoice a valid reference code named, when the credit did not qualify
   * for Tier B — usually because the amount exceeded what that invoice owed.
   *
   * Carried as an identity rather than a string because it is evidence about a
   * *person*: an unrelated candidate is not made likelier by the existence of
   * somebody else's code, and an earlier version that scored it that way
   * boosted every candidate equally.
   */
  referencedInvoice?: { invoiceId: string; residentId: string } | null;
};

export type MatchSignal =
  | "AMOUNT_EXACT"
  | "AMOUNT_CLOSE"
  | "NAME_EXACT"
  | "NAME_SIMILAR"
  | "REFERENCE_SAME_INVOICE"
  | "REFERENCE_SAME_RESIDENT"
  | "TIME_NEAR_DUE";

export type ScoredCandidate = {
  candidate: MatchCandidate;
  confidence: "HIGH" | "LOW" | "MEDIUM";
  score: number;
  signals: MatchSignal[];
  /** "matches Suman Tamang — name similar, owes exactly this amount". */
  why: string;
};

/**
 * Weights, in the order target §7 gives them.
 *
 * The two reference signals outrank everything below because a valid code is a
 * deliberate act by somebody who knows their own code, and the check character
 * means it was not arrived at by a typo. `SAME_INVOICE` is the strongest signal
 * this module has: it means the code named *this* invoice and only the amount
 * stopped it settling at Tier B — a resident clearing two months at once, or
 * rounding up (target §16.2, §9.4).
 *
 * Amount outranks name because two residents in a hostel share a surname far
 * more often than they owe the same odd figure, and time proximity is worth
 * least because everybody pays in the same week.
 */
const WEIGHTS: Record<MatchSignal, number> = {
  AMOUNT_CLOSE: 12,
  AMOUNT_EXACT: 34,
  NAME_EXACT: 30,
  NAME_SIMILAR: 20,
  // Alone, this clears HIGH: a check-character-valid code naming this exact
  // invoice is as certain as Tier C gets, and the owner should see it as such
  // even when nothing else about the row agrees.
  REFERENCE_SAME_INVOICE: 60,
  REFERENCE_SAME_RESIDENT: 40,
  TIME_NEAR_DUE: 8,
};

/**
 * Signals that say *who*, as opposed to signals that merely corroborate.
 *
 * At least one is required before anything is suggested, and no total of the
 * others substitutes for it. This is the rule, not the numeric floor: an amount
 * and a timestamp identify nobody — in a hostel where thirty residents owe the
 * same 8,000 on the same day, "exact amount, paid near the due date" describes
 * all thirty equally. Offering the owner one of them as a suggestion would be
 * inventing a match out of a coincidence, and the owner has no way to tell that
 * apart from a real one.
 */
const IDENTITY_SIGNALS: MatchSignal[] = [
  "NAME_EXACT",
  "NAME_SIMILAR",
  "REFERENCE_SAME_INVOICE",
  "REFERENCE_SAME_RESIDENT",
];

/**
 * Below this, a candidate is not shown at all.
 *
 * A suggestion the owner rejects costs a tap; a list of eleven equally
 * implausible residents costs the owner's trust in the whole screen, after which
 * they approve everything without reading. Set so that a resemblance on its own
 * — a name that is merely similar, with nothing else agreeing — stays below it.
 */
export const SUGGESTION_FLOOR = 30;

const HIGH_CONFIDENCE = 60;
const MEDIUM_CONFIDENCE = 42;

/** Payments within this of the due date are marginally more likely to be rent. */
const NEAR_DUE_DAYS = 10;
/** "Close enough to mention": within 2% or NPR 100, whichever is larger. */
function amountIsClose(paid: number, outstanding: number): boolean {
  const tolerance = Math.max(100, Math.round(outstanding * 0.02));

  return Math.abs(paid - outstanding) <= tolerance;
}

export function scoreCandidate(
  input: ScoringInput,
  candidate: MatchCandidate,
): ScoredCandidate | null {
  const signals: MatchSignal[] = [];

  if (input.referencedInvoice) {
    if (input.referencedInvoice.invoiceId === candidate.invoiceId) {
      signals.push("REFERENCE_SAME_INVOICE");
    } else if (input.referencedInvoice.residentId === candidate.residentId) {
      signals.push("REFERENCE_SAME_RESIDENT");
    }
  }

  if (input.amount === candidate.outstanding) {
    signals.push("AMOUNT_EXACT");
  } else if (amountIsClose(input.amount, candidate.outstanding)) {
    signals.push("AMOUNT_CLOSE");
  }

  const nameScore = nameSimilarity(input.counterpartyName, candidate.residentName);

  if (nameScore >= 0.95) {
    signals.push("NAME_EXACT");
  } else if (nameScore >= 0.6) {
    signals.push("NAME_SIMILAR");
  }

  if (nearDueDate(input.occurredAt, candidate.dueDate)) {
    signals.push("TIME_NEAR_DUE");
  }

  if (!signals.some((signal) => IDENTITY_SIGNALS.includes(signal))) {
    return null;
  }

  const score = signals.reduce((total, signal) => total + WEIGHTS[signal], 0);

  if (score < SUGGESTION_FLOOR) {
    return null;
  }

  return {
    candidate,
    confidence:
      score >= HIGH_CONFIDENCE
        ? "HIGH"
        : score >= MEDIUM_CONFIDENCE
          ? "MEDIUM"
          : "LOW",
    score,
    signals,
    why: explain(candidate, signals),
  };
}

/**
 * Ranks every candidate and returns the ones worth showing, best first.
 *
 * Capped at three. An owner reconciling forty rows will read the first
 * suggestion and glance at the second; a longer list is a way of declining to
 * decide while appearing thorough.
 */
export function rankCandidates(
  input: ScoringInput,
  candidates: MatchCandidate[],
  limit = 3,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(input, candidate))
    .filter((scored): scored is ScoredCandidate => scored !== null)
    // Ties break on the invoice id, which is unique — two residents with the
    // same name scoring identically must still order the same way on every
    // render, or the one-tap button moves under the owner's finger.
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.residentName.localeCompare(right.candidate.residentName) ||
        left.candidate.invoiceId.localeCompare(right.candidate.invoiceId),
    )
    .slice(0, limit);
}

/** Whether a credit landed close enough to the due date to count as a signal. */
export function nearDueDate(occurredAt: Date, dueDate: Date | null | undefined): boolean {
  if (!dueDate) {
    return false;
  }

  const days = Math.abs(occurredAt.getTime() - dueDate.getTime()) / 86_400_000;

  return days <= NEAR_DUE_DAYS;
}

/**
 * The sentence shown beside the suggestion.
 *
 * Written as the owner would say it, strongest signal first, and it never claims
 * more than the signals support — "name similar" is not "name matches", because
 * an owner who trusts a phrase once and is burned stops reading the phrase.
 */
export function explain(candidate: MatchCandidate, signals: MatchSignal[]): string {
  const phrases: string[] = [];

  if (signals.includes("REFERENCE_SAME_INVOICE")) {
    phrases.push("carries this invoice's reference code");
  } else if (signals.includes("REFERENCE_SAME_RESIDENT")) {
    phrases.push("used a reference code for another of their invoices");
  }

  if (signals.includes("NAME_EXACT")) {
    phrases.push("name matches");
  } else if (signals.includes("NAME_SIMILAR")) {
    phrases.push("name similar");
  }

  if (signals.includes("AMOUNT_EXACT")) {
    phrases.push("owes exactly this amount");
  } else if (signals.includes("AMOUNT_CLOSE")) {
    phrases.push(`owes ${candidate.outstanding.toLocaleString("en-IN")}`);
  }

  if (signals.includes("TIME_NEAR_DUE")) {
    phrases.push("paid around the due date");
  }

  const reason = phrases.length > 0 ? ` — ${phrases.join(", ")}` : "";

  return `matches ${candidate.residentName}${reason}`;
}

/* -------------------------------------------------------------------------- */
/*                              Name similarity                               */
/* -------------------------------------------------------------------------- */

/**
 * How alike two names are, 0…1.
 *
 * Built for the shape these names actually take rather than for string distance
 * in general. Providers truncate and initialise ("S. TAMANG" for Suman Tamang),
 * reorder given and family names, and transliterate inconsistently (Shrestha /
 * Shrestha / Sresth). So:
 *
 * - **Token set, not sequence.** "Tamang Suman" and "Suman Tamang" are the same
 *   person; comparing the strings end to end says they are barely related.
 * - **An initial matches its token**, at reduced weight — `S.` against `Suman`
 *   is real evidence but far weaker than the full word, and treating it as a
 *   match would make every S-named resident equally plausible.
 * - **Scored against the shorter name.** The provider's version is usually the
 *   abbreviated one, and dividing by the longer would penalise a resident for
 *   having a middle name the wallet dropped.
 *
 * A returned 1 means the names are equal after normalisation, never "close
 * enough" — the caller's `NAME_EXACT` threshold depends on that.
 */
export function nameSimilarity(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const a = tokenize(left);
  const b = tokenize(right);

  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const remaining = [...longer];
  let total = 0;

  for (const token of shorter) {
    let bestScore = 0;
    let bestIndex = -1;

    remaining.forEach((other, index) => {
      const score = tokenScore(token, other);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      remaining.splice(bestIndex, 1);
      total += bestScore;
    }
  }

  return total / shorter.length;
}

function tokenize(name: string | null | undefined): string[] {
  return (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenScore(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  // An initial against a word starting with it. Deliberately capped well below
  // a real word match — see the class comment.
  if (
    (left.length === 1 && right.startsWith(left)) ||
    (right.length === 1 && left.startsWith(right))
  ) {
    return 0.55;
  }

  const ratio = similarityRatio(left, right);

  // Below 0.8 the two are different words that happen to share letters, and
  // counting them at all is what produces the eleven-implausible-suggestions
  // list the floor exists to prevent.
  return ratio >= 0.8 ? ratio : 0;
}

/** 1 − (edit distance / longer length). */
function similarityRatio(left: string, right: string): number {
  const distance = levenshtein(left, right);
  const longest = Math.max(left.length, right.length);

  return longest === 0 ? 1 : 1 - distance / longest;
}

function levenshtein(left: string, right: string): number {
  // Single-row DP: names are short, and this runs once per candidate per row.
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }

    previous = current;
  }

  return previous[right.length]!;
}
