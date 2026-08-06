import {
  CARD_HEIGHT,
  CARD_WIDTH,
  drawIdCard,
  type IdCardData,
  type IdCardFace,
} from "@/lib/platform-id-card";

/**
 * Server-side PNG rendering of the platform ID card, for the copy attached to
 * approval and card-issued emails.
 *
 * `@napi-rs/canvas` implements the same 2D context API as the browser, so the
 * card is painted by the *same* `drawIdCard` used for the on-screen preview and
 * the in-app download — there is no second renderer to keep in sync, and the
 * emailed PNG cannot drift from what the holder sees in the app.
 *
 * The native module is imported lazily inside the render call so it is only
 * loaded by the handful of requests that actually issue a card, and so a broken
 * native binary surfaces as one failed attachment rather than a boot failure of
 * every route that transitively imports this file.
 */

/**
 * Roughly 640×1000 at 2×. Rendering is CPU-bound but short (tens of
 * milliseconds); callers must still keep it off the request's critical path —
 * see `renderIdCardPng`'s contract below.
 */
const RENDER_SCALE = 2;

type CardImages = {
  /** Same-origin PNG/JPEG bytes for the holder's photo, if there is one. */
  photo?: Buffer | null;
  /** PNG bytes of the share QR. */
  qr?: Buffer | null;
};

/**
 * Renders one face of the card to PNG bytes.
 *
 * Never throws: a card is a nice-to-have attachment on an email whose actual
 * job is to tell someone they were approved, so a rendering failure must not
 * fail the approval. Returns `null` and logs instead.
 */
export async function renderIdCardPng(
  data: IdCardData,
  face: IdCardFace = "front",
  images: CardImages = {},
): Promise<Buffer | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");

    const canvas = createCanvas(CARD_WIDTH * RENDER_SCALE, CARD_HEIGHT * RENDER_SCALE);
    const ctx = canvas.getContext("2d");

    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

    // A missing or corrupt photo/QR degrades the card rather than losing it —
    // the renderer already falls back to initials and an empty QR frame.
    const [photo, qr] = await Promise.all([
      images.photo ? loadImage(images.photo).catch(() => null) : null,
      images.qr ? loadImage(images.qr).catch(() => null) : null,
    ]);

    // The napi context and images are API-compatible with the DOM ones the
    // shared renderer is typed against, but they are not the DOM types.
    drawIdCard(ctx as unknown as CanvasRenderingContext2D, {
      ...data,
      photo: (photo ?? null) as unknown as HTMLImageElement | null,
      qr: (qr ?? null) as unknown as HTMLImageElement | null,
    }, face);

    return await canvas.encode("png");
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "id_card_render_failed",
        message: error instanceof Error ? error.message : "Unknown render failure",
      }),
    );

    return null;
  }
}
