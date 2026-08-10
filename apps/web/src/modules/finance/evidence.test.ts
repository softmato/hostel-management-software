/**
 * Evidence fingerprinting — Block 3 item 3.4 of
 * docs/FINANCE_IMPLEMENTATION_PLAN.md (target §8).
 *
 * The property that matters is asymmetric: a perceptual hash must be *stable*
 * across the transformations a screenshot really undergoes (re-encoding,
 * resizing, a small quality change) and must still *separate* two genuinely
 * different images. It is allowed to be wrong in the direction of "these look
 * alike" — that only flags a claim for a human — and must never be the thing
 * that rejects one.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  computePerceptualHash,
  hammingDistance,
  isPerceptualNearDuplicate,
  PERCEPTUAL_MATCH_THRESHOLD,
} from "./evidence";

/** A deterministic gradient with a distinguishing block, as PNG bytes. */
async function image(seed: number, width = 240, height = 240) {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const inBlock = x > width / 2 && y > height / 2;

      raw[offset] = (x * 2 + seed * 40) % 256;
      raw[offset + 1] = (y * 2 + seed * 90) % 256;
      raw[offset + 2] = inBlock ? (seed * 70) % 256 : 20;
    }
  }

  return sharp(raw, { raw: { channels, height, width } }).png().toBuffer();
}

describe("computePerceptualHash", () => {
  it("returns 16 hex characters — 64 bits", async () => {
    expect(await computePerceptualHash(await image(1))).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same bytes", async () => {
    const bytes = await image(1);

    expect(await computePerceptualHash(bytes)).toBe(
      await computePerceptualHash(bytes),
    );
  });

  it("survives a re-encode to JPEG", async () => {
    const original = await image(2);
    const reencoded = await sharp(original).jpeg({ quality: 70 }).toBuffer();

    // This is the case the check exists for: a screenshot forwarded through a
    // chat app comes back as a different file with the same content.
    const distance = hammingDistance(
      (await computePerceptualHash(original))!,
      (await computePerceptualHash(reencoded))!,
    );

    expect(distance).toBeLessThanOrEqual(PERCEPTUAL_MATCH_THRESHOLD);
  });

  it("survives a resize", async () => {
    const original = await image(3);
    const smaller = await sharp(original).resize(120, 120).png().toBuffer();

    expect(
      isPerceptualNearDuplicate(
        (await computePerceptualHash(original))!,
        (await computePerceptualHash(smaller))!,
      ),
    ).toBe(true);
  });

  it("returns null for bytes that are not a decodable image", async () => {
    // A PDF proof, or a corrupt upload. Not an error — it simply gets no
    // similarity check, and the content hash still applies.
    expect(await computePerceptualHash(Buffer.from("not an image"))).toBeNull();
  });
});

describe("hammingDistance", () => {
  it("is zero for identical hashes", () => {
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
  });

  it("counts every differing bit", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
  });

  it("refuses hashes of different lengths rather than guessing", () => {
    expect(hammingDistance("ffff", "ffffffffffffffff")).toBeNull();
    expect(hammingDistance("", "")).toBeNull();
  });

  it("refuses a non-hex hash", () => {
    expect(hammingDistance("zzzzzzzzzzzzzzzz", "0000000000000000")).toBeNull();
  });
});

describe("isPerceptualNearDuplicate", () => {
  it("is false at one bit beyond the threshold", () => {
    const zeros = "0000000000000000";
    // 11 set bits — one more than the threshold permits.
    const eleven = "7ff0000000000000";

    expect(hammingDistance(zeros, eleven)).toBe(PERCEPTUAL_MATCH_THRESHOLD + 1);
    expect(isPerceptualNearDuplicate(zeros, eleven)).toBe(false);
  });

  it("is false for an unusable hash rather than defaulting to true", () => {
    // A false positive here would flag every claim from an asset whose hash
    // failed to compute, which is noise the reviewer learns to ignore.
    expect(isPerceptualNearDuplicate("", "")).toBe(false);
  });
});
