/**
 * What the hostel's own QR poster says about the hostel.
 *
 * A static QR is not an opaque image. The printed poster a hostel uploads —
 * the eSewa/Khalti card, the bank's NepalPay standee — carries the account
 * holder's **name** and the **account or wallet number** in plain text beside
 * the code, because that is how the person scanning it checks they are paying
 * the right shop. So a hostel that has uploaded only a QR has already told us
 * its payee identity; it has simply told us in pixels.
 *
 * That matters for exactly one reason. `evidence-payee.ts` is the only check in
 * the claim pipeline a payer cannot satisfy by typing, and it works by comparing
 * the receipt's payee line against identifiers **from our own database**. Before
 * this module those identifiers came only from fields the admin typed, so a
 * QR-only hostel — a perfectly normal, fully working hostel — got `UNKNOWN` on
 * every claim it ever received. Reading the poster once, at upload, turns that
 * hostel into a verifiable one without asking it for anything it has already
 * given us.
 *
 * **The contract is the same as the rest of the OCR surface: it never fails
 * anything.** A poster we cannot read is not an error and not a rejection — it
 * leaves the fields empty, and the admin screen asks for the name and number in
 * a box. Guessing would be worse than asking: a wrong identifier here does not
 * merely fail to match, it teaches the payee check to accept the wrong account.
 */

import { loadSharp } from "@/lib/sharp";

/**
 * Labels a QR poster puts in front of the account holder's name.
 *
 * Not the same vocabulary as a receipt's (`Sent to`, `Paid to`) — a poster is
 * describing itself, not a transfer, so it says `Merchant Name` or `A/C Name`.
 * The bare `Name` is included because the commonest bank standee prints exactly
 * that, and unlike on a receipt there is no sender here for it to collide with:
 * every name on this image belongs to the hostel.
 */
