/**
 * The cardholder signature as data — the twin of `apps/web/src/lib/signature.ts`.
 *
 * `M x y L x y … M x y …` in whole units of a fixed 600×200 box. The phone pad,
 * the web pad and the card painter all use this format, so a signature drawn
 * here prints the same on the emailed card. Keep the two files in step.
 */

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;

/** The server's floor — fewer points than this is a tap, not a signature. */
export const SIGNATURE_MIN_POINTS = 8;

export type SignatureStroke = [number, number][];

export function signatureStrokes(value: string | null | undefined): SignatureStroke[] {
  const strokes: SignatureStroke[] = [];

  for (const match of (value ?? "").matchAll(/([ML])(\d+) (\d+)/g)) {
    const point: [number, number] = [Number(match[2]), Number(match[3])];

    if (match[1] === "M" || strokes.length === 0) {
      strokes.push([point]);
    } else {
      strokes[strokes.length - 1]!.push(point);
    }
  }

  return strokes;
}

export function serializeSignature(strokes: SignatureStroke[]): string {
  const clamp = (value: number, max: number) =>
    Math.min(max, Math.max(0, Math.round(value)));

  return strokes
    .filter((stroke) => stroke.length > 0)
    .map((stroke) =>
      stroke
        .map(
          ([x, y], index) =>
            `${index === 0 ? "M" : "L"}${clamp(x, SIGNATURE_WIDTH)} ${clamp(y, SIGNATURE_HEIGHT)}`,
        )
        .join(""),
    )
    .join("");
}

export function isSignatureComplete(value: string | null | undefined): boolean {
  return signatureStrokes(value).flat().length >= SIGNATURE_MIN_POINTS;
}
