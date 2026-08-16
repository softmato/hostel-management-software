/**
 * Which way the money moved, and whether it moved at all.
 *
 * Everything else in the evidence pipeline asks whether the *numbers* on the file
 * match the claim. This asks the question that comes before all of them: **is this
 * a record of the resident paying, or a record of them being paid?**
 *
 * It exists because a resident submitted a credit-side transaction PDF — money
 * arriving in their wallet — and every check went green. Of course it did: the
 * amount was on the file, the transaction ID was on the file, the vocabulary was a
 * receipt's vocabulary. A credit receipt and a debit receipt are the same document
 * with one word different, and nothing in the pipeline read that word.
 *
 * A payment to the hostel is, from the resident's side, **always a debit**. So the
 * one sentence this module exists to say is: *this receipt shows money coming in,
 * not going out — it cannot be proof that you paid.*
 *
 * **Three outcomes, and only one of them blocks.**
 *
 * - `DEBIT` — money left the resident. What a genuine claim looks like.
 * - `CREDIT` — money arrived. **Refused at submission**, because this is a
 *   positive read of the wrong word, not a failure to find the right one.
 * - `UNKNOWN` — the file does not say, or says both. Amber: the reviewer opens it.
 *
 * The asymmetry is the whole design, and it is the same rule the rest of the
 * pipeline follows. Refusing on a *found* contradiction is safe; refusing on an
 * *absent* confirmation would reject every receipt whose wording we have not seen,
 * and there are more Nepali banks than anyone has receipts from.
 */

/** How a transaction ended. A receipt for money that never moved is not evidence. */
export type EvidenceOutcome = "CANCELLED" | "FAILED" | "PENDING" | "SUCCESS" | "UNKNOWN";

export type EvidenceDirection = "CREDIT" | "DEBIT" | "UNKNOWN";

export type DirectionRead = {
  direction: EvidenceDirection;
  /**
   * True when both families appear at strength — an account statement with `Debit`
   * and `Credit` column headers, or a passbook page. The direction of *one row* on
   * such a file is not something this can answer, so it never blocks.
   */
  isLedgerView: boolean;
  outcome: EvidenceOutcome;
  /** The phrases that decided it, for the reviewer's detail line. */
  signals: string[];
  /**
   * True only when a phrase that can mean nothing but "money arrived" was read.
   * The refusal rests on this, never on the `direction` alone.
   */
  strongCredit: boolean;
};

/**
 * Phrases that mean money **left** the account the receipt belongs to.
 *
 * Anchored to whole phrases rather than the bare words. `to` and `from` are the
 * two commonest words on a receipt and both appear on both sides of every
 * transfer — `Sent to Ramesh` and `Received from Ramesh` differ only in the verb,
 * which is precisely why the verb is what is matched.
 */
const DEBIT_MARKERS: [string, RegExp][] = [
  // ---- Structural. A receipt's *shape* rather than its verbs. ----
  //
  // Nepal's commonest real receipt — a QR payment to a merchant — contains no
  // directional word anywhere. Everest Bank's `Payment Receipt` is the example
  // that proved it: `Reference Code`, `Channel`, `Payment Attribute`, `Service
  // Name`, `Amount`, `Initiator`, `Qr Merchant Name`, `Remarks`, `Status`. Not
  // one of `sent`, `paid to`, `debited` or `transferred` appears on it, and a
  // reader that only knows verbs calls it `UNKNOWN` — amber on the single most
  // common receipt in the country.
  //
  // But the shape settles it. A merchant, a QR and an initiator only exist on
  // the paying side: nobody receives money via a `Qr Merchant Name`, and the
  // `Initiator` of a payment is by definition the person whose account it left.
  ["qr merchant", /\bq\.?r\.?\s*merchant\b/i],
  ["merchant name", /\bmerchant\s*(?:name|code|id)\b/i],
  ["initiator", /\binitiat(?:or|ed\s+by)\b/i],
  ["debited", /\bdebit(?:ed)?\s*(?:from|amount|amt)?\b/i],
  ["dr", /(?:^|[\s|(])dr\.?(?:$|[\s|):])/i],
  ["sent to", /\b(?:sent|send|sending)\s+(?:money\s+)?to\b/i],
  ["paid to", /\bpaid\s+to\b/i],
  ["payment to", /\bpayment\s+(?:to|made\s+to)\b/i],
  ["transferred to", /\btransfer(?:red)?\s+to\b/i],
  ["you sent", /\byou\s+(?:have\s+)?(?:sent|paid|transferred)\b/i],
  ["withdrawal", /\b(?:withdraw(?:al|n)?|cash\s+out)\b/i],
  ["receiver", /\b(?:receiver|recipient|beneficiary|payee|credited\s+to)\b/i],
  ["outgoing", /\b(?:outgoing|money\s+out|debit\s+transaction)\b/i],
];

