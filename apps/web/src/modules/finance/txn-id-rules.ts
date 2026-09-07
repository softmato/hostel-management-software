/**
 * Does this transaction id have the shape its provider actually issues?
 * (Evidence pipeline, phase 4.)
 *
 * A new signal, and the cheapest one in the pipeline: it reads a string that has
 * already been extracted, so it costs nothing, works when OCR fails, and catches
 * the laziest fraud there is — a made-up id. `transaction-code.ts` already
 * refuses ids that could not be real for *anyone* (too short, a placeholder
 * word, a run of one character). This asks the narrower question: could **this
 * provider** have issued this?
 *
 * ## Every rule here is measured, and the measurements are recorded
 *
 * **Nothing in this file is assumed.** The obvious way to write it is to guess
 * that eSewa uses ten digits and Khalti uses a UUID, and the guess would be
 * wrong in both cases — real eSewa ids are seven characters and mix letters with
 * digits (`1QAXP2M`, `1NVX5KB`), and Khalti's are twenty-two mixed-case
 * characters that the app hyphenates and the PDF does not. A guessed rule does
 * not produce a weak signal; it produces confident amber flags on honest
 * residents, which is worse than having no rule at all.
 *
 * So a provider gets a rule only when there is a body of real ids to derive it
 * from, and the derivation is written down beside it. Everything else is
 * `UNKNOWN_PROVIDER`, which emits no flag in either direction.
 *
 * ## Amber, and it stays amber
 *
 * Never a refusal, for a reason that has nothing to do with how confident the
 * rule is: a provider can change its id format overnight without telling anyone,
 * and a hard rule would then reject every honest resident at once — and you
 * would learn about it from angry wardens rather than from a dashboard. The
 * flags below move a claim in front of a human and do nothing else.
 *
 * Watch `EVIDENCE_TXN_ID_MALFORMED` against real settlements for a month before
 * even considering hardening it, and then rule by rule rather than as a policy.
 *
 * ## Re-derive this quarterly
 *
 * Run the derivation again from `PaymentEvent`s that actually settled — those
 * are ground truth, because the bank confirmed them. A rule whose fit rate has
 * dropped below the bar should be deleted, not patched.
 */

/** Flags this module can raise. Both amber; neither is ever a refusal. */
export const TXN_ID_FLAGS = {
  /** The id does not fit the shape this provider issues. A human should look. */
  MALFORMED: "EVIDENCE_TXN_ID_MALFORMED",
  /**
   * It does. A positive signal for the warden's queue — weak on its own, and
   * worth having because most of the queue's other signals only ever say that
   * something is wrong.
   */
  SHAPE_OK: "EVIDENCE_TXN_ID_SHAPE_OK",
} as const;

export type TxnIdVerdict =
  /** The provider has a rule and this id breaks it. */
  | "INVALID_SHAPE"
  /** No rule is registered for this provider. Never penalised. */
  | "UNKNOWN_PROVIDER"
  /** The provider has a rule and this id fits it. */
  | "VALID_SHAPE";

type TxnIdRule = {
  /** How the rule was arrived at, and from how many real ids. */
  evidence: string;
  /** Tested against the canonical form: uppercased, separators removed. */
  pattern: RegExp;
};

/**
 * The same canonicalisation `transaction-code.ts` uses.
 *
 * Load-bearing rather than tidy-minded: Khalti's own PDF prints
 * `jhmy94Nqpybs2QDh8tACWc` for the id its app displays as
 * `jhmy94Nq-pybs2Q-Dh8tACWc`. Two renderings of one id, and a rule that did not
 * strip separators would call one of them malformed.
 */
function canonical(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s\-_/.]/g, "");
}

/**
 * The registry.
 *
 * Keyed by the payment method vocabulary the claim form uses, so the caller
 * passes what the resident selected rather than translating.
 */
