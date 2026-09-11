/**
 * The cardholder signature, as vector strokes: `M x y L x y … M x y …` in whole
 * units of a fixed {@link SIGNATURE_WIDTH}×{@link SIGNATURE_HEIGHT} box. The web
 * pad, the phone pad and the card painter all speak this one format, so a
 * signature drawn on a phone prints the same on the emailed PNG.
 *
 * Pure — imported by the zod schema, the canvas painter and the pad alike.
 * `apps/mobile/src/lib/signature.ts` is its twin; keep the two in step.
 */

export const SIGNATURE_WIDTH = 600;
export const SIGNATURE_HEIGHT = 200;
/** The server's floor — fewer points than this is a tap, not a signature. */
export const SIGNATURE_MIN_POINTS = 8;

export type SignatureStroke = [number, number][];

export function isSignatureComplete(value: string | null | undefined): boolean {
  return signatureStrokes(value).flat().length >= SIGNATURE_MIN_POINTS;
}

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

export function serializeSignature(strokes: SignatureStroke[]) {
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

/** Fits the signature inside `box`, centred, keeping its proportions. */
export function drawSignature(
  ctx: CanvasRenderingContext2D,
  value: string | null | undefined,
  box: { height: number; width: number; x: number; y: number },
  color: string,
) {
  const strokes = signatureStrokes(value);

  if (strokes.length === 0) {
    return;
  }

  const scale = Math.min(box.width / SIGNATURE_WIDTH, box.height / SIGNATURE_HEIGHT);
  const offsetX = box.x + (box.width - SIGNATURE_WIDTH * scale) / 2;
  const offsetY = box.y + (box.height - SIGNATURE_HEIGHT * scale) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, 5 * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  for (const stroke of strokes) {
    const [first, ...rest] = stroke;

    ctx.moveTo(offsetX + first![0] * scale, offsetY + first![1] * scale);

    // A tap is a dot, not nothing.
    for (const [x, y] of rest.length > 0 ? rest : [[first![0] + 0.5, first![1]]]) {
      ctx.lineTo(offsetX + x! * scale, offsetY + y! * scale);
    }
  }

  ctx.stroke();
  ctx.restore();
}
