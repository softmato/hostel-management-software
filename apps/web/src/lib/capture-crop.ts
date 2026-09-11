/**
 * Turning "the part of the viewfinder inside the guide frame" into a rectangle
 * of the photograph that was actually taken.
 *
 * Mirrors apps/mobile/src/lib/capture-crop.ts
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
 * A guide frame centred in the preview, inset in from the sides, with the given aspect ratio.
 */
export function centredGuide(
  preview: { height: number; width: number },
  aspectRatio: number,
  inset = 0.1,
): GuideFraction {
  const width = Math.min(1, Math.max(0, 1 - inset * 2));
  const heightPx = (preview.width * width) / aspectRatio;
  const height = Math.min(1, heightPx / preview.height);

  return { height, width, x: (1 - width) / 2, y: (1 - height) / 2 };
}