const QR_NAME_LABELS =
  /(?:^|\n)[ \t|]*(?:merchant(?:'s)?\s+name|account\s+(?:holder(?:'s)?\s+)?name|a\/?c\s+name|beneficiary(?:'s)?\s+name|payee(?:'s)?\s+name|holder(?:'s)?\s+name|account\s+holder|name)[ \t|]*[:\-–]?[ \t|]*(?:\n[ \t|]*)?([^\n]{2,80})/i;

/**
 * Labels for the number, and the omissions are deliberate.
 *
 * `Merchant ID` and `Terminal ID` are **not** here. They identify the QR at the
 * acquirer, not the account, and they do not appear on the receipt the resident
 * later uploads — so storing one as an identifier adds a string that can never
 * match and, at eight-plus digits, might one day match something else by
 * accident.
 */
const QR_NUMBER_LABELS =
  /(?:^|\n)[ \t|]*(?:account\s+(?:no|number)|a\/?c\s+(?:no|number)|esewa\s+id|khalti\s+id|wallet\s+(?:id|no|number)|mobile\s+(?:no|number)|contact\s+(?:no|number))[ \t|.]*[:\-–]?[ \t|]*(?:\n[ \t|]*)?([^\n]{2,60})/i;

/** Devanagari digits, which Nepali posters mix into otherwise Latin text. */
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

function normalizeDigits(value: string): string {
  return value.replace(/[०-९]/g, (digit) => String(DEVANAGARI_DIGITS.indexOf(digit)));
}

export type QrPayeeRead = {
  /** Digits only, or null. Long enough to identify an account, never a date. */
  accountNumber: string | null;
  /** The account holder as printed, or null. */
  name: string | null;
};

/**
 * The shortest run of digits we are willing to call an account.
 *
 * Eight is the same floor `hostelPayeeIdentity` matches on, and for the same
 * reason: below it an "account number" collides with a date, an amount or a
 * page number, and a false identifier is worse here than a missing one.
 */
const MIN_ACCOUNT_DIGITS = 8;
const MAX_ACCOUNT_DIGITS = 20;

function cleanName(raw: string): string | null {
  const cleaned = raw
    // The number frequently shares the line with the name on a two-column
    // poster. The name is the left of it.
    .replace(/\d[\d\s-]{5,}.*$/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[.,;:|]+$/, "")
    .trim();

  // Letters, or it is not a name — a stray rule or a bare number.
  return cleaned.length >= 2 && /[A-Za-zऀ-ॿ]/.test(cleaned) ? cleaned.slice(0, 120) : null;
}

function cleanAccountNumber(raw: string): string | null {
  const digits = normalizeDigits(raw).replace(/\D/g, "");

  return digits.length >= MIN_ACCOUNT_DIGITS && digits.length <= MAX_ACCOUNT_DIGITS
    ? digits
    : null;
}

/**
 * Phrases that make a poster a poster: an invitation to *pay the person shown*.
 *
 * This is what licenses the unlabelled read below, and it is doing real work.
 * On a labelled poster the label says which line is the account. Here nothing
 * does — so the guarantee has to come from the document type instead. A page
 * that says `Show this QR code to receive money` is a receiving instrument, and
 * the name and number printed under the code are, by construction, the person
 * receiving. A random screenshot with a phone number on it says none of this and
 * is read as nothing.
 */
const RECEIVE_MARKERS =
  /(?:show\s+this\s+qr|receive\s+money|scan\s*(?:&|and)?\s*pay|scan\s+to\s+pay|scan\s+me|merchant\s+qr|payment\s+qr|fonepay|nepalpay|esewa|khalti|ime\s*pay|connect\s*ips)/i;

/**
 * Lines whose number is somebody else's.
 *
 * A helpline is the one other long number that appears on these posters, and it
 * is the one mistake that would be actively harmful: storing eSewa's support
 * line as this hostel's account means the next hostel to be paid by the same
 * wallet matches against it.
 */
const NOT_AN_ACCOUNT =
  /(?:help\s*line|helpline|customer\s+(?:care|service)|support|toll\s*free|contact\s+us|call\s+us|hotline|branch\s+code|swift|pan\b|vat\b)/i;

/** A line that is nothing but a plausible account or wallet number. */
const STANDALONE_NUMBER = /^[\s|]*([\d०-९][\d०-९\s-]{7,24})[\s|.]*$/;

/**
 * A line that reads as a person's or business's name.
 *
 * Mostly letters, no currency, no url, and long enough not to be a stray mark.
 * `eSewa`/`Khalti` themselves are excluded by the wordmark list — the provider
 * is not the payee, exactly as `bankName` is not a payee name.
 */
const PROVIDER_WORDMARK =
  /^(?:e[\s-]?sewa|khalti|fonepay|nepalpay|ime\s*pay|connect\s*ips|prabhu\s*pay|nic\s*asia|nabil|global\s*ime|everest|siddhartha|machhapuchchhre|kumari|sanima|laxmi|nmb|citizens?)\b/i;

function looksLikeName(line: string): boolean {
  const value = line.trim();

  if (value.length < 3 || value.length > 60) return false;
  if (PROVIDER_WORDMARK.test(value)) return false;
  if (NOT_AN_ACCOUNT.test(value)) return false;
  if (/https?:|www\.|@|rs\.?\s*\d|npr|\d{4,}/i.test(value)) return false;

  const letters = value.replace(/[^A-Za-zऀ-ॿ]/g, "").length;

  // Predominantly letters. A line of digits with a stray `l` in it is not a name.
  return letters >= 3 && letters / value.length > 0.6;
}

/**
 * The unlabelled poster, which is the one hostels actually upload.
 *
 * The eSewa "receive money" card — far and away the commonest in Nepal — prints
 * the wordmark, then the account holder, then the wallet number, then
 * `Show this QR code to receive money`, and **not one of those lines carries a
 * label.** A strictly label-anchored reader takes nothing from it, which meant
 * the reader was tuned for posters that mostly do not exist.
 *
 * So the anchor here is *structure* rather than vocabulary, and it is narrow on
 * purpose: a standalone line that is nothing but 8–16 digits, on a page that has
 * already identified itself as a receiving instrument, with the name taken from
 * the nearest name-like line **above** it — the layout every one of these cards
 * shares, because it is the order a human reads to check who they are paying.
 *
 * Everything that is not that shape is still declined.
 */
function readUnlabelledPoster(text: string): QrPayeeRead {
  if (!RECEIVE_MARKERS.test(text)) {
    return { accountNumber: null, name: null };
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // The disclaimer can sit on its own line above the number it disclaims —
    // `Helpline` then `16600172000` is exactly how these cards print it, so
    // testing only the number's own line misses every one of them.
    if (NOT_AN_ACCOUNT.test(line) || (index > 0 && NOT_AN_ACCOUNT.test(lines[index - 1]))) {
      continue;
    }

    const digits = STANDALONE_NUMBER.exec(line)?.[1];
    const accountNumber = digits ? cleanAccountNumber(digits) : null;

    if (!accountNumber) continue;

    // The line before it, skipping the wordmark the card puts above the name.
    let name: string | null = null;

    for (let back = index - 1; back >= 0 && index - back <= 3; back -= 1) {
      if (looksLikeName(lines[back])) {
        name = cleanName(lines[back]);
        break;
      }
    }

    return { accountNumber, name };
  }

  return { accountNumber: null, name: null };
}

/**
 * Read a QR poster's payee identity out of its recognised text.
 *
 * Labels first, because a label is a statement of what the value *is*; the
 * structural read is the fallback for the unlabelled cards the wallets actually
 * export. Neither will ever guess: a page with a number on it and nothing that
 * marks it as a payment poster reads as nothing, and the admin screen asks.
 */
export function readQrPayee(text: string | null | undefined): QrPayeeRead {
  if (!text) {
    return { accountNumber: null, name: null };
  }

  const nameMatch = QR_NAME_LABELS.exec(text)?.[1];
  const numberMatch = QR_NUMBER_LABELS.exec(text)?.[1];

  const labelled: QrPayeeRead = {
    accountNumber: numberMatch ? cleanAccountNumber(numberMatch) : null,
    name: nameMatch ? cleanName(nameMatch) : null,
  };

  if (labelled.accountNumber && labelled.name) {
    return labelled;
  }

  const structural = readUnlabelledPoster(text);

  // Merged field by field: a card can label its number and not its name.
  return {
    accountNumber: labelled.accountNumber ?? structural.accountNumber,
    name: labelled.name ?? structural.name,
  };
}

/** Did the read produce anything worth storing? */
export function hasQrPayee(read: QrPayeeRead): boolean {
  return Boolean(read.accountNumber || read.name);
}

/**
 * Read the poster image itself — with a second attempt at it inverted.
 *
 * Wallet apps export these cards **dark**: white text on near-black, because
 * that is what the app looked like when the user tapped share. Tesseract is
 * trained on dark-on-light and degrades badly on the reverse, and the shared
 * `prepare()` greyscales and normalises but never inverts — so the commonest
 * poster in Nepal was being handed to the recogniser in the one polarity it
 * reads worst.
 *
 * Inverting unconditionally would break the light posters, so it is a *retry*:
 * cheap, and only paid on the images the first pass could not read. Same silent
 * contract as everything else here — sharp missing, image undecodable, worker
 * dead all mean "no read", never an error.
 */
export async function readQrPayeeFromImage(
  bytes: Buffer | Uint8Array,
  mimeType: string | undefined,
  readText: (
    input: Buffer | Uint8Array,
    mimeType?: string,
  ) => Promise<string | null>,
): Promise<QrPayeeRead> {
  const first = readQrPayee(await readText(bytes, mimeType));

  if (hasQrPayee(first)) return first;

  try {
    const sharp = await loadSharp();

    if (!sharp) return first;

    const inverted = await sharp(bytes).rotate().greyscale().negate().png().toBuffer();

    const second = readQrPayee(await readText(inverted, "image/png"));

    return hasQrPayee(second) ? second : first;
  } catch {
    return first;
  }
}
