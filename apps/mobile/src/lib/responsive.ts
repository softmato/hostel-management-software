/**
 * Making a layout fit the handset it is actually running on.
 *
 * This is **not** web responsive design. There are no desktop breakpoints and
 * nothing here turns into a sidebar — every screen in this app is one thumb-wide
 * column. What it solves is the narrower problem that keeps breaking real
 * phones:
 *
 * - A 320dp phone (Galaxy A-series, an old SE, and anything in Android's
 *   split-screen) is **28% narrower** than a 430dp Pro Max. A row of four tiles
 *   sized for the large one truncates its labels on the small one; sized for the
 *   small one it leaves a hole on the large one.
 * - Users set the system font scale. At 1.3× a label that fit exactly now wraps
 *   or clips, because the *box* did not grow with the glyphs.
 * - Cells whose widths are computed by division overflow by a fraction of a
 *   pixel and wrap the last one onto its own row — a bug that reproduces on one
 *   screen width and nowhere else.
 *
 * So the numbers come from the width a component was **measured** at, not from
 * the device: the same tile row inside a bottom sheet, a card and a full screen
 * each gets the count that fits where it actually is.
 *
 * ## Kept free of React Native on purpose
 *
 * The arithmetic is the part that goes wrong, and `vitest` runs node-side with
 * no RN shim. The maths lives here; `components/ui/layout.tsx` only supplies the
 * measured width.
 */

/** Below this a phone is narrow enough to drop a column. */
export const NARROW_WIDTH = 360;

/** Large handsets — Pro Max, Ultra, and most foldables unfolded. */
export const LARGE_WIDTH = 414;

export type PhoneSize = "large" | "narrow" | "regular";

/**
 * Widths are dp, so these mean the same thing on every screen density.
 *
 * An unmeasured container reports `0` before its first `onLayout`; that resolves
 * to `narrow`, which is the layout that fits everywhere.
 */
export function phoneSizeFor(width: number): PhoneSize {
  if (!Number.isFinite(width) || width < NARROW_WIDTH) {
    return "narrow";
  }

  return width >= LARGE_WIDTH ? "large" : "regular";
}

/**
 * How many columns of at least `minCellWidth` fit in the measured width.
 *
 * This is the honest direction to compute a grid in: a tile has a width below
 * which its label truncates, so the count follows from the space available
 * rather than from a guess about the device. Four 72dp actions fit a 430dp
 * phone and three fit a 320dp one, and neither ever shows a clipped word.
 *
 * `max` caps it so a wide container does not spread five items into one thin
 * line; the result is always at least 1, because a grid with zero columns
 * renders nothing.
 */
export function columnsThatFit(
  containerWidth: number,
  minCellWidth: number,
  gap: number,
  max: number,
): number {
  const ceiling = Math.max(1, Math.floor(max));

  if (!Number.isFinite(containerWidth) || containerWidth <= 0 || minCellWidth <= 0) {
    return 1;
  }

  // n cells need n*min + (n-1)*gap, so n = (width + gap) / (min + gap).
  const fitting = Math.floor((containerWidth + gap) / (minCellWidth + gap));

  return Math.min(ceiling, Math.max(1, fitting));
}

/**
 * The width of one cell in an `n`-column row that uses `gap` between columns.
 *
 * **Floored, not rounded.** React Native's flex-wrap compares against the
 * container's own float width, so three cells of `100.34` in a `301`-wide row
 * overflow by a hundredth of a pixel and the third wraps to its own line. That
 * reproduces on exactly one screen width and looks like a styling bug. Flooring
 * spends at most `columns - 1` pixels of trailing space to make it impossible.
 *
 * Returns `0` before the container has been measured, which callers use to hold
 * the render back for a frame rather than draw a zero-width row.
 */
export function cellWidth(containerWidth: number, columns: number, gap: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return 0;
  }

  const safeColumns = Math.max(1, Math.floor(columns));
  const total = containerWidth - gap * (safeColumns - 1);

  return Math.max(0, Math.floor(total / safeColumns));
}

/**
 * The system font scale, clamped to a range a fixed-height control survives.
 *
 * Android's accessibility settings reach 2.0× and iOS's go past it. A 56dp row
 * with 2× text does not grow — the text clips inside it, which is worse for the
 * person who asked for large text than slightly-smaller text would be. Capping
 * at 1.3 keeps every fixed-height control legible while still honouring most of
 * the request; screens whose height is free of constraints should not clamp at
 * all and just let the text grow.
 *
 * The floor exists because a scale below 1 is a *shrink* setting, and shrinking
 * a 48dp touch target below the platform minimum is never what it meant.
 */
export function clampedFontScale(fontScale: number, max = 1.3): number {
  if (!Number.isFinite(fontScale) || fontScale <= 0) {
    return 1;
  }

  return Math.min(Math.max(fontScale, 1), max);
}

/**
 * A fixed-height control's height, grown by the clamped font scale.
 *
 * Used for anything whose height is written as a number rather than left to the
 * content: without it, a 56dp row at 1.3× text holds 1.3× glyphs in a 1.0× box.
 */
export function scaledHeight(base: number, fontScale: number, max = 1.3): number {
  return Math.round(base * clampedFontScale(fontScale, max));
}
