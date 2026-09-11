/**
 * Turning "the part of the viewfinder inside the guide frame" into a rectangle
 * of the photograph that was actually taken.
 *
 * ## Why this is not just a percentage of the image
 *
 * `CameraView` fills its box the way `contentFit="cover"` does: the sensor's
 * frame is scaled until it covers the preview and the overflow is cropped away,
 * centred. So the preview is a *window onto part of* the picture, and the two
 * only agree when their aspect ratios happen to match. A guide frame drawn 80%
 * across a 4:3 preview is not 80% across a 16:9 photograph — it is 80% of the
 * 4:3 slice sitting in the middle of it. Crop by the naive percentage and a
 * signature comes out shifted sideways, by more the further the two shapes are
 * apart.
 *
 * Pure and separate from the camera component so the arithmetic can be checked
 * against numbers rather than against a photograph — `capture-crop.test.ts` is
 * where the cases live, and it needs no native module to run.
 */

export type Rect = { height: number; originX: number; originY: number; width: number };

/** The guide frame, as fractions of the preview box it is drawn in. */
export type GuideFraction = {
  height: number;
  width: number;
  /** Left edge, 0–1. */
  x: number;
  /** Top edge, 0–1. */
  y: number;
};

/**
 * The crop rectangle, in the photograph's own pixels, rounded to whole ones.
 *
 * Clamped to the image on every edge: a guide frame that reaches the edge of a
 * preview can land a fraction of a pixel outside the photograph once it is
 * mapped, and `expo-image-manipulator` answers an out-of-bounds crop with a
 * native error rather than by trimming it.
 */
export function cropRectForGuide(
  image: { height: number; width: number },
  preview: { height: number; width: number },
  guide: GuideFraction,
): Rect {
  const imageAspect = image.width / image.height;
  const previewAspect = preview.width / preview.height;

  // The slice of the photograph the preview was actually showing.
  const visibleWidth =
    imageAspect > previewAspect ? image.height * previewAspect : image.width;
  const visibleHeight =
    imageAspect > previewAspect ? image.height : image.width / previewAspect;
  const offsetX = (image.width - visibleWidth) / 2;
  const offsetY = (image.height - visibleHeight) / 2;

  const originX = offsetX + guide.x * visibleWidth;
  const originY = offsetY + guide.y * visibleHeight;
  const width = guide.width * visibleWidth;
  const height = guide.height * visibleHeight;

  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(originX)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(originY)));

  return {
    height: Math.max(1, Math.min(image.height - clampedY, Math.round(height))),
    originX: clampedX,
    originY: clampedY,
    width: Math.max(1, Math.min(image.width - clampedX, Math.round(width))),
  };
}

/**
 * A guide frame centred in the preview, `inset` in from the sides, with the
 * given aspect ratio — which is how both of this app's frames are described:
 * a 3:1 band for a signature on paper, a square for a face.
 */
export function centredGuide(
  preview: { height: number; width: number },
  aspectRatio: number,
  inset: number,
): GuideFraction {
  const width = Math.min(1, Math.max(0, 1 - inset * 2));
  const heightPx = (preview.width * width) / aspectRatio;
  const height = Math.min(1, heightPx / preview.height);

  return { height, width, x: (1 - width) / 2, y: (1 - height) / 2 };
}
