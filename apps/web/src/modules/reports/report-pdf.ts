import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { ReportExport } from "@/modules/reports/report-export.service";

/**
 * A report export as a PDF — the same table the CSV carries, laid out to be read
 * rather than parsed.
 *
 * ## Why both formats exist
 *
 * A CSV is for a spreadsheet and a PDF is for a person. An owner sending last
 * month's collection to their accountant wants the first; an owner handing the
 * same figures to a bank, a landlord or a family member wants the second, and
 * has until now had to open the CSV somewhere and print it. The export routes
 * therefore take a `format` and this is the other half of it.
 *
 * ## Generic, because `ReportExport` already is
 *
 * Every report — residents, collection, complaints, occupancy, and the platform's
 * four — is a `{ columns, rows }` table by the time it reaches a route. So this
 * renders *a table*, not a collection report, and all eight formats came for
 * free. A bespoke renderer per report would be eight places to keep in step with
 * one service.
 *
 * ## Not `receipt-pdf.ts`
 *
 * That module builds **financial instruments** — a receipt and a resident's
 * statement — and everything in it exists to make those documents hard to
 * forge: a certification stamp, a system-document marker, a receipt-number
 * pattern, a footer disclaiming proof-of-payment. A report is an aggregate with
 * no such standing and must not carry that furniture, or the marks stop meaning
 * anything on the documents that need them.
 */

/** A4 portrait, in points — the same page `renderStatementPdf` uses. */
const PAGE = { height: 841.89, width: 595.28 } as const;
const MARGIN = 46;
const ROW_HEIGHT = 18;
const HEADER_SIZE = 9;
const BODY_SIZE = 9;

/** Where the first row of a continuation page starts. */
const PAGE_TOP = PAGE.height - MARGIN;

/**
 * `pdf-lib`'s standard fonts are WinAnsi, which throws on anything outside it —
 * a Devanagari hostel name, an em dash, a rupee sign. Sanitising beats crashing
 * a download, and the same trade is documented in `receipt-pdf.ts`.
 */
function sanitize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value);
}

/**
 * Column x-positions, spread evenly across the usable width.
 *
 * Even rather than measured: these tables are two to six columns of short
 * values, and a measuring pass would spend a lot of work to move a column by a
 * few points. The renderer truncates instead — see `fit`.
 */
function columnPositions(count: number): number[] {
  const usable = PAGE.width - MARGIN * 2;
  const step = usable / Math.max(count, 1);

  return Array.from({ length: count }, (_, index) => MARGIN + step * index);
}

/**
 * Clips a cell to the width of its column so neighbouring text cannot collide.
 *
 * An ellipsis rather than a hard cut, so a truncated value is visibly truncated
 * — a silently shortened resident count is a wrong number on a document somebody
 * may act on.
 */
function fit(
  text: string,
  width: number,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  size: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= width) {
    return text;
  }

  let clipped = text;

  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}...`, size) > width) {
    clipped = clipped.slice(0, -1);
  }

  return `${clipped}...`;
}

export type ReportPdfInput = {
  generatedAt: Date;
  /** The hostel, or the platform. Blank when the caller spans several hostels. */
  scopeName: string;
  /** What the reader is looking at — "Collection", "Occupancy". */
  title: string;
} & Pick<ReportExport, "columns" | "rows">;

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.1, 0.12, 0.11);
  const muted = rgb(0.42, 0.45, 0.44);
  const rule = rgb(0.85, 0.87, 0.86);

  const positions = columnPositions(input.columns.length);
  const columnWidth = (PAGE.width - MARGIN * 2) / Math.max(input.columns.length, 1) - 6;

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let cursor = PAGE_TOP;

  const drawRow = (cells: string[], options: { bold?: boolean; size?: number } = {}) => {
    cells.forEach((cell, index) => {
      page.drawText(fit(sanitize(cell), columnWidth, regular, options.size ?? BODY_SIZE), {
        color: options.bold ? muted : ink,
        font: options.bold ? bold : regular,
        size: options.size ?? BODY_SIZE,
        x: positions[index] ?? MARGIN,
        y: cursor,
      });
    });
    cursor -= ROW_HEIGHT;
  };

  const drawHeader = () => {
    drawRow(
      input.columns.map((column) => column.label),
      { bold: true, size: HEADER_SIZE },
    );
    page.drawLine({
      color: rule,
      end: { x: PAGE.width - MARGIN, y: cursor + 12 },
      start: { x: MARGIN, y: cursor + 12 },
      thickness: 1,
    });
    cursor -= 6;
  };

  /* ---- Title block, on the first page only ---- */
  page.drawText(sanitize(input.title), {
    color: ink,
    font: bold,
    size: 18,
    x: MARGIN,
    y: cursor,
  });
  cursor -= 22;

  if (input.scopeName) {
    page.drawText(sanitize(input.scopeName), {
      color: muted,
      font: regular,
      size: 11,
      x: MARGIN,
      y: cursor,
    });
    cursor -= 16;
  }

  page.drawText(`Generated ${input.generatedAt.toISOString().slice(0, 10)}`, {
    color: muted,
    font: regular,
    size: 9,
    x: MARGIN,
    y: cursor,
  });
  cursor -= 26;

  drawHeader();

  /* ---- Rows, paginated ---- */
  if (input.rows.length === 0) {
    page.drawText("Nothing to report for this period.", {
      color: muted,
      font: regular,
      size: 11,
      x: MARGIN,
      y: cursor,
    });
  }

  for (const row of input.rows) {
    /*
     * Paginated, unlike `renderStatementPdf`, which truncates at 28 rows. A
     * resident's statement is a stay measured in months and fits a page; a
     * hostel's collection report is capped at 5000 rows by the service, and
     * dropping 4900 of them onto the floor would be a document that looks
     * complete and is not.
     */
    if (cursor < MARGIN + ROW_HEIGHT) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      cursor = PAGE_TOP;
      drawHeader();
    }

    drawRow(input.columns.map((column) => cellText(row[column.key])));
  }

  return pdf.save();
}
