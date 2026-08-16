import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFDocument as PDFDocumentType } from "pdf-lib";

import { formatNPR } from "@/modules/finance/money";

/**
 * Renders a receipt as a PDF (target §4.4, current §7.12).
 *
 * The resident's "Download Statement" button has had no handler since it was
 * built: there is no PDF, no printable view and no download anywhere in the
 * product, so a resident who needs proof of rent for a visa, a loan or a
 * landlord has nothing to show. This is the smallest honest fix — one page, the
 * facts, nothing decorative.
 *
 * `pdf-lib` rather than a headless browser: pure JavaScript, no native build, no
 * Chromium in a serverless function (§10.1 decision 5). Standard PDF fonts only,
 * which is also why every value is rendered through {@link sanitize} — WinAnsi
 * cannot encode Devanagari, and an unencodable character throws mid-render
 * rather than dropping a glyph.
 */

/**
 * The token stamped into every PDF this module produces (plan item 3.4 follow-on).
 *
 * A receipt is a document *we* issue saying the hostel received money. It is not
 * a resident's evidence that they paid — and yet it looks exactly like the sort
 * of file a payment proof is, so it was accepted as one: a resident could
 * download September's receipt and submit it as proof for August, and every
 * check went green.
 *
 * Stamping the file is what makes that detectable at all. A content hash cannot
 * do it — each render is a fresh document for a different month — and asking a
 * reviewer to notice is asking them to recognise their own template in a
 * thumbnail.
 *
 * Written into the PDF's **metadata**, and read back by parsing rather than by
 * scanning the raw bytes. Scanning does not work and it is worth recording why,
 * because the byte-scan version looks obviously correct: pdf-lib packs the Info
 * dictionary into a Flate-compressed object stream, and encodes metadata strings
 * as hex-wrapped UTF-16BE even with `useObjectStreams: false`. The marker is
 * never present as readable ASCII in the file.
 *
 * The token is deliberately distinctive enough that it cannot appear in a bank's
 * own receipt by accident.
 */
export const SYSTEM_DOCUMENT_MARKER = "HOSTELDAYS-SYSTEM-DOCUMENT";

/**
 * The **printed** marker, for the case the metadata one cannot reach.
 *
 * The metadata stamp survives a download and a re-save. It does not survive a
 * *screenshot* — and a screenshot of the receipt is precisely the file a resident
 * uploads, because it is what their phone gives them when they tap the PDF. The
 * marker is gone, the receipt looks like a payment record by every OCR signal it
 * has (provider name, currency, an amount, a date), and it carries this invoice's
 * reference code because we printed it there ourselves. That is the strongest
 * corroboration in the system, and it went green on our own document.
 *
 * So the same fact is also stated in ink, in two independent forms:
 *
 * - {@link RECEIPT_NUMBER_PATTERN} — the receipt number's own shape. Distinctive
 *   because we mint it: `RCP`, a hostel prefix, a period and a sequence. Nothing
 *   a bank prints looks like this.
 * - {@link SYSTEM_DOCUMENT_FOOTER} — the sentence at the foot of every page,
 *   matched loosely enough to survive a recogniser losing a word.
 *
 * Either one is enough. Both are checked against OCR'd text, so a hit is not
 * certain the way the metadata read is — which is why the caller uses it to
 * *refuse the claim*, with copy that assumes an honest mistake, rather than to
 * flag anything as fraud.
 */
export const RECEIPT_NUMBER_PATTERN = /\bRCP[-\s]?[A-Z]{3}[-\s]?\d{4}[-\s]?\d{2}[-\s]?\d{5}\b/i;

/** The footer sentence, minus the wording a recogniser is likely to mangle. */
export const SYSTEM_DOCUMENT_FOOTER = /not\s+a\s+proof[-\s]?of[-\s]?payment\s+upload/i;

/**
 * The qualifier a provisional receipt carries (item E.7).
 *
 * Exported so the tests and the screens quote the same sentence — a receipt that
 * hedges in the PDF and not in the app has told the resident two things.
 */
export const SUBJECT_TO_CONFIRMATION =
  "Subject to confirmation against our account statement.";

/** Printed on every page, and half of why {@link SYSTEM_DOCUMENT_FOOTER} matches. */
function footerLine(kind: "receipt" | "statement"): string {
  return `Computer-generated ${kind} issued by the hostel. Not a proof-of-payment upload.`;
}

