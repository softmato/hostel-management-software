/**
 * Shrinking a receipt photo to the size the server will actually read.
 *
 * ## Why this exists
 *
 * `apps/web/src/modules/finance/evidence-ocr.ts` resizes every image to a
 * **1600px longest edge** before handing it to the recogniser, because past
 * that accuracy stops improving. So every pixel above 1600 is uploaded, stored,
 * fetched back out of R2 and then thrown away without ever being looked at.
 *
 * On a phone that is not a rounding error. `ImagePicker` hands back the camera's
 * full sensor frame: a resident photographing a bank slip produced a
 * **3456 × 4608, 1.58 MB** JPEG, where the same resident on the web picked a
 * screenshot of 16–144 KB. Ten times the bytes, for an image the server
 * immediately reduces to the same thing — and those bytes go up a phone's
 * uplink, which is the slowest link in the whole path and the one the resident
 * is watching a progress bar for.
 *
 * Resizing here is therefore not compression for its own sake. It moves work
 * off the leg that is metered and slow and onto the one that is neither.
 *
 * ## Never at the cost of the evidence
 *
 * This is proof of a payment, and a claim is refused if the file cannot be read.
 * So the rules are conservative in one direction only:
 *
 * - **Never enlarge.** A 460 × 620 screenshot is already under the bar and is
 *   passed through untouched. Upscaling would invent detail and cost bytes.
 * - **Never convert a PDF.** A bank's PDF is read by its text layer, exactly,
 *   with no OCR at all — it is the best evidence the product accepts, and
 *   rasterising it would destroy the thing that makes it good.
 * - **Never fail the attach.** Every failure path returns the original file.
 *   A resident whose photo could not be resized should upload a large photo,
 *   not be told to try again.
 *
 * ## Lazily required, like every other native module here
 *
 * `expo-image-manipulator` is a native module and this project is bare, so a
 * binary built before it was added would throw at module load and take the whole
 * route down as "missing default export" — the same failure `claim.tsx` guards
 * `expo-document-picker` against, and `lib/evidence-reader.ts` guards
 * `expo/fetch` against. An older build simply uploads the original, which is
 * what it did before this file existed.
 */

/**
 * The longest edge worth uploading.
 *
 * Kept equal to `MAX_EDGE` in the server's `evidence-ocr.ts` deliberately: this
 * number is not a quality preference of the client's, it is the server's own
 * limit restated. If that constant moves, this one moves with it — a smaller
 * value here would hand the recogniser less than it can use.
 */
export const EVIDENCE_MAX_EDGE = 1600;

/**
 * JPEG quality for the resized copy.
 *
 * 0.9 rather than the picker's 0.8: the resize has already removed most of the
 * bytes, and re-compressing hard on top of it is how a transaction ID stops
 * being legible. Recognition accuracy is the budget being spent here, not size.
 */
const EVIDENCE_QUALITY = 0.9;

type Manipulator = typeof import("expo-image-manipulator");

/** `expo-image-manipulator`, or null on a binary that predates it. */
function loadManipulator(): Manipulator | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-image-manipulator") as Manipulator;
  } catch {
    return null;
  }
}

export type PickedFile = {
  fileName?: string | null;
  mimeType?: string;
  uri: string;
};

/** Whether this file is a raster image we may re-encode at all. */
function isResizableImage(mimeType: string | undefined, uri: string): boolean {
  const type = (mimeType ?? "").toLowerCase();

  if (type) {
    return type === "image/jpeg" || type === "image/png" || type === "image/webp";
  }

  // A library asset can arrive with no MIME type at all. The extension is the
  // only other thing we know, and an unrecognised one is left alone.
  return /\.(jpe?g|png|webp)$/i.test(uri.split("?")[0] ?? "");
}

/**
 * The file to upload: a 1600px copy when that is both possible and smaller,
 * otherwise exactly what was picked.
 *
 * `width`/`height` come from the picker when it knows them, which lets an
 * already-small screenshot skip the round trip through the manipulator
 * entirely — the common case for a resident who screenshots their wallet app.
 */
export async function prepareEvidenceForUpload(
  picked: PickedFile & { height?: number; width?: number },
): Promise<PickedFile> {
  if (!isResizableImage(picked.mimeType, picked.uri)) {
    return picked;
  }

  // Already within the server's window, so re-encoding could only lose detail.
  if (
    picked.width !== undefined &&
    picked.height !== undefined &&
    picked.width <= EVIDENCE_MAX_EDGE &&
    picked.height <= EVIDENCE_MAX_EDGE
  ) {
    return picked;
  }

  const manipulator = loadManipulator();

  if (!manipulator) {
    return picked;
  }

  try {
    /*
     * The picker's dimensions when it has them, the decoded image's when it does
     * not — and they have to be known before anything is resized.
     *
     * `resize({ width: 1600 })` scales in **both** directions, so firing it
     * blind at a 460 × 620 screenshot would enlarge it: more bytes than the file
     * we were handed, carrying no more detail, which is the exact opposite of
     * this function's job. `expo-document-picker` reports no dimensions at all,
     * so that path is not hypothetical.
     */
    const source = manipulator.ImageManipulator.manipulate(picked.uri);
    const measured =
      picked.width !== undefined && picked.height !== undefined
        ? { height: picked.height, width: picked.width }
        : await source.renderAsync();

    if (measured.width <= EVIDENCE_MAX_EDGE && measured.height <= EVIDENCE_MAX_EDGE) {
      return picked;
    }

    /*
     * One dimension only, so the aspect ratio is kept.
     *
     * Which one depends on the shot: a receipt photographed portrait is taller
     * than it is wide, and constraining its width would leave the height far
     * over the limit — the server would resize it again and the upload would
     * have carried the difference for nothing.
     */
    const constraint =
      measured.height > measured.width
        ? { height: EVIDENCE_MAX_EDGE }
        : { width: EVIDENCE_MAX_EDGE };

    const image = await manipulator.ImageManipulator.manipulate(picked.uri)
      .resize(constraint)
      .renderAsync();
    const saved = await image.saveAsync({
      compress: EVIDENCE_QUALITY,
      format: manipulator.SaveFormat.JPEG,
    });

    return {
      // A JPEG now, whatever it was: the name and the type have to agree with
      // the bytes or the presigned PUT is signed for a content type the object
      // does not have, and R2 refuses it outright.
      fileName: renameToJpeg(picked.fileName),
      mimeType: "image/jpeg",
      uri: saved.uri,
    };
  } catch {
    // Resizing is an optimisation. Losing it costs bytes; failing the attach
    // over it would cost the resident their claim.
    return picked;
  }
}

/** The picked name with a `.jpg` extension, since the bytes are now a JPEG. */
function renameToJpeg(fileName: string | null | undefined): string {
  const base = (fileName ?? "receipt").replace(/\.[^./\\]+$/, "");

  return `${base || "receipt"}.jpg`;
}
