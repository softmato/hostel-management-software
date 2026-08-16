import sharp from "sharp";

/**
 * Is this actually a usable image, and does it carry any information? (gap fixes
 * 2 and 3.)
 *
 * Two separate questions, and they fail at different places on purpose:
 *
 * - **Decodable** is an upload concern. A truncated or corrupt file is not an
 *   image at all, and storing one produces an asset that every later screen
 *   renders as a broken-image icon — including the claim-review modal, where a
 *   reviewer with no visible evidence still saw "Screenshot attached" in green.
 *   Rejected at completion, for every image upload on the platform.
 * - **Blank** is an evidence concern. A 4×4 white PNG is a perfectly legitimate
 *   image; it is only meaningless as *proof of payment*. So it is recorded here
 *   and enforced by the finance module, which is the only caller that cares.
 *
 * `sharp` is already a dependency (image variants, and the perceptual hash in
 * `modules/finance/evidence.ts`), so this adds no new install.
 */

export type ImageInsight = {
  /** Mean per-channel standard deviation. Near zero means a flat single colour. */
  contrast: number;
  height: number;
  /**
   * True when the image carries essentially no detail — a solid colour, or a
   * canvas so small nothing could be read off it. A payment screenshot never
   * looks like this; a placeholder file always does.
   */
  nearBlank: boolean;
  width: number;
};

/**
 * The smallest a screenshot of a payment confirmation could plausibly be.
 *
 * Generous on purpose: an old 320-wide phone screenshot is real, and this is a
 * floor for "nothing could be read off this", not a quality bar. Anything below
 * it is a placeholder, an icon or a tracking pixel.
 */
const MIN_EDGE = 120;

/**
 * How flat an image may be before it carries no information.
 *
 * Standard deviation over the greyscale channel, 0–255. A solid fill is exactly
 * 0; a screenshot of a banking app — white card, dark text, a coloured header —
 * is comfortably in the tens. Two is low enough that only genuinely featureless
 * images fall under it, which matters because this number auto-rejects a claim.
 */
const MIN_CONTRAST = 2;

/** MIME types this module can speak about at all. */
export function isInspectableImage(mimeType: string | undefined): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(
    (mimeType ?? "").toLowerCase(),
  );
}

/**
 * Decodes the image and measures it. Returns null when the bytes cannot be
 * decoded — which the caller must treat as a rejection, not as missing data.
 */
export async function inspectImage(
  bytes: Buffer | Uint8Array,
): Promise<ImageInsight | null> {
  try {
    const image = sharp(bytes);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    // `stats()` decodes the pixels, so a file with a valid header and a
    // truncated body fails here rather than passing on the header alone.
    const stats = await image.greyscale().stats();
    const contrast =
      stats.channels.reduce((sum, channel) => sum + channel.stdev, 0) /
      Math.max(1, stats.channels.length);

    return {
      contrast,
      height: metadata.height,
      nearBlank:
        contrast < MIN_CONTRAST ||
        metadata.width < MIN_EDGE ||
        metadata.height < MIN_EDGE,
      width: metadata.width,
    };
  } catch {
    return null;
  }
}
