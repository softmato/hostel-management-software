import { describe, expect, it } from "vitest";

import { ensureIdCardFonts, ID_CARD_SERVER_FONT_STACK } from "@/lib/id-card-fonts";
import {
  CARD_WIDTH,
  type IdCardData,
  type PlatformIdCardType,
} from "@/lib/platform-id-card";
import { renderIdCardPng } from "@/lib/platform-id-card.server";

/**
 * The emailed card is drawn by the same code as the on-screen one, through a
 * Node canvas rather than the browser's. That substitution is the whole risk
 * here — if the native context ever stops accepting what the shared renderer
 * asks of it, approval emails silently lose their attachment. These tests are
 * the tripwire for that.
 */

const BASE: IdCardData = {
  bloodGroup: "O+",
  brandName: "Hostel Days",
  dateOfBirth: "12 Mar 2001",
  email: "resident@example.com",
  fullName: "Asha Bahadur Gurung",
  issuedOn: "01 Aug 2026",
  phone: "+977-9800000000",
  residentId: "HH-4K7M-9XQ2",
  role: "Resident",
  siteLabel: "hosteldays.com.np",
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderIdCardPng", () => {
  const types: PlatformIdCardType[] = [
    "RESIDENT",
    "HOSTEL_OWNER",
    "SERVICE_PROVIDER",
  ];

  it.each(types)("renders both faces of the %s card as PNG", async (cardType) => {
    for (const face of ["front", "back"] as const) {
      const png = await renderIdCardPng({ ...BASE, cardType }, face);

      expect(png).not.toBeNull();
      expect(png!.subarray(0, 4)).toEqual(PNG_MAGIC);
      // A blank canvas still encodes; a card that actually drew is far larger.
      expect(png!.byteLength).toBeGreaterThan(5_000);
    }
  });

  it("degrades to a card rather than failing when the photo bytes are junk", async () => {
    const png = await renderIdCardPng(BASE, "front", {
      photo: Buffer.from("not an image"),
      qr: Buffer.from("not an image either"),
    });

    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  /**
   * The regression this file previously could not see.
   *
   * Every glyph was missing from the cards emailed out of Vercel, because the
   * painter asked for a font stack the lambda could not resolve and `fillText`
   * answers that by drawing nothing at all — no exception, no empty string, no
   * signal of any kind. The renderer's `catch` never ran, the PNG encoded
   * fine, and a 40 KB picture of a header curve and a dashed line went to the
   * resident. Byte length cannot catch it: shapes alone clear 5 KB.
   *
   * So this looks at pixels. The band below the portrait and above the
   * hairline holds the holder's name and nothing else, which makes "is there
   * ink here" a direct question about whether text rendered.
   */
  it("draws the holder's name as actual pixels", async () => {
    const png = await renderIdCardPng(BASE, "front");

    expect(png).not.toBeNull();

    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(png!);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    ctx.drawImage(image, 0, 0);

    // Card units → rendered pixels. The name's baseline is at y 478 in a
    // 38px face, centred on the card.
    const scale = image.width / CARD_WIDTH;
    const band = ctx.getImageData(
      Math.round(100 * scale),
      Math.round(448 * scale),
      Math.round(440 * scale),
      Math.round(34 * scale),
    );

    let ink = 0;

    for (let i = 0; i < band.data.length; i += 4) {
      if (band.data[i] < 128 && band.data[i + 1] < 128 && band.data[i + 2] < 128) {
        ink += 1;
      }
    }

    // A blank band scores 0. A rendered name is thousands of dark pixels.
    expect(ink).toBeGreaterThan(500);
  });
});

/**
 * Guards the mechanism rather than the output, so a failure says *why* the
 * cards went blank instead of only that they did.
 */
describe("ensureIdCardFonts", () => {
  it("registers every weight the card painter asks for", async () => {
    expect(await ensureIdCardFonts()).toBe(true);

    const { GlobalFonts } = await import("@napi-rs/canvas");
    const inter = GlobalFonts.families.find((family) => family.family === "Inter");

    /*
     * Asserted as registered faces rather than as a measured width, because a
     * width proves nothing on a developer machine: `@napi-rs/canvas` answers an
     * unresolvable family with a host fallback, so `measureText` returns a
     * plausible number on Windows and macOS and only collapses on a lambda,
     * which has no host font to fall back to. The weights below are the ones
     * `font()` passes — miss one and that text alone disappears from the card.
     */
    expect(inter?.styles.map((style) => style.weight).sort()).toEqual([
      500, 600, 700, 800,
    ]);
  });

  it("has no fallback in the server stack", () => {
    // A fallback is what let Windows paint a correct card from a broken
    // config, and kept this bug out of every local run and CI job.
    expect(ID_CARD_SERVER_FONT_STACK).toBe('"Inter"');
  });
});
