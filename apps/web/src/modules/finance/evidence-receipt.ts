/**
 * Reading a payment receipt as a **document with fields**, per provider.
 *
 * The generic readers around this one — `evidence-ocr`, `evidence-direction`,
 * `evidence-payee` — search the whole page for patterns. That is the right thing
 * to do when a file could be anything, and it is why they are the fallback. But
 * the files residents actually upload are not anything: they are one of about
 * five documents, each with a fixed layout, and reading them as such is the
 * difference between guessing a field and knowing it.
 *
 * Three shapes, and residents send all three:
 *
 * 1. **The post-payment screenshot.** eSewa's `Payment Successful` card, Khalti's
 *    confirmation, Fonepay's QR result. One transaction, big type, few fields.
 * 2. **The bank's payment receipt.** Everest Bank's `Payment Receipt`, ConnectIPS'
 *    voucher — a two-column table, label in one cell, value in the next.
 * 3. **The statement.** A whole month of rows with `Cr.`/`Dr.` columns. This is a
 *    real document a resident will genuinely send, and it is the one that cannot
 *    prove a single payment: it has many rows and nothing says which is theirs.
 *    Recognising it *as a statement* is what lets the form say so.
 *
 * **Nothing here refuses on its own.** It produces fields; the modules that
 * decide — direction, payee, the claim path — consume them. What it changes is
 * how often those modules have something solid to decide from.
 *
 * The column vocabulary is deliberately the same as
 * `statements/parsers/*` — `Cr.`, `Dr.`, `Amount(+)`, `Reference Code` — because
 * those were written against real exports and corrected against four real
 * breakages. A screenshot of a statement is that same export, photographed.
 */

export type ReceiptProvider =
  | "BANK"
  | "CONNECTIPS"
  | "ESEWA"
  | "FONEPAY"
  | "KHALTI"
  | "UNKNOWN";

/** What kind of document this is, which decides what it can prove. */
export type ReceiptShape = "RECEIPT" | "STATEMENT" | "UNKNOWN";

export type ParsedReceipt = {
  /** Whole rupees, from the provider's own amount field. */
  amount: number | null;
  direction: "CREDIT" | "DEBIT" | null;
  /** The name in the receiving field, whatever this provider calls it. */
  payee: string | null;
  /** The name in the paying field. Used to spot a payment made by somebody else. */
  payer: string | null;
  provider: ReceiptProvider;
  /** Free text where a resident would have typed the reference code. */
  remarks: string | null;
  shape: ReceiptShape;
  /** The provider's own transaction id, from its own labelled field. */
  txnId: string | null;
};

/**
 * A labelled value, in the two layouts a recognised receipt actually has.
 *
 * `Transaction Code: 8823119471` and a table cell holding `Transaction Code`
 * beside one holding `8823119471` are the same field to a human and completely
 * different strings to a recogniser. Both forms are read, punctuated first
 * because a colon is a label somebody wrote rather than a layout we inferred.
 *
 * The value may also sit on the *next* line, which is what a two-column table
 * becomes when the columns are narrow enough to wrap.
 */
export function labelledValue(text: string, label: RegExp): string | null {
  const source = label.source;
  const punctuated = new RegExp(
    `(?:^|\\n)[ \\t|]*(?:${source})[ \\t|]*[:\\-–][ \\t|]*([^\\n]{1,120})`,
    "i",
  );
  const tabular = new RegExp(
    `(?:^|\\n)[ \\t|]*(?:${source})[ \\t|]{1,}([^\\n]{1,120})`,
    "i",
  );
  const wrapped = new RegExp(
    `(?:^|\\n)[ \\t|]*(?:${source})[ \\t|]*\\n[ \\t|]*([^\\n]{1,120})`,
    "i",
  );

  for (const pattern of [punctuated, tabular, wrapped]) {
    const value = pattern.exec(text)?.[1]?.trim().replace(/[|]+$/, "").trim();

    if (value) return value;
  }

  return null;
}

