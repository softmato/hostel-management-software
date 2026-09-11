import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Registers Inter with `@napi-rs/canvas` so the emailed ID card has text on it.
 *
 * This exists because of a bug that is invisible everywhere except production.
 * The card painter asks for `"Inter", "Segoe UI", system-ui, …`. A browser has
 * those. A Windows dev box has Segoe UI. A Vercel lambda has **no fonts at
 * all** — and `fillText` against an unresolvable family does not throw, it
 * draws nothing. So shapes rendered, every glyph vanished, the `catch` in
 * `renderIdCardPng` never ran, and residents were emailed a 40 KB PNG of a
 * header curve, some dots and a dashed line.
 *
 * The fix is to ship the font and register it before the first draw, and then
 * to *stop falling back* on the server (see `setIdCardFontStack`): a fallback
 * is what let a Windows machine paint a correct card from a broken config.
 *
 * The four static weights are the ones the painter actually asks for — 500,
 * 600, 700, 800. A variable TTF would be one file, but weight selection across
 * an alias is a matching detail of the native font database rather than
 * something this code controls, and four faces with real `usWeightClass`
 * metadata leaves nothing to infer.
 */

/** Family name the painter asks for, and the alias every face registers under. */
export const ID_CARD_FONT_FAMILY = "Inter";

/**
 * Server-side font stack: Inter and nothing else.
 *
 * No fallback on purpose. If registration ever breaks again the render must
 * fail loudly at the `GlobalFonts.has` check rather than quietly succeeding on
 * whatever the host happens to have installed.
 */
export const ID_CARD_SERVER_FONT_STACK = `"${ID_CARD_FONT_FAMILY}"`;

const FONT_FILES = [
  "Inter-Medium.ttf",
  "Inter-SemiBold.ttf",
  "Inter-Bold.ttf",
  "Inter-ExtraBold.ttf",
];

/**
 * Where the `.ttf` files sit once they are on disk.
 *
 * Built from segments rather than written as one literal so `@vercel/nft` reads
 * it as an opaque string join instead of a directory to sweep — the same
 * heuristic that once copied `public/` into 426 functions. The files reach the
 * lambda through `outputFileTracingIncludes` in `next.config.ts`, not through
 * the tracer guessing.
 */
const FONT_DIR_SEGMENTS = ["src", "lib", "fonts"];

function candidateFontDirs(): string[] {
  const cwd = process.cwd();
  const relative = path.join(...FONT_DIR_SEGMENTS);

  return [
    // `next dev`, `next build` and a Vercel function all run with cwd at apps/web.
    path.join(cwd, relative),
    // vitest and the repo-root scripts run a level up.
    path.join(cwd, "apps", "web", relative),
  ];
}

let registered: boolean | null = null;

/**
 * Registers the bundled faces once per process.
 *
 * Returns `false` if the files are missing or the native font database refused
 * them, which is the signal `renderIdCardPng` uses to send no attachment rather
 * than a blank one.
 */
export async function ensureIdCardFonts(): Promise<boolean> {
  if (registered !== null) {
    return registered;
  }

  try {
    const { GlobalFonts } = await import("@napi-rs/canvas");

    const dir = candidateFontDirs().find((candidate) =>
      existsSync(path.join(candidate, FONT_FILES[0])),
    );

    if (!dir) {
      registered = false;

      return registered;
    }

    for (const file of FONT_FILES) {
      GlobalFonts.registerFromPath(path.join(dir, file), ID_CARD_FONT_FAMILY);
    }

    registered = GlobalFonts.has(ID_CARD_FONT_FAMILY);
  } catch {
    registered = false;
  }

  return registered;
}

/**
 * Test seam: forget the memoised result so a test can register twice.
 *
 * Note that this cannot un-poison a font lookup. `@napi-rs/canvas` caches the
 * resolution of a font *string*, so `500 30px "Inter"` measured before the
 * faces are registered keeps resolving to the host fallback for the life of the
 * process even after they are. Registration therefore has to happen before the
 * first draw, which is why `renderIdCardPng` calls it as its first statement
 * rather than beside the other setup.
 */
export function resetIdCardFontsForTest() {
  registered = null;
}
