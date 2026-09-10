import type { PDFFont, PDFPage, RGB } from "pdf-lib";

import { COLORS, MARGIN, PAGE, SIZE, SPACE, TRACKING } from "./theme";

/**
 * A cursor over a PDF page, so the documents can be written top-down.
 *
 * `pdf-lib` positions everything from the **bottom-left** in absolute points.
 * That is the right primitive and the wrong unit of thought: a document is
 * composed downwards, each block sitting under the one before it, and writing
 * that as forty hand-computed `y` values means every inserted line renumbers
 * the rest of the page. Two documents share this layout, so it would mean
 * renumbering both.
 *
 * So this holds a `y` that only ever decreases, and every method advances it by
 * what it drew. A block moves by moving its call.
 *
 * ## It does not paginate, and that is a decision
 *
 * Both documents are one page by construction: a subscription invoice has one
 * line, and a receipt has one payment. There is no case where either overflows
 * that a second page would fix — an invoice with a hundred lines would be a
 * different document with a different design. So a block that would run past
 * the bottom margin is clipped by `remaining()` at the call site rather than
 * silently flowing onto a page nobody expects. The one variable-length block on
 * either document, the plan's feature list, is capped by
 * `buildPresentation()` long before it reaches here.
 */

export type Ink = {
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
  regular: PDFFont;
};

export type TextOptions = {
  color?: RGB;
  font?: PDFFont;
  size?: number;
  /** Extra points between glyphs. Costs one draw call per character. */
  tracking?: number;
};

export class Cursor {
  private y: number;

  constructor(
    readonly page: PDFPage,
    readonly ink: Ink,
  ) {
    this.y = PAGE.height - MARGIN.top;
  }

  /** Where the next block will start. */
  get top(): number {
    return this.y;
  }

  /** Points left before the bottom margin. */
  remaining(): number {
    return this.y - MARGIN.bottom;
  }

  down(points: number): this {
    this.y -= points;

    return this;
  }

  /** Puts the cursor back, for a block drawn beside one already placed. */
  to(y: number): this {
    this.y = y;

    return this;
  }

  /* ── Measuring ──────────────────────────────────────────────────────── */