/** Whole rupees from a receipt's amount string, or null when it is not one. */
function toAmount(raw: string | null): number | null {
  if (!raw) return null;

  // The number inside the field, so `NPR 8,500.00 (Eight thousand…)` reads as
  // 8500 rather than failing on the words after it.
  const match = /(\d[\d,\s]*(?:\.\d{1,2})?)/.exec(raw);

  if (!match) return null;

  const value = Number.parseFloat(match[1].replace(/[,\s]/g, ""));

  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;

  // Paisa are dropped rather than rounded: the ledger is whole rupees (ADR-1).
  return Math.floor(value);
}

/**
 * The amount printed against a currency marker, for a receipt that labels none.
 *
 * The **first** such number, not the largest and not the last: a confirmation
 * card leads with the amount paid, and the figures below it are fees, balances
 * and totals that a "largest wins" rule would happily prefer.
 */
function headlineAmount(text: string): string | null {
  return /(?:rs\.?|npr|रु)\s*([\d,\s]*\d(?:\.\d{1,2})?)/i.exec(text)?.[1] ?? null;
}

/**
 * A person's name, or null if the field holds something else.
 *
 * Receipts put account numbers, service codes and `N/A` in the same fields they
 * put names in, and a payee of `N/A` compared against the hostel's name is a
 * mismatch that would refuse a resident.
 */
function toName(raw: string | null): string | null {
  if (!raw) return null;

  const cleaned = raw.replace(/\s{2,}/g, " ").replace(/[.,;|]+$/, "").trim();

  if (!/[A-Za-zऀ-ॿ]/.test(cleaned)) return null;
  if (/^(?:n\/?a|null|none|-{1,})$/i.test(cleaned)) return null;

  return cleaned;
}

/**
 * One provider's document, described by what it says about itself.
 *
 * `brand` is what identifies the provider — matched against the whole page,
 * because a receipt names its issuer once, in the header, and OCR of a logo is
 * unreliable enough that the footer's `Thank you for using EBL Touch 24` is
 * often the more legible copy.
 */
type Template = {
  amount: RegExp;
  brand: RegExp;
  payee: RegExp;
  payer: RegExp;
  provider: ReceiptProvider;
  remarks: RegExp;
  txnId: RegExp;
};

/**
 * The templates, most specific brand first.
 *
 * `BANK` is last and its brand list is the banks whose receipts residents in
 * Nepal actually send. It is a genuine catch-all: bank receipts vary more than
 * wallet receipts, so its field labels are the union of the forms seen rather
 * than one bank's layout.
 */