/**
 * Phrases that mean money **arrived** — the credit-side receipt.
 *
 * `credited to` is deliberately **absent** from this list and present in the one
 * above. On the payer's own receipt for a transfer, "Credited to: Sunrise Hostel"
 * describes where their money went — it is the payee line, and reading it as an
 * incoming credit would flip the direction on exactly the receipts we most want to
 * accept. The incoming form is `credited to your account`, matched below.
 */
const CREDIT_MARKERS: [string, RegExp][] = [
  ["received from", /\breceiv(?:ed|e)\s+from\b/i],
  ["you received", /\byou\s+(?:have\s+)?receiv(?:ed|e)\b/i],
  ["credited to your account", /\bcredit(?:ed)?\s+to\s+your\s+(?:account|wallet|balance)\b/i],
  ["amount credited", /\b(?:amount|money|fund)\s+credit(?:ed)?\b/i],
  ["deposit", /\b(?:deposit(?:ed)?|cash\s+in|load(?:ed)?\s+fund|fund\s+load)\b/i],
  ["refund", /\b(?:refund(?:ed)?|reversal|reversed|cashback|bonus|reward)\b/i],
  ["cr", /(?:^|[\s|(])cr\.?(?:$|[\s|):])/i],
  ["sender", /\b(?:sender|remitter|from\s+account|payer)\b/i],
  // The bare column header, symmetric to the bare `Debit` above. Weak on its own
  // — a payer's receipt says "Credited to: <hostel>" and scores this too — which
  // is why it cannot outvote the debit family by itself. Its real job is the
  // second half of `isLedgerView`: a statement page carries both headers, and
  // without this one such a page reads as a lopsided debit receipt.
  ["credit column", /\bcredit\b/i],
  ["incoming", /\b(?:incoming|money\s+in|credit\s+transaction)\b/i],
];

/**
 * How many of the credit markers above are strong enough to **refuse** on.
 *
 * The list is ordered strongest-first and this is the cut. Above it: phrases that
 * only ever appear on an incoming receipt — `received from`, `credited to your
 * account`, `refund`. Below it: `cr`, `sender`, `payer`, a bare `credit`. Those
 * are real signals and they earn their place in the tally and in `isLedgerView`,
 * but **not one of them may turn a resident away on its own.**
 *
 * The reason is OCR. A two-letter token like `cr`, or a stray `credit`, is
 * exactly what a recogniser produces out of a bank's logo, a Devanagari heading
 * or a table border — and a genuine Everest Bank QR receipt was refused as a
 * credit on that basis, with the resident told their proof showed money coming
 * in when it showed nothing of the sort. A refusal has to rest on a phrase that
 * means only one thing, never on a fragment that happens to look like one.
 */
const STRONG_CREDIT_MARKERS = 6;

/** Words that say the transaction did not complete. */
const OUTCOME_MARKERS: [EvidenceOutcome, RegExp][] = [
  ["FAILED", /\b(?:fail(?:ed|ure)?|declined|unsuccessful|rejected|error)\b/i],
  ["CANCELLED", /\b(?:cancel(?:led|ed)?|void(?:ed)?|expired)\b/i],
  ["PENDING", /\b(?:pending|processing|in\s+progress|awaiting|on\s+hold)\b/i],
  ["SUCCESS", /\b(?:success(?:ful|fully)?|completed?|approved|confirmed)\b/i],
];