/** What kind of document the marker was found in. */
export type SystemDocumentKind = "RECEIPT" | "STATEMENT";

/** The metadata fields the marker is written to, and read back from. */
export const SYSTEM_DOCUMENT_FIELDS = ["Subject", "Creator", "Keywords"] as const;

function stampSystemDocument(pdf: PDFDocumentType, kind: SystemDocumentKind) {
  const stamp = `${SYSTEM_DOCUMENT_MARKER}-${kind}`;

  // Three fields rather than one: any single survivor is enough, and a resident
  // re-exporting the file through another PDF tool may drop some of them.
  //
  // **Not `Producer`** — pdf-lib overwrites that with its own name on every
  // save, so a marker written there is gone by the time the file exists.
  pdf.setSubject(stamp);
  pdf.setCreator(stamp);
  pdf.setKeywords([stamp]);
}

export type ReceiptPdfInput = {
  amount: number;
  /**
   * What the money buys, as dates rather than a month string.
   *
   * `2026-08` is unambiguous to us and not to a landlord, a visa officer or a
   * bank — the three readers a receipt is actually produced for. They ask "paid
   * for which dates", and a receipt that answers "2026-08" makes them ask again.
   *
   * Optional because not every invoice covers a span: an admission fee or a
   * deposit buys no period at all, and inventing one for it would be a worse
   * answer than omitting the line.
   */
  coversFrom?: Date | null;
  coversTo?: Date | null;
  hostelName: string;
  invoicePeriod?: string | null;
  issuedAt: Date;
  method?: string | null;
  /**
   * True while the money is credited on a human's judgement alone (item E.7).
   *
   * **Provisional credit, printed as such — the way a card network does it.** A
   * warden approves a screenshot and the resident is paid up that instant, which
   * is right: statements lag by days and holding an honest resident hostage to
   * that lag is a worse product than the fraud it guards against. But the
   * document handed over says the hostel *received* the money, and until the
   * hostel's own account statement carries the credit, nobody has established
   * that. One line is the difference between a receipt that overstates what is
   * known and one that does not, and it costs the honest resident nothing —
   * their receipt stops hedging as soon as the statement lands.
   */
  provisional?: boolean;
  receiptNumber: string;
  referenceCode?: string | null;
  residentName: string;
  voidReason?: string | null;
  voidedAt?: Date | null;
};

/**
 * Standard-font PDFs are WinAnsi-encoded, and a hostel or resident name in
 * Devanagari — which this product has plenty of — would throw when drawn.
 * Unencodable characters become `?` so the receipt still renders; the name is
 * degraded, but a receipt that exists beats an exception on download.
 */
