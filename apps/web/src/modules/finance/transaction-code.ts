/**
 * Is this a transaction id at all? (gap fix 3.)
 *
 * The review checks verified the *typed* claim against the invoice and never
 * asked whether what was typed could be real, so `dummy`, `1234` and `aaaa` all
 * reached the owner's queue looking exactly like a genuine wallet reference —
 * and if the resident also quoted the right invoice code, every check went green
 * and `Approve all` would sweep it.
 *
 * Nothing here can tell a *fabricated* id from a real one: only the provider
 * knows that, and until statement reconciliation matches the id against the
 * provider's own export (Tier 0.5) the id is a resident's assertion. What this
 * does is refuse the ids that cannot possibly be real, which is what the
 * placeholder cases actually are.
 *
 * **Deliberately shape-based rather than per-provider.** eSewa, Khalti, Fonepay
 * and eighteen Nepali banks all format their references differently and change
 * them without telling anyone, so a per-provider regex would start rejecting
 * real payments the first time a provider added a character. Every rule below is
 * a property no provider's id has ever had.
 *
 * Pure module: no I/O.
 */

/** Separators a resident might copy along with the id. Not part of its value. */
function canonicalize(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s\-_/.]/g, "");
}

/**
 * Words that are never an id, however they are decorated.
 *
 * Matched against the canonical form, so `TEST-123` and `test 123` are the same
 * entry. Checked as a whole-value equality *or* as the entire alphabetic part,
 * so `TEST1234` is caught but a real `TESTA9481203` — a bank whose prefix
 * happens to contain the letters — is not.
 */
const PLACEHOLDERS = new Set([
  "ABC",
  "ASDF",
  "DEMO",
  "DUMMY",
  "FAKE",
  "NA",
  "NIL",
  "NONE",
  "NOTHING",
  "PAID",
  "QWERTY",
  "SAMPLE",
  "TEST",
  "TESTING",
  "UNKNOWN",
  "XXX",
  "YES",
]);

/**
 * The shortest a real reference can be.
 *
 * Six. Wallet ids run eight to twenty characters and the shortest bank reference
 * anyone has produced in testing was seven digits. Four would let `1234` through
 * on length alone, and the sequence rule below should not be the only thing
 * standing in its way.
 */
const MIN_LENGTH = 6;

function isRepeatedCharacter(value: string): boolean {
  return value.length > 1 && new Set(value).size === 1;
}

/** `123456`, `ABCDEF`, `654321` — a run of consecutive code points either way. */
function isSequentialRun(value: string): boolean {
  if (value.length < 3) return false;

  const step = value.charCodeAt(1) - value.charCodeAt(0);

  if (step !== 1 && step !== -1) return false;

  return value
    .split("")
    .every(
      (character, index) =>
        index === 0 ||
        character.charCodeAt(0) - value.charCodeAt(index - 1) === step,
    );
}

/**
 * Why this cannot be a transaction id, or null when it could be.
 *
 * The messages say what to do, not what the resident appears to have done. An
 * honest resident who typed the amount into the wrong field sees this far more
 * often than anyone testing the system does.
 */
export function transactionCodeProblem(raw: string | null | undefined): string | null {
  const value = canonicalize(raw ?? "");

  if (!value) return null;

  if (value.length < MIN_LENGTH) {
    return "That transaction ID looks too short. Open the app you paid with and copy the full transaction or reference ID from the payment receipt.";
  }

  const letters = value.replace(/[^A-Z]/g, "");

  if (PLACEHOLDERS.has(value) || (letters === value && PLACEHOLDERS.has(letters))) {
    return "Please enter the real transaction ID from your payment receipt, not a placeholder.";
  }

  if (isRepeatedCharacter(value) || isSequentialRun(value)) {
    return "That does not look like a transaction ID. Open the app you paid with and copy the ID from the payment receipt.";
  }

  // Every provider's reference carries digits — a wallet id, a bank's serial, a
  // Fonepay trace. A purely alphabetic string is a word, and the word is
  // overwhelmingly "paid" or the resident's own name.
  if (!/[0-9]/.test(value)) {
    return "A transaction ID contains numbers. Open the app you paid with and copy the ID from the payment receipt.";
  }

  return null;
}

/**
 * Methods where the id is not optional.
 *
 * Every one of these hands the payer a reference on a confirmation screen, and
 * without it a claim cannot be reconciled against the provider's statement — it
 * can only be believed. Cash has no id to give, and `OTHER` is the escape hatch
 * for the case nobody anticipated, so neither is required.
 */
const CODE_REQUIRED_METHODS = new Set([
  "BANK_TRANSFER",
  "ESEWA",
  "FONEPAY",
  "KHALTI",
]);

export function transactionCodeRequired(paymentMethod: string): boolean {
  return CODE_REQUIRED_METHODS.has(paymentMethod);
}
