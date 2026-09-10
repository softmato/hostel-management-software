import { rgb } from "pdf-lib";

/**
 * The house grammar of a plan invoice and a plan receipt.
 *
 * These two documents are one design with two contents, so every measurement
 * and every colour lives here rather than beside the block that happens to use
 * it first. A margin nudged on the invoice and not the receipt is the kind of
 * drift nobody sees until the two are printed side by side.
 *
 * ## Two type families, and each one means something
 *
 * **Helvetica** carries the words — the party names, the labels, what the plan
 * includes. **Courier** carries everything that is a *figure or an identifier*:
 * amounts, document numbers, dates, transaction references. That split is not
 * decoration. A monospace amount column aligns on the decimal point without a
 * tab stop, and a document number in a fixed pitch can be read back over a
 * phone one character at a time, which is what a hostel owner is actually
 * doing when they quote one to support.
 *
 * The three standard PDF families are used rather than an embedded face
 * because they need no font file, no licence and no bytes: every reader on
 * earth already has them, and a document that renders identically on a Nepali
 * accountant's decade-old Acrobat is worth more here than a typeface.
 *
 * ## Colour is structural, not decorative
 *
 * Four inks. `text` is what the document says. `label` is what the document
 * calls it — muted, because a form's field names must not compete with the
 * values in them. `accent` is the brand green, used only where something is
 * *live*: an address that can be written to, a status that has been reached.
 * `rule` divides.
 *
 * There is no red. A document is not an alert, and an unpaid invoice is an
 * ordinary state of an ordinary invoice — painting it as a warning is a tone
 * this company does not take with a customer who has done nothing wrong.
 */

/** A4, in points. The paper every reader of this document prints on. */
export const PAGE = {
  height: 841.89,
  width: 595.28,
} as const;

export const MARGIN = {
  bottom: 56,
  left: 52,
  right: 52,
  top: 56,
} as const;

export const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

export const COLORS = {
  /** The one accent. `#0a8a4b` — the platform's own green, nothing sampled. */
  accent: rgb(0.039, 0.541, 0.294),
  /** Field names. Warm rather than neutral grey, so a page of them still reads as ink. */
  label: rgb(0.541, 0.494, 0.42),
  /** Hairlines between blocks. */
  rule: rgb(0.851, 0.839, 0.816),
  /** The heavy rule under the masthead, and box borders. */
  ruleStrong: rgb(0.11, 0.11, 0.11),
  /** Secondary prose — a Gregorian date beside a Nepali one, a footnote. */
  muted: rgb(0.443, 0.427, 0.404),
  text: rgb(0.106, 0.106, 0.106),
} as const;

export const SIZE = {
  /** The one figure that dominates the receipt. */
  amount: 26,
  body: 9.5,
  /** Section names — `RECEIVED FROM`, `BILL TO`. Always letterspaced caps. */
  eyebrow: 7,
  footnote: 7.5,
  /** The masthead. */
  issuer: 12.5,
  label: 8.5,
  /** `I N V O I C E`, `P A Y M E N T   R E C E I P T`. */
  title: 13,
  /** A party's name under its eyebrow. */
  partyName: 11,
} as const;

/**
 * Vertical rhythm. Every gap on both documents is one of these.
 *
 * Tuned against the parent company's own pages rather than picked: with tighter
 * values both documents finished two thirds of the way down A4 and left a hand's
 * width of nothing above a footer pinned to the bottom margin. A statutory
 * document that stops early reads as truncated — the first question it prompts
 * is whether a page is missing — and the fix is the gaps, not a floating footer,
 * because the footer is where the eye goes to check it has the whole thing.
 */
export const SPACE = {
  /** Between two things that are not about each other. */
  block: 34,
  /** One row of a label/value list. */
  line: 18,
  /** Around a hairline. Doubled either side, so it is the largest seam. */
  rule: 26,
  /** Inside one thought — an eyebrow and the name under it. */
  tight: 15,
} as const;

/**
 * How far apart the letters sit in a caps title.
 *
 * Letterspacing is drawn character by character (see `layout.ts`), so it is
 * expensive and used in exactly two places: the document title and the
 * eyebrows. Anywhere else it would be a per-glyph draw call buying nothing.
 */
export const TRACKING = {
  eyebrow: 1.4,
  title: 3.4,
} as const;