function sanitize(text: string): string {
  return text.replace(/[^ -~]/g, "?");
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `01 Aug 2026` — for the coverage window only.
 *
 * Spelled rather than numeric because the coverage line is the one a human reads
 * aloud, and `08/09/2026` is two different days depending on which side of the
 * world the reader learned to write dates on. Everything else on the page stays
 * ISO, which is unambiguous for exactly the opposite reason.
 */
function formatLongDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * The certification stamp (target §4.4).
 *
 * A drawn mark rather than an image: an embedded PNG would have to be a build
 * asset, and the point of the stamp is that it is *ours* — a resident's own
 * screenshot of a bank app can carry any logo, but nothing outside this function
 * draws this box with this receipt number in it.
 *
 * It is also the most legible part of the document to a person holding a printout
 * and asking whether it is genuine, which is the question the whole receipt
 * exists to answer.
 */
function drawCertificationStamp(
  page: ReturnType<PDFDocumentType["addPage"]>,
  fonts: { bold: Awaited<ReturnType<PDFDocumentType["embedFont"]>>; regular: Awaited<ReturnType<PDFDocumentType["embedFont"]>> },
  receiptNumber: string,
  y: number,
  provisional = false,
) {
  // Amber rather than green while the credit is provisional. The stamp is the
  // most legible thing on the page to someone deciding whether the document is
  // genuine, and a green CERTIFIED over money nothing independent has confirmed
  // is the one place this renderer could mislead at a glance.
  const accent = provisional ? rgb(0.6, 0.4, 0.04) : rgb(0.09, 0.42, 0.29);
  const width = 236;
  const height = 76;
  const x = 595.28 - 56 - width;

  page.drawRectangle({
    borderColor: accent,
    borderWidth: 1.6,
    color: rgb(0.96, 0.98, 0.97),
    height,
    width,
    x,
    y: y - height,
  });

  page.drawText(provisional ? "PROVISIONAL" : "CERTIFIED", {
    color: accent,
    font: fonts.bold,
    size: 15,
    x: x + 16,
    y: y - 26,
  });
  page.drawText(sanitize(OFFER_PROGRAM_TITLE.toUpperCase()), {
    color: accent,
    font: fonts.bold,
    size: 10,
    x: x + 16,
    y: y - 44,
  });
  // The number is inside the stamp as well as in the table above it. A stamp
  // that does not name the document it certifies certifies every document.
  page.drawText(sanitize(receiptNumber), {
    color: rgb(0.42, 0.45, 0.44),
    font: fonts.regular,
    size: 8,
    x: x + 16,
    y: y - 62,
  });
}

/**
 * The programme name, duplicated from the resident-facing module on purpose.
 *
 * `resident-offer-program.tsx` is a client component, and importing it here would
 * drag React into a PDF renderer that runs in a route handler. The name is a
 * three-word string that changes approximately never; the coupling would be
 * permanent.
 */
export const OFFER_PROGRAM_TITLE = "Resident Offer Program";

export async function renderReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4, points.
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.11);
  const muted = rgb(0.42, 0.45, 0.44);
  const margin = 56;
  let cursor = 785;

  const write = (
    text: string,
    options: { bold?: boolean; color?: typeof ink; size?: number; y?: number } = {},
  ) => {
    page.drawText(sanitize(text), {
      color: options.color ?? ink,
      font: options.bold ? bold : regular,
      size: options.size ?? 11,
      x: margin,
      y: options.y ?? cursor,
    });
  };

  write(input.hostelName, { bold: true, size: 18 });
  cursor -= 22;
  write("Payment receipt", { color: muted, size: 12 });
  cursor -= 34;

  page.drawLine({
    color: rgb(0.85, 0.87, 0.86),
    end: { x: 595.28 - margin, y: cursor },
    start: { x: margin, y: cursor },
    thickness: 1,
  });
  cursor -= 30;

  const rows: [string, string][] = [
    ["Receipt number", input.receiptNumber],
    ["Issued", formatDate(input.issuedAt)],
    ["Resident", input.residentName],
    ["Amount", formatNPR(input.amount)],
  ];

  if (input.invoicePeriod) {
    rows.push(["Period", input.invoicePeriod]);
  }

  // Stated as two labelled dates rather than one range string, so a reader
  // scanning for "until when am I paid up" finds a line with that label on it.
  if (input.coversFrom && input.coversTo) {
    rows.push(["Covers from", formatLongDate(input.coversFrom)]);
    rows.push(["Covers until", formatLongDate(input.coversTo)]);
  }

  if (input.referenceCode) {
    rows.push(["Reference", input.referenceCode]);
  }

  if (input.method) {
    rows.push(["Method", input.method]);
  }

  for (const [label, value] of rows) {
    write(label, { color: muted });
    page.drawText(sanitize(value), {
      color: ink,
      font: label === "Amount" ? bold : regular,
      size: label === "Amount" ? 13 : 11,
      x: margin + 150,
      y: cursor,
    });
    cursor -= 22;
  }

  // Under the table and above the stamp, so a reader who takes in only the
  // certified box and the amount cannot miss it. Not printed on a voided
  // receipt: "void" already answers the question this line qualifies.
  if (input.provisional && !input.voidedAt) {
    cursor -= 8;
    write("Provisional", { bold: true, color: rgb(0.72, 0.45, 0.05), size: 12 });
    cursor -= 16;
    write(SUBJECT_TO_CONFIRMATION, { color: muted, size: 9 });
    cursor -= 6;
  }

  // A voided receipt still renders — a resident holding one is exactly who needs
  // to be told it no longer stands, and refusing to render it would leave them
  // with a document and no way to learn its status.
  if (input.voidedAt) {
    cursor -= 18;
    write("VOID", { bold: true, color: rgb(0.7, 0.15, 0.15), size: 16 });
    cursor -= 18;
    write(
      `Voided ${formatDate(input.voidedAt)}${input.voidReason ? ` — ${input.voidReason}` : ""}`,
      { color: muted },
    );
  }

  // Below the table, never over it: a stamp that overlaps the amount is the one
  // thing on this page nobody may have to squint at. A voided receipt gets no
  // stamp at all — certifying a document that has been withdrawn is the single
  // most misleading thing this renderer could do.
  if (!input.voidedAt) {
    drawCertificationStamp(
      page,
      { bold, regular },
      input.receiptNumber,
      cursor - 24,
      input.provisional,
    );
  }

  write(footerLine("receipt"), { color: muted, size: 9, y: 56 });

  stampSystemDocument(pdf, "RECEIPT");

  return pdf.save();
}

