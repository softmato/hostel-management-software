import { describe, expect, it } from "vitest";

import {
  cellWidth,
  clampedFontScale,
  columnsThatFit,
  LARGE_WIDTH,
  NARROW_WIDTH,
  phoneSizeFor,
  scaledHeight,
} from "@/lib/responsive";

/**
 * The failure these exist for is a tile row that looks right on the phone it was
 * written on and breaks on someone else's: a label truncated at 320dp, or a last
 * cell wrapping onto its own line at one awkward width. So the cases pin real
 * handset widths and totals that do not divide evenly.
 */

/** Real dp widths: small Android, SE, iPhone 14, Pixel, Pro Max, split-screen. */
const HANDSET_WIDTHS = [320, 360, 375, 390, 393, 412, 414, 428, 430];

describe("phoneSizeFor", () => {
  it("calls a small handset narrow", () => {
    expect(phoneSizeFor(320)).toBe("narrow");
    expect(phoneSizeFor(NARROW_WIDTH - 1)).toBe("narrow");
  });

  it("calls the middle of the range regular", () => {
    expect(phoneSizeFor(NARROW_WIDTH)).toBe("regular");
    expect(phoneSizeFor(393)).toBe("regular");
    expect(phoneSizeFor(LARGE_WIDTH - 1)).toBe("regular");
  });

  it("calls a Pro Max width large", () => {
    expect(phoneSizeFor(LARGE_WIDTH)).toBe("large");
    expect(phoneSizeFor(430)).toBe("large");
  });

  it("falls back to narrow for an unmeasured container", () => {
    // `onLayout` has not fired yet: 0 is the width every row starts at.
    expect(phoneSizeFor(0)).toBe("narrow");
    expect(phoneSizeFor(Number.NaN)).toBe("narrow");
    expect(phoneSizeFor(-10)).toBe("narrow");
  });
});

describe("columnsThatFit", () => {
  it("drops a column on a narrow phone and keeps it on a large one", () => {
    // 72dp tiles, 12dp gaps: four fit a Pro Max content width, three do not fit 320.
    expect(columnsThatFit(390, 72, 12, 4)).toBe(4);
    expect(columnsThatFit(280, 72, 12, 4)).toBe(3);
  });

  it("never exceeds the cap, however wide the container", () => {
    expect(columnsThatFit(1280, 72, 12, 4)).toBe(4);
  });

  it("returns one column when not even a single cell fits", () => {
    // A row with no room is still a row: one cell that shrinks beats none.
    expect(columnsThatFit(50, 200, 12, 3)).toBe(1);
  });

  it("returns one column before the container is measured", () => {
    expect(columnsThatFit(0, 72, 12, 4)).toBe(1);
    expect(columnsThatFit(Number.NaN, 72, 12, 4)).toBe(1);
  });

  it("survives a zero minimum without dividing by zero", () => {
    expect(columnsThatFit(390, 0, 12, 4)).toBe(1);
  });

  it("counts the gaps, not just the cells", () => {
    // Three 100dp cells need 300 of cell plus 2 gaps of 20 = 340. At 339 only two fit.
    expect(columnsThatFit(340, 100, 20, 5)).toBe(3);
    expect(columnsThatFit(339, 100, 20, 5)).toBe(2);
  });
});

describe("cellWidth", () => {
  it("splits the row minus the gaps", () => {
    expect(cellWidth(300, 2, 12)).toBe(144);
    expect(cellWidth(300, 1, 12)).toBe(300);
  });

  it("floors rather than rounds, so the row cannot overflow", () => {
    // 301 across 3 with no gap is 100.33…; rounding up wraps the last cell.
    expect(cellWidth(301, 3, 0)).toBe(100);
    expect(cellWidth(301, 3, 0) * 3).toBeLessThanOrEqual(301);
  });

  it("keeps every column plus its gaps inside a real handset width", () => {
    for (const width of HANDSET_WIDTHS) {
      for (const columns of [1, 2, 3, 4, 5]) {
        const gap = 12;
        const cell = cellWidth(width, columns, gap);

        expect(cell * columns + gap * (columns - 1)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("reports zero before the container is measured", () => {
    expect(cellWidth(0, 3, 12)).toBe(0);
    expect(cellWidth(Number.NaN, 3, 12)).toBe(0);
  });

  it("clamps to zero when the gaps alone exceed the container", () => {
    // Five 40dp gaps in a 100dp sheet: no room, but not a negative width.
    expect(cellWidth(100, 5, 40)).toBe(0);
  });
});

describe("clampedFontScale", () => {
  it("passes the default scale through untouched", () => {
    expect(clampedFontScale(1)).toBe(1);
  });

  it("honours a moderate accessibility scale", () => {
    expect(clampedFontScale(1.15)).toBeCloseTo(1.15);
  });

  it("caps an extreme scale so fixed-height controls do not clip", () => {
    expect(clampedFontScale(2)).toBe(1.3);
    expect(clampedFontScale(3.2)).toBe(1.3);
  });

  it("never shrinks a touch target below its designed height", () => {
    expect(clampedFontScale(0.85)).toBe(1);
  });

  it("treats a missing scale as 1", () => {
    expect(clampedFontScale(Number.NaN)).toBe(1);
    expect(clampedFontScale(0)).toBe(1);
  });
});

describe("scaledHeight", () => {
  it("grows a fixed row with the text inside it", () => {
    expect(scaledHeight(56, 1)).toBe(56);
    expect(scaledHeight(56, 1.3)).toBe(73);
  });

  it("stops growing where the scale is capped", () => {
    expect(scaledHeight(56, 2)).toBe(scaledHeight(56, 1.3));
  });
});
