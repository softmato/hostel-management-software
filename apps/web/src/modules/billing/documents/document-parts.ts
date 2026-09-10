import { StandardFonts, type PDFDocument } from "pdf-lib";

import { bsFiscalYear, bsMonthName, toBs } from "@hostel/shared/calendar/bs";

import type { Cursor, Ink } from "./layout";
import { COLORS, MARGIN, PAGE, SIZE, SPACE } from "./theme";

/**
 * The parts both documents are made of: who issued it, how a date is written,
 * how money is set, and what the page closes on.
 *
 * The invoice and the receipt are the same stationery with different contents.
 * Anything that appears on both — the masthead, the VAT footnote, the
 * computer-generated line at the foot — is written once here, because the two
 * saying slightly different things about the same company is the failure mode
 * that matters. A hostel owner comparing an invoice to its receipt is checking
 * that they came from the same place.
 */

/** Who the document is from. Read from the `issuer` site-config section. */
export type Issuer = {
  address: string;
  email: string;
  legalName: string;
  pan: string;
  phone: string;
  productName: string;
  vatRegistered: boolean;
};

export async function loadInk(pdf: PDFDocument): Promise<Ink> {
  const [bold, mono, monoBold, regular] = await Promise.all([
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.Courier),
    pdf.embedFont(StandardFonts.CourierBold),
    pdf.embedFont(StandardFonts.Helvetica),
  ]);

  return { bold, mono, monoBold, regular };
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/**
 * `17 Bhadra 2083 BS` — day first, the way it is written on Nepali paper.
 *
 * Deliberately not `formatBsDate()` from the shared calendar, which produces
 * `Bhadra 17, 2083 BS` for the app's screens. That is the same date and the
 * wrong register: month-first is how a product surface labels a period, and
 * day-first is how a form, a receipt book and a tax document write a date. Both
 * are correct; this one is what belongs on this page.
 *
 * The conversion underneath is the shared one either way — this composes
 * `toBs()` and `bsMonthName()` rather than reimplementing a calendar, which is
 * the part that must never exist twice.
 */
export function documentBsDate(instant: Date): string {
  try {
    const bs = toBs(instant);
    const month = bsMonthName(bs.month);

    return month ? `${bs.day} ${month} ${bs.year} BS` : "";
  } catch {
    return "";
  }
}

/** `2 Sept 2026` — the bracketed Gregorian translation beside it. */
export function documentAdDate(instant: Date): string {
  return instant.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kathmandu",
    year: "numeric",
  });
}

/** `2 Sept 2026, 10:00 am NPT` — a moment, not a day. On the receipt only. */
export function documentInstant(instant: Date): string {
  const time = instant
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      hour12: true,
      minute: "2-digit",
      timeZone: "Asia/Kathmandu",
    })
    .toLowerCase();

  return `${documentAdDate(instant)}, ${time} NPT`;
}

export { bsFiscalYear };

/* ── Money ─────────────────────────────────────────────────────────────── */

/**
 * `1,20,000.00` — grouped the South Asian way, always to two places.
 *
 * The trailing `.00` is not noise. Every amount in this product is a whole
 * rupee, so a bare `150` on a document is indistinguishable from `150` that has
 * been truncated from something else; two decimal places state that the paisa
 * column was looked at and is empty. `en-IN` gives the lakh grouping that the
 * words line under it also uses, so the figure and the words break at the same
 * places.
 */
export function documentAmount(rupees: number): string {
  return rupees.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/* ── Blocks ────────────────────────────────────────────────────────────── */

/**
 * The masthead: the company, and how to reach it.
 *
 * The receipt draws it alone across the page; the invoice draws it in the left
 * column with the document title opposite. `compact` is that difference — the
 * receipt shows the PAN and the email under the name, the invoice shows the
 * full address block, because the invoice is the document a business files.
 */
export function drawIssuer(
  cursor: Cursor,
  issuer: Issuer,
  options: { compact?: boolean } = {},
): void {
  cursor.line(MARGIN.left, issuer.legalName, {
    font: cursor.ink.bold,
    size: SIZE.issuer,
  });

  const lines: { color?: typeof COLORS.accent; value: string }[] = [];

  if (!options.compact && issuer.address) {
    lines.push({ color: COLORS.accent, value: issuer.address });
  }

  if (!options.compact && issuer.phone) {
    lines.push({ value: issuer.phone });
  }

  if (options.compact && issuer.pan) {
    lines.push({ value: `PAN:  ${issuer.pan}` });
  }

  if (issuer.email) {
    lines.push({ color: COLORS.accent, value: issuer.email });
  }

  if (!options.compact && issuer.pan) {
    lines.push({ value: `PAN: ${issuer.pan}` });
  }

  for (const line of lines) {
    cursor.line(MARGIN.left, line.value, {
      color: line.color ?? COLORS.label,
      size: SIZE.label,
    });
  }
}

/**
 * The VAT footnote, and why it is conditional.
 *
 * A PAN-registered company that is not registered for VAT charges none, and a
 * document showing no VAT line has to say so — otherwise it reads as an
 * omission, and the customer's accountant has to ring someone to find out
 * which. When the company does register, this sentence becomes false and
 * disappears; that is the whole of the `vatRegistered` flag's job.
 */
export function drawTaxNote(cursor: Cursor, issuer: Issuer, kind: string): void {
  if (issuer.vatRegistered) {
    return;
  }

  cursor.line(
    MARGIN.left,
    `${issuer.legalName} is PAN-registered and is not registered for VAT. No VAT is`,
    { color: COLORS.accent, size: SIZE.footnote },
  );
  cursor.line(MARGIN.left, `charged on this ${kind}.`, {
    color: COLORS.accent,
    size: SIZE.footnote,
  });
}

/**
 * The foot of the page: no signature is coming, and which document this is.
 *
 * Pinned to the bottom margin rather than following the content, so a short
 * receipt and a long invoice both close in the same place. A footer that
 * floated up under a sparse document would make the page look truncated.
 *
 * The number is repeated here on purpose. It is the line that survives a page
 * photographed at an angle, a fax, or a photocopy with the header cut off — and
 * those are the states a document actually reaches a hostel's accountant in.
 */
export function drawFooter(
  cursor: Cursor,
  options: { note: string; reference: string },
): void {
  cursor.to(MARGIN.bottom + SPACE.rule);
  cursor.rule();
  cursor.to(MARGIN.bottom);

  cursor.text(MARGIN.left, options.note, {
    color: COLORS.muted,
    size: SIZE.footnote,
  });

  const width = cursor.width(options.reference, {
    font: cursor.ink.mono,
    size: SIZE.footnote,
  });

  cursor.text(PAGE.width - MARGIN.right - width, options.reference, {
    color: COLORS.muted,
    font: cursor.ink.mono,
    size: SIZE.footnote,
  });
}
