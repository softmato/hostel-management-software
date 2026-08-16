/**
 * Byte-level type checking (gap fix 1).
 *
 * The bug these cover: `verifyUploadedObject` compared storage's `ContentType`
 * against the type declared at presign, and on a presigned PUT both of those are
 * the uploading client's own words — so the check passed for any bytes at all. A
 * container signature is the one part of the exchange the uploader does not
 * author, so that is what these assert on.
 */
import { describe, expect, it } from "vitest";

import { contentTypeMismatch, looksTextual, sniffFamily } from "./sniff";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n", "latin1");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const CSV = Buffer.from("month,amount\n2026-07,10000\n", "utf8");
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);

function webp() {
  const bytes = Buffer.alloc(16);

  bytes.write("RIFF", 0, "latin1");
  bytes.write("WEBP", 8, "latin1");

  return bytes;
}

describe("sniffFamily", () => {
  it("recognises the formats payment evidence arrives as", () => {
    expect(sniffFamily(PNG)).toBe("IMAGE_PNG");
    expect(sniffFamily(JPEG)).toBe("IMAGE_JPEG");
    expect(sniffFamily(webp())).toBe("IMAGE_WEBP");
    expect(sniffFamily(PDF)).toBe("PDF");
  });

  it("does not mistake other RIFF containers for WebP", () => {
    const wav = Buffer.alloc(16);

    wav.write("RIFF", 0, "latin1");
    wav.write("WAVE", 8, "latin1");

    expect(sniffFamily(wav)).toBeNull();
  });

  it("returns null for text, which has no signature and never will", () => {
    expect(sniffFamily(CSV)).toBeNull();
  });
});

describe("contentTypeMismatch", () => {
  it("passes bytes that are what they say they are", () => {
    expect(contentTypeMismatch("image/png", PNG)).toBeNull();
    expect(contentTypeMismatch("application/pdf", PDF)).toBeNull();
    expect(contentTypeMismatch("text/csv", CSV)).toBeNull();
  });

  it("refuses an executable declared as an image", () => {
    // The whole point of the fix: this used to be stored as `image/png`.
    expect(contentTypeMismatch("image/png", ELF)).toMatch(/not a recognised/i);
  });

  it("refuses one image format declared as another", () => {
    expect(contentTypeMismatch("image/png", JPEG)).toMatch(/do not match/i);
  });

  it("refuses binary declared as text", () => {
    expect(contentTypeMismatch("text/csv", PNG)).toMatch(/not text/i);
  });

  it("accepts a xlsx declared as legacy xls", () => {
    // Wallets hand these out mislabelled often enough that refusing them would
    // send owners back to re-saving statements by hand.
    expect(
      contentTypeMismatch("application/vnd.ms-excel", ZIP),
    ).toBeNull();
  });

  it("stays out of the way of types it does not police", () => {
    // The allowlist in `@hostel/shared` decides *which* types may be uploaded.
    // Duplicating it here would mean adding a type in one place and having
    // uploads fail in another.
    expect(contentTypeMismatch("image/gif", ELF)).toBeNull();
  });
});

describe("looksTextual", () => {
  it("keys on NUL bytes rather than on an encoding guess", () => {
    expect(looksTextual(CSV)).toBe(true);
    expect(looksTextual(Buffer.from("नेपाली, ९४८१", "utf8"))).toBe(true);
    expect(looksTextual(PNG)).toBe(false);
  });
});