  width(text: string, options: TextOptions = {}): number {
    const font = options.font ?? this.ink.regular;
    const size = options.size ?? SIZE.body;
    const base = font.widthOfTextAtSize(text, size);

    // Tracking adds a gap *after* every glyph but the last, so a tracked string
    // is wider than the font thinks. Right-aligning without this is how a
    // tracked title ends up hanging past the margin.
    return options.tracking
      ? base + options.tracking * Math.max(0, text.length - 1)
      : base;
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  /**
   * One run of text at an absolute `x`, on the current line. Does not advance.
   *
   * Returns the width drawn, so a caller placing something after it — a
   * Gregorian date in brackets after a Nepali one — does not measure twice.
   */
  text(x: string | number, value: string, options: TextOptions = {}): number {
    const font = options.font ?? this.ink.regular;
    const size = options.size ?? SIZE.body;
    const color = options.color ?? COLORS.text;
    const left = typeof x === "number" ? x : this.resolveX(x, value, options);

    if (!options.tracking) {
      this.page.drawText(value, { color, font, size, x: left, y: this.y });

      return this.width(value, options);
    }

    let pen = left;

    for (const glyph of value) {
      this.page.drawText(glyph, { color, font, size, x: pen, y: this.y });
      pen += font.widthOfTextAtSize(glyph, size) + options.tracking;
    }

    return pen - left - options.tracking;
  }

  /** `"right"` and `"center"` as x, resolved against the content box. */
  private resolveX(
    anchor: string,
    value: string,
    options: TextOptions,
  ): number {
    const width = this.width(value, options);

    if (anchor === "right") {
      return PAGE.width - MARGIN.right - width;
    }

    return (PAGE.width - width) / 2;
  }

  /** A text run, then down one line. */
  line(x: string | number, value: string, options: TextOptions = {}): this {
    this.text(x, value, options);

    return this.down((options.size ?? SIZE.body) + 4.5);
  }

  /**
   * `Receipt No.` on the left, `TXN-2083/84-00000008` on the right.
   *
   * The shape both documents are mostly made of: a muted field name against
   * the left margin and its value hard against the right one, with the whole
   * width between them rather than a colon. Values default to mono because
   * nearly every one of them is a figure or an identifier — the callers that
   * pass prose override it.
   */
  field(
    label: string,
    value: string,
    options: {
      /** Indents the pair — the invoice's meta block sits in a right column. */
      labelX?: number;
      suffix?: string;
      valueColor?: RGB;
      valueFont?: PDFFont;
    } = {},
  ): this {
    this.text(options.labelX ?? MARGIN.left, label, {
      color: COLORS.label,
      size: SIZE.label,
    });

    const font = options.valueFont ?? this.ink.mono;
    const color = options.valueColor ?? COLORS.text;
    const suffix = options.suffix ?? "";
    const valueWidth = this.width(value, { font, size: SIZE.body });
    const suffixWidth = suffix
      ? this.width(` ${suffix}`, { size: SIZE.footnote })
      : 0;
    const start = PAGE.width - MARGIN.right - valueWidth - suffixWidth;

    this.text(start, value, { color, font, size: SIZE.body });

    if (suffix) {
      this.text(start + valueWidth, ` ${suffix}`, {
        color: COLORS.muted,
        size: SIZE.footnote,
      });
    }

    return this.down(SPACE.line);
  }

  /** `RECEIVED FROM` — a tracked, muted, capitalised section marker. */
  eyebrow(x: string | number, value: string): this {
    this.text(x, value.toUpperCase(), {
      color: COLORS.label,
      size: SIZE.eyebrow,
      tracking: TRACKING.eyebrow,
    });

    return this.down(SPACE.tight);
  }

  /** `I N V O I C E`. */
  title(x: string | number, value: string): this {
    this.text(x, value.toUpperCase(), {
      font: this.ink.regular,
      size: SIZE.title,
      tracking: TRACKING.title,
    });

    return this.down(SIZE.title + 6);
  }

  rule(options: { color?: RGB; thickness?: number; width?: number } = {}): this {
    const width = options.width ?? PAGE.width - MARGIN.left - MARGIN.right;

    this.page.drawLine({
      color: options.color ?? COLORS.rule,
      end: { x: MARGIN.left + width, y: this.y },
      start: { x: MARGIN.left, y: this.y },
      thickness: options.thickness ?? 0.6,
    });

    return this.down(SPACE.rule);
  }

  /** The heavy line under the masthead. */
  ruleStrong(): this {
    return this.rule({ color: COLORS.ruleStrong, thickness: 1.1 });
  }

  /**
   * A bordered stamp — `PAID IN FULL`, `UNPAID`.
   *
   * An outline rather than a filled badge. Filled reads as a button on a
   * screen, and this is paper: the border is what a rubber stamp leaves.
   * Drawn from a top-left corner and a width, because that is where the
   * caller knows the box goes.
   */
  stamp(
    value: string,
    options: { color?: RGB; right?: number; top?: number; width?: number } = {},
  ): { height: number; width: number } {
    const color = options.color ?? COLORS.accent;
    const size = SIZE.label;
    const label = value.toUpperCase();
    const textWidth = this.width(label, {
      font: this.ink.mono,
      size,
      tracking: TRACKING.eyebrow,
    });
    const width = options.width ?? textWidth + 34;
    const height = 30;
    const top = options.top ?? this.y;
    const right = options.right ?? PAGE.width - MARGIN.right;

    this.page.drawRectangle({
      borderColor: color,
      borderWidth: 0.9,
      height,
      width,
      x: right - width,
      y: top - height,
      // pdf-lib fills black unless told otherwise; an unset opacity would
      // paint a solid rectangle over the label about to be drawn in it.
      opacity: 0,
    });

    const saved = this.y;

    this.to(top - height + (height - size) / 2 + 1.5);
    this.text(right - width + (width - textWidth) / 2, label, {
      color,
      font: this.ink.mono,
      size,
      tracking: TRACKING.eyebrow,
    });
    this.to(saved);

    return { height, width };
  }
}