const RULES: Record<string, TxnIdRule> = {
  ESEWA: {
    evidence:
      "16 real ids from wallet transfers, QR merchant payments, topups, bank loads and both PDF exports: 1QAXP2M, 1Q5Z3E2, 1QAX4PU, 1PYWSS2, 1Q1RYMU, 1PVB1KH, 1PSRKEV, 1PUW3MQ, 1NVX5KB, 1PS5YFP, 1NW2DT8, 1OEJ1E5, 1NWIJV9, 1P57I03, 1PIW8BZ, 1PD5FB9. Every one is exactly seven uppercase alphanumerics. 16/16.",
    /*
     * Seven characters, and deliberately **not** anchored on the leading `1`.
     *
     * All sixteen begin with `1`, and the second character walks N -> O -> P ->
     * Q in date order across the sample — which says the id is a counter in some
     * base, and a counter rolls. Pinning the first character would work for as
     * long as it takes eSewa to reach the next digit, and then flag every
     * genuine receipt on the platform on the same day.
     *
     * The length and the alphabet are the stable part, and they are enough to
     * reject what this is actually for: a ten-digit phone number typed into the
     * transaction field, a bank reference pasted against an eSewa payment, an
     * eight-character invention.
     */
    pattern: /^[0-9A-Z]{7}$/,
  },
};

/*
 * Providers deliberately absent, and why. Deleting these notes would invite
 * somebody to "finish the job" by guessing.
 *
 * KHALTI — two real ids (`jhmy94Nqpybs2QDh8tACWc`,
 *   `at2rLvst89QUDeeu9B4mbs`), both twenty-two mixed-case alphanumerics. The
 *   shape is probably `^[0-9A-Za-z]{22}$`, and two samples is not a basis for
 *   flagging anybody's rent. Register it once there are ~20 settled ids.
 *
 * FONEPAY / BANK_TRANSFER — eight real ids, in two shapes: nine digits
 *   (114903707, 112437302, 112636009, 114183396, 112099711, 111903076,
 *   111396349) and one carrying a SWIFT prefix (EVBLNPKAXP-112491077). Seven of
 *   eight fit the bare nine-digit form, which is 88% and under the 95% bar — and
 *   the miss is not noise, it is a second legitimate format. Bank references
 *   vary by bank in a way a single pattern cannot cover, so this stays
 *   unregistered until the ids are grouped by issuing bank.
 *
 * CASH — has no transaction id at all.
 */

/**
 * The shape verdict for an id the resident submitted.
 *
 * An empty id is `UNKNOWN_PROVIDER` rather than invalid: whether an id is
 * *required* is `transactionCodeRequired`'s question, and answering it twice in
 * two places is how two screens end up disagreeing.
 */
export function txnIdVerdict(
  paymentMethod: string | null | undefined,
  transactionCode: string | null | undefined,
): TxnIdVerdict {
  const rule = RULES[(paymentMethod ?? "").toUpperCase()];
  const value = canonical(transactionCode ?? "");

  if (!rule || !value) return "UNKNOWN_PROVIDER";

  return rule.pattern.test(value) ? "VALID_SHAPE" : "INVALID_SHAPE";
}

/** The flag this verdict earns, if any. `UNKNOWN_PROVIDER` earns neither. */
export function txnIdFlags(
  paymentMethod: string | null | undefined,
  transactionCode: string | null | undefined,
): string[] {
  switch (txnIdVerdict(paymentMethod, transactionCode)) {
    case "INVALID_SHAPE":
      return [TXN_ID_FLAGS.MALFORMED];
    case "VALID_SHAPE":
      return [TXN_ID_FLAGS.SHAPE_OK];
    default:
      return [];
  }
}

/** The providers carrying a rule, so a script can report coverage. */
export function providersWithTxnIdRules(): Array<{
  evidence: string;
  provider: string;
}> {
  return Object.entries(RULES).map(([provider, rule]) => ({
    evidence: rule.evidence,
    provider,
  }));
}