export type StatementRow = {
  dueAmount: number;
  paidAmount: number;
  period: string;
  status: string;
};

export type StatementPdfInput = {
  generatedAt: Date;
  hostelName: string;
  residentName: string;
  rows: StatementRow[];
};

/**
 * The resident's payment history as a PDF — what the "Download Statement" button
 * has been promising since it was built (current §7.12).
 *
 * A statement is not a receipt: it is the whole account, including what is still
 * owed, which is the thing a resident is usually asked to produce. Both live in
 * this module because they share the font handling and the WinAnsi constraint.
 *
 * Rows are rendered newest first and the page is not paginated — a hostel stay
 * is measured in months, so one page holds a realistic history. A stay long
 * enough to overflow gets truncated with a line saying so, rather than silently
 * losing the oldest months.
 */
const MAX_STATEMENT_ROWS = 28;

export async function renderStatementPdf(
  input: StatementPdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.11);
  const muted = rgb(0.42, 0.45, 0.44);
  const margin = 56;
  const columns = [margin, margin + 150, margin + 270, margin + 390];
  let cursor = 785;

  const row = (
    cells: string[],
    options: { bold?: boolean; color?: typeof ink; size?: number } = {},
  ) => {
    cells.forEach((cell, index) => {
      page.drawText(sanitize(cell), {
        color: options.color ?? ink,
        font: options.bold ? bold : regular,
        size: options.size ?? 11,
        x: columns[index] ?? margin,
        y: cursor,
      });
    });
    cursor -= 20;
  };

  page.drawText(sanitize(input.hostelName), {
    color: ink,
    font: bold,
    size: 18,
    x: margin,
    y: cursor,
  });
  cursor -= 22;
  page.drawText(sanitize(`Statement for ${input.residentName}`), {
    color: muted,
    font: regular,
    size: 12,
    x: margin,
    y: cursor,
  });
  cursor -= 16;
  page.drawText(`Generated ${formatDate(input.generatedAt)}`, {
    color: muted,
    font: regular,
    size: 10,
    x: margin,
    y: cursor,
  });
  cursor -= 30;

  row(["Period", "Billed", "Paid", "Status"], { bold: true, color: muted, size: 10 });

  page.drawLine({
    color: rgb(0.85, 0.87, 0.86),
    end: { x: 595.28 - margin, y: cursor + 12 },
    start: { x: margin, y: cursor + 12 },
    thickness: 1,
  });
  cursor -= 6;

  const shown = input.rows.slice(0, MAX_STATEMENT_ROWS);

  for (const entry of shown) {
    row([
      entry.period,
      formatNPR(entry.dueAmount),
      formatNPR(entry.paidAmount),
      entry.status,
    ]);
  }

  if (input.rows.length > shown.length) {
    row([`… ${input.rows.length - shown.length} earlier periods not shown`], {
      color: muted,
      size: 9,
    });
  }

  const billed = input.rows.reduce((sum, entry) => sum + entry.dueAmount, 0);
  const paid = input.rows.reduce((sum, entry) => sum + entry.paidAmount, 0);

  cursor -= 10;
  page.drawLine({
    color: rgb(0.85, 0.87, 0.86),
    end: { x: 595.28 - margin, y: cursor + 12 },
    start: { x: margin, y: cursor + 12 },
    thickness: 1,
  });
  cursor -= 8;

  row(["Total", formatNPR(billed), formatNPR(paid), ""], { bold: true });
  // Outstanding is stated rather than left to the reader's arithmetic: it is the
  // number the statement is usually produced to answer.
  row([`Outstanding: ${formatNPR(Math.max(billed - paid, 0))}`], { bold: true });

  page.drawText(footerLine("statement"), {
    color: muted,
    font: regular,
    size: 9,
    x: margin,
    y: 56,
  });

  stampSystemDocument(pdf, "STATEMENT");

  return pdf.save();
}
