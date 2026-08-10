import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

export type ReceiptPdfInput = {
  amount: number;
  hostelName: string;
  invoicePeriod?: string | null;
  issuedAt: Date;
  method?: string | null;
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

  write("Computer-generated receipt. No signature required.", {
    color: muted,
    size: 9,
    y: 56,
  });

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

  page.drawText("Computer-generated statement. No signature required.", {
    color: muted,
    font: regular,
    size: 9,
    x: margin,
    y: 56,
  });

  return pdf.save();
}
