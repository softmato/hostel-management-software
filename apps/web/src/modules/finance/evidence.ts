import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  RECEIPT_NUMBER_PATTERN,
  SYSTEM_DOCUMENT_FOOTER,
  SYSTEM_DOCUMENT_MARKER,
  type SystemDocumentKind,
} from "@/modules/finance/receipt-pdf";

/**
 * Evidence fingerprinting (target §8, plan item 3.4).
 *
 * Two questions, two hashes, and they must not be confused:
 *
 * - **Content hash** (SHA-256, computed at upload by item 0.3) answers "are
 *   these the same bytes?" It is exact, cheap, and a match is proof. A duplicate
 *   here is auto-rejected and never reaches the owner's queue (target P7).
 * - **Perceptual hash** answers "do these look the same?" It is a similarity
 *   score, and a match is *evidence*, not proof — a resident who screenshots the
 *   same transfer twice at different crops or JPEG qualities is not committing
 *   fraud. A near match is therefore **flagged for review and never
 *   auto-rejected**, which is the rule this module exists to keep.
 *
 * No new dependency: `sharp` is already used for image variants (D6).
 */

/** Width of the dHash grid. 9×8 comparisons give 64 bits. */
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * Difference hash: downscale to 9×8 grayscale, then emit one bit per horizontal
 * neighbour pair saying whether the left pixel is brighter.
 *
 * dHash rather than average hash because it keys on *gradients* rather than
 * absolute brightness, so a screenshot re-taken at a different display
 * brightness or re-encoded by a chat app still lands on the same value — which
 * is exactly the population this check is aimed at.
 */
export async function computePerceptualHash(
  bytes: Buffer | Uint8Array,
): Promise<string | null> {
  let pixels: Buffer;

  try {
    pixels = await sharp(bytes)
      .greyscale()
      // `fit: "fill"` on purpose: preserving aspect ratio would make the same
      // screenshot cropped differently hash differently, which is the case we
      // most want to catch.
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
      .raw()
      .toBuffer();
  } catch {
    // A PDF, a corrupt file, or anything sharp cannot decode. Not an error:
    // evidence that cannot be perceptually hashed simply gets no similarity
    // check, and the content hash still applies.
    return null;
  }

  let bits = "";

  for (let row = 0; row < HASH_HEIGHT; row += 1) {
    for (let column = 0; column < HASH_WIDTH - 1; column += 1) {
      const left = pixels[row * HASH_WIDTH + column] ?? 0;
      const right = pixels[row * HASH_WIDTH + column + 1] ?? 0;

      bits += left > right ? "1" : "0";
    }
  }

  // 64 bits as 16 hex characters, so it stores and compares as a short string.
  return (
    bits
      .match(/.{1,4}/g)
      ?.map((nibble) => parseInt(nibble, 2).toString(16))
      .join("") ?? null
  );
}

/** Bits that differ between two 64-bit hashes. Returns null if either is unusable. */
export function hammingDistance(a: string, b: string): number | null {
  if (a.length !== b.length || a.length === 0) return null;

  let distance = 0;

  for (let index = 0; index < a.length; index += 1) {
    const left = parseInt(a[index]!, 16);
    const right = parseInt(b[index]!, 16);

    if (Number.isNaN(left) || Number.isNaN(right)) return null;

    // Popcount of the 4-bit difference.
    let xor = left ^ right;

    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/**
 * How different two 64-bit dHashes may be and still be called "the same image".
 *
 * Ten of sixty-four. Tighter than the usual 5 because the population here is
 * screenshots of bank apps — large flat regions, small differing digits — where
 * two genuinely different transfers from the same app already share most bits.
 * Being generous is safe *because a near match is never an auto-rejection*: it
 * only puts a note in front of a human who can see both images.
 */
export const PERCEPTUAL_MATCH_THRESHOLD = 10;

export function isPerceptualNearDuplicate(a: string, b: string): boolean {
  const distance = hammingDistance(a, b);

  return distance !== null && distance <= PERCEPTUAL_MATCH_THRESHOLD;
}

/**
 * Is this file one our own system produced?
 *
 * A receipt is our statement that the hostel received money. A resident
 * submitting it back as *their* evidence that they paid is circular — and it
 * used to work: every check went green, because nothing distinguished our own
 * template from a bank's. A content hash cannot catch it either, since each
 * render is a fresh document for a different month.
 *
 * **Parsed, not scanned.** The obvious implementation — search the bytes for the
 * marker — silently never matches: pdf-lib packs the Info dictionary into a
 * Flate-compressed object stream and hex-encodes metadata as UTF-16BE, so the
 * token is not present as readable text anywhere in the file. The marker is read
 * back the same way it was written, through the PDF's metadata.
 *
 * Returns null for anything that is not a PDF we stamped, including files that
 * cannot be parsed at all: a deliberately corrupt upload is somebody else's
 * problem (`verifyUploadedObject` already rejects it) and must not throw here.
 */
export async function systemDocumentKind(
  bytes: Uint8Array | null | undefined,
): Promise<SystemDocumentKind | null> {
  // Cheap gate, so arbitrary uploaded bytes are never handed to a parser.
  if (!bytes || bytes.length < 5) {
    return null;
  }

  if (Buffer.from(bytes.slice(0, 5)).toString("latin1") !== "%PDF-") {
    return null;
  }

  try {
    // `updateMetadata: false` keeps the load read-only; without it pdf-lib
    // rewrites ModDate on the in-memory document.
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const stamped = [pdf.getSubject(), pdf.getCreator(), pdf.getKeywords()]
      .filter((value): value is string => typeof value === "string")
      .find((value) => value.includes(SYSTEM_DOCUMENT_MARKER));

    if (!stamped) {
      return null;
    }

    return stamped.includes(`${SYSTEM_DOCUMENT_MARKER}-STATEMENT`)
      ? "STATEMENT"
      : "RECEIPT";
  } catch {
    // Not a PDF we can read. Not ours, as far as anyone can tell.
    return null;
  }
}

/**
 * The same question, asked of the *text* on the evidence.
 *
 * {@link systemDocumentKind} reads metadata, which is exact and which a
 * screenshot does not have. And a screenshot is what residents actually upload:
 * they open the receipt on their phone, screenshot it, and attach that. Every
 * OCR signal then agrees it is a payment record — there is a provider, a
 * currency, an amount, a date — and it carries the invoice's reference code
 * because we printed it there ourselves, which is the strongest corroboration
 * this system has. Our own receipt was the best-scoring evidence a resident could
 * submit.
 *
 * That is the bug behind the report this was written for: a receipt issued for a
 * 60-rupee part payment was re-submitted against the remaining 1,230, and the
 * reference check confirmed it, because the invoice's code is the same code all
 * month — one code per invoice is correct for *matching money to a month*, and it
 * was never meant to identify a single payment. The receipt number is what does
 * that, and it is the thing to look for here.
 *
 * **Two independent markers, either sufficient**, because OCR loses characters:
 * the receipt number's shape, and the footer sentence. A recogniser that mangles
 * one usually leaves the other.
 *
 * Returns `RECEIPT` or null only. A statement's text is not distinctive enough to
 * match on without catching real bank statements, which residents legitimately
 * upload — and the metadata path already covers the statement PDF itself.
 */
export function systemDocumentKindFromText(
  text: string | null | undefined,
): SystemDocumentKind | null {
  if (!text) {
    return null;
  }

  return RECEIPT_NUMBER_PATTERN.test(text) || SYSTEM_DOCUMENT_FOOTER.test(text)
    ? "RECEIPT"
    : null;
}