/**
 * How many markers of the *other* family it takes before a file is a ledger view
 * rather than a receipt.
 *
 * A statement page carries both column headers and both verbs many times over;
 * a single-transaction receipt carries one family and, at most, a stray from the
 * other — `Dr` inside an account holder's name, `payer` in a footer. Two is where
 * the stray stops being a stray.
 */
const LEDGER_FLOOR = 2;

function matched(markers: [string, RegExp][], text: string): string[] {
  return markers.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/**
 * The direction and outcome of the transaction on this evidence.
 *
 * Pure, and separately tested — this is the judgement, and the recognition that
 * feeds it lives in `evidence-ocr`.
 */
export function readEvidenceDirection(text: string | null): DirectionRead {
  if (!text) {
    return {
      direction: "UNKNOWN",
      isLedgerView: false,
      outcome: "UNKNOWN",
      signals: [],
      strongCredit: false,
    };
  }

  const debit = matched(DEBIT_MARKERS, text);
  const credit = matched(CREDIT_MARKERS, text);
  const strongCredit = credit.some(
    (name) =>
      CREDIT_MARKERS.findIndex(([marker]) => marker === name) < STRONG_CREDIT_MARKERS,
  );

  // Ordered strongest-first, so `failed` on a page that also says `successful`
  // reads as failed. A receipt saying both is one describing a failure, and the
  // reviewer must see the pessimistic reading.
  const outcome =
    OUTCOME_MARKERS.find(([, pattern]) => pattern.test(text))?.[0] ?? "UNKNOWN";

  const isLedgerView = debit.length >= LEDGER_FLOOR && credit.length >= LEDGER_FLOOR;

  if (isLedgerView) {
    return {
      direction: "UNKNOWN",
      isLedgerView,
      outcome,
      signals: [...debit, ...credit],
      strongCredit: false,
    };
  }

  // A tie that is not a ledger view is still a file we cannot read a direction
  // off, and a wrong *refusal* is the expensive error here — the resident has
  // genuinely paid and is being told their proof is backwards.
  if (debit.length > credit.length) {
    return { direction: "DEBIT", isLedgerView, outcome, signals: debit, strongCredit };
  }

  if (credit.length > debit.length) {
    return { direction: "CREDIT", isLedgerView, outcome, signals: credit, strongCredit };
  }

  return {
    direction: "UNKNOWN",
    isLedgerView,
    outcome,
    signals: [...debit, ...credit],
    strongCredit,
  };
}

/**
 * The refusal sentence for a credit-side receipt, or null when the file may pass.
 *
 * Non-accusatory, like every other refusal on this form (target §8.2). Uploading
 * the wrong half of a transfer is an ordinary mistake — a wallet's history screen
 * lists both directions in the same list, in the same colour, one tap apart — and
 * the sentence's job is to say which one to go back for.
 */
export function directionRefusal(read: DirectionRead): string | null {
  if (read.isLedgerView) return null;

  // **Both, not either.** The verdict says the credit family outweighed the debit
  // family; `strongCredit` says at least one of those matches was a phrase that
  // cannot mean anything else. A receipt refused on a bare `cr` — which is what a
  // recogniser makes of a logo or a table rule — is a resident who really paid
  // being told their proof is backwards.
  if (read.direction === "CREDIT" && read.strongCredit) {
    return "That receipt shows money coming *into* your account, not a payment you made. Please upload the receipt for the payment you sent to the hostel — the one showing the money leaving your account.";
  }

  return null;
}

/**
 * The refusal sentence for a transaction that did not complete, or null.
 *
 * `PENDING` is deliberately **not** refused: a bank transfer genuinely sits
 * pending for a day and the money does arrive, so refusing it would turn a real
 * payment away. It is amber — the reviewer sees the word and waits for the
 * statement, which is exactly the decision they should be making.
 */
export function outcomeRefusal(read: DirectionRead): string | null {
  if (read.outcome === "FAILED") {
    return "That receipt says the transaction failed, so no money left your account. Please upload the receipt for a payment that went through.";
  }

  if (read.outcome === "CANCELLED") {
    return "That receipt says the transaction was cancelled, so no money left your account. Please upload the receipt for a payment that went through.";
  }

  return null;
}