const TEMPLATES: Template[] = [
  {
    // eSewa's own receipt and its `Payment Successful` card. `Transaction Code`
    // is eSewa's spelling and it is what the statement export uses too, which is
    // why the same label reads both.
    amount: /amount(?:\s*\(?npr\)?)?|total\s*amount|paid\s*amount/,
    brand: /\be-?sewa\b/i,
    payee: /(?:sent\s*to|paid\s*to|receiver|recipient|merchant(?:\s*name)?|service\s*name|to)/,
    payer: /(?:from|sender|paid\s*by|initiator|debited\s*from)/,
    provider: "ESEWA",
    remarks: /(?:remarks?|purpose|description|particulars)/,
    txnId: /(?:transaction\s*code|reference\s*code|transaction\s*id|txn\s*id)/,
  },
  {
    // Khalti labels its id `Purchase Order ID` on a merchant payment and
    // `Transaction ID` on a wallet transfer. Both appear on real screenshots.
    amount: /amount(?:\s*\(?(?:npr|rs\.?)\)?)?|total|paid/,
    brand: /\bkhalti\b/i,
    payee: /(?:paid\s*to|sent\s*to|receiver|recipient|merchant(?:\s*name)?|product\s*name|to)/,
    payer: /(?:from|sender|paid\s*by|mobile|customer(?:\s*name)?)/,
    provider: "KHALTI",
    remarks: /(?:remarks?|purpose|reference|detail|product\s*name)/,
    txnId: /(?:purchase\s*order\s*id|transaction\s*id|txn\s*id|idx|transaction\s*code)/,
  },
  {
    amount: /amount(?:\s*\(?(?:npr|rs\.?)\)?)?|total\s*amount/,
    brand: /\bfone\s?pay\b/i,
    payee: /(?:merchant(?:\s*name)?|paid\s*to|sent\s*to|receiver|recipient|to)/,
    payer: /(?:from|sender|payer|initiator|debited\s*from)/,
    provider: "FONEPAY",
    remarks: /(?:remarks?|purpose|reference|narration)/,
    txnId: /(?:trace\s*(?:id|no\.?)|transaction\s*id|txn\s*id|reference\s*(?:no\.?|id))/,
  },
  {
    amount: /amount(?:\s*\(?(?:npr|rs\.?)\)?)?|total\s*amount|transfer\s*amount/,
    brand: /\bconnect\s?ips\b/i,
    payee: /(?:beneficiary(?:\s*name)?|credited\s*to|receiver|payee|to\s*account|to)/,
    payer: /(?:debited\s*from|from\s*account|sender|payer|initiator)/,
    provider: "CONNECTIPS",
    remarks: /(?:remarks?|purpose|narration|particulars)/,
    txnId: /(?:transaction\s*id|reference\s*(?:no\.?|id)|rrn|txn\s*id)/,
  },
  {
    // The bank catch-all. `Qr Merchant Name` and `Initiator` are Everest Bank's
    // labels on the receipt that proved this module was needed.
    amount: /amount(?:\s*\(?(?:npr|rs\.?)\)?)?|total\s*amount|transaction\s*amount/,
    brand:
      /\b(?:bank|nabil|nic\s*asia|global\s*ime|siddhartha|prabhu|kumari|sanima|machhapuchchhre|nmb|laxmi|everest|ebl|nabil|rastriya\s*banijya|nepal\s*investment)\b/i,
    payee:
      /(?:q\.?r\.?\s*merchant(?:\s*name)?|merchant(?:\s*name)?|beneficiary(?:\s*name)?|credited\s*to|receiver(?:'s)?(?:\s*name)?|payee(?:\s*name)?|to\s*account)/,
    payer:
      /(?:initiator|debited\s*from|from\s*account|remitter|sender(?:'s)?(?:\s*name)?|account\s*holder)/,
    provider: "BANK",
    remarks: /(?:remarks?|purpose|narration|particulars|description)/,
    txnId:
      /(?:reference\s*code|transaction\s*id|reference\s*(?:no\.?|id)|rrn|txn\s*id|trace\s*(?:id|no\.?)|receipt\s*no\.?)/,
  },
];

/**
 * Column pairs that only exist on a **statement**, not on a receipt.
 *
 * Taken from the statement parsers, which were written against real exports:
 * eSewa prints `Cr.` and `Dr.`, Khalti prints `Amount(+)` and `Amount(-)`. A
 * single-payment receipt has one amount and no column for the other direction,
 * so seeing both is the clearest possible signal that this is a month of rows.
 */
const STATEMENT_COLUMN_PAIRS: [RegExp, RegExp][] = [
  [/(?:^|[\s|])cr\.?(?:$|[\s|])/i, /(?:^|[\s|])dr\.?(?:$|[\s|])/i],
  [/amount\s*\(\+\)/i, /amount\s*\(-\)/i],
  [/\bcredit\b/i, /\bdebit\b/i],
];

/** What a statement calls itself, when it says so outright. */
const STATEMENT_TITLE =
  /\b(?:account\s*statement|transaction\s*statement|statement\s*of\s*account|mini\s*statement|passbook|transaction\s*history)\b/i;

/**
 * Is this a month of rows rather than one payment?
 *
 * Two independent ways to tell, and either is enough: it says so in a heading, or
 * it carries both directions as columns. The second matters more — a screenshot
 * of a statement is usually cropped past the title.
 *
 * A running balance is not used as a signal on its own: plenty of single-payment
 * receipts print the balance after the transaction.
 */
export function looksLikeStatement(text: string): boolean {
  if (STATEMENT_TITLE.test(text)) return true;

  return STATEMENT_COLUMN_PAIRS.some(
    ([credit, debit]) => credit.test(text) && debit.test(text),
  );
}

/**
 * Which provider issued this document, or `UNKNOWN`.
 *
 * Ordered by specificity: a wallet's own name beats the bank list, because an
 * eSewa receipt for a bank transfer mentions both and the wallet is the one that
 * issued the document.
 */
export function detectProvider(text: string): ReceiptProvider {
  return TEMPLATES.find((template) => template.brand.test(text))?.provider ?? "UNKNOWN";
}

/**
 * The receipt's fields, read through its own provider's template.
 *
 * Every field is optional and a missing one is simply null — the consumers treat
 * absence as "ask the generic reader" or "amber", never as a fact about the
 * payment. **A wrong field here is worse than a missing one**, which is why
 * `toName` discards `N/A` and bare account numbers rather than passing them on
 * to be compared against the hostel's name.
 */
export function parseReceipt(text: string | null): ParsedReceipt {
  const empty: ParsedReceipt = {
    amount: null,
    direction: null,
    payee: null,
    payer: null,
    provider: "UNKNOWN",
    remarks: null,
    shape: "UNKNOWN",
    txnId: null,
  };

  if (!text) return empty;

  const provider = detectProvider(text);
  const statement = looksLikeStatement(text);
  const template = TEMPLATES.find((entry) => entry.provider === provider);

  if (!template) {
    return { ...empty, provider, shape: statement ? "STATEMENT" : "UNKNOWN" };
  }

  // **Fields are not read off a statement.** On a month of rows every label
  // matches the first row that happens to carry it, so a `payee` read here would
  // name whoever the resident paid *first that month* — presented to the payee
  // check as the recipient of this payment. A confidently wrong payee is the one
  // output that could refuse a resident who genuinely paid.
  if (statement) {
    return { ...empty, provider, shape: "STATEMENT" };
  }

  const payee = toName(labelledValue(text, template.payee));

  return {
    // The labelled field first, then the headline. A wallet's confirmation card
    // prints the amount in large type with a currency marker and *no label at
    // all* — `Rs. 8,500.00` on its own line — which is the commonest screenshot
    // a resident sends, so a labels-only reader finds nothing on it.
    amount:
      toAmount(labelledValue(text, template.amount)) ?? toAmount(headlineAmount(text)),
    // A single-transaction receipt from a wallet or bank is the payer's own copy
    // of a payment they made. The direction modules still have the final say —
    // this is the template's reading, and a receipt that says `Received from` in
    // its body contradicts it and wins there.
    direction: payee ? "DEBIT" : null,
    payee,
    payer: toName(labelledValue(text, template.payer)),
    provider,
    remarks: labelledValue(text, template.remarks),
    shape: "RECEIPT",
    txnId: labelledValue(text, template.txnId),
  };
}

/**
 * The claim form's payment-method vocabulary, for the provider we read.
 *
 * Returns null for `UNKNOWN` so a caller can tell "the receipt says Khalti" from
 * "the receipt does not say" — the two must not both look like a mismatch.
 */
export function methodForProvider(provider: ReceiptProvider): string | null {
  switch (provider) {
    case "ESEWA":
      return "ESEWA";
    case "KHALTI":
      return "KHALTI";
    case "FONEPAY":
      return "FONEPAY";
    case "BANK":
    case "CONNECTIPS":
      return "BANK_TRANSFER";
    default:
      return null;
  }
}

/**
 * What to tell a resident who uploaded a statement.
 *
 * Not a refusal, and the distinction is real: their payment probably *is* on that
 * page, so refusing it would turn away genuine proof. But a statement cannot show
 * which row is the payment they are claiming, and a reviewer handed a month of
 * transactions has to guess. Asking for the single receipt while they are still
 * on the form is worth more than an amber flag tomorrow.
 */
export const STATEMENT_GUIDANCE =
  "That looks like a full account statement rather than a receipt for one payment. Please upload the receipt or screenshot for the single payment you made to the hostel — the statement does not show which row is this month's rent.";
