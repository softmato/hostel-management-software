import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_FLAGS,
  provenanceFlags,
  readEvidenceProvenance,
} from "@/modules/finance/evidence-provenance";

/**
 * Fixtures are *built*, not vendored, and that is the only honest way to test
 * this module: the questions it asks are about bytes a real encoder emitted, so
 * a hand-written byte array proves nothing except that the parser agrees with
 * whoever wrote the array. `sharp` wraps libjpeg-turbo, which is the same
 * encoder behind Android's screenshot pipeline and WhatsApp's re-compression —
 * so a JPEG it produces is the genuine negative case, and a table that fails
 * against it is a table nothing in the honest population produces.
 */

/** A plain phone-screenshot-shaped image, in whatever container is asked for. */
function canvas(width: number, height: number) {
  return sharp({
    create: {
      background: { b: 240, g: 245, r: 250 },
      channels: 3,
      height,
      width,
    },
  });
}

describe("readEvidenceProvenance", () => {
  it("reads a libjpeg screenshot as standard, unedited and screen-shaped", async () => {
    const bytes = await canvas(1080, 2400).jpeg({ quality: 80 }).toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.container).toBe("jpeg");
    expect(provenance?.quantTablesStandard).toBe(true);
    expect(provenance?.hasCameraExif).toBe(false);
    expect(provenance?.editorSignature).toBeNull();
    expect(provenance?.screenshotShape).toBe(true);
    // The estimator recovers the quality it was encoded at, which is what makes
    // the standard/non-standard verdict meaningful rather than a coin toss.
    expect(provenance?.jpegQuality).toBeGreaterThanOrEqual(78);
    expect(provenance?.jpegQuality).toBeLessThanOrEqual(82);
  });

  it("raises no flag at all on that file", async () => {
    const bytes = await canvas(1080, 2400).jpeg({ quality: 80 }).toBuffer();

    expect(provenanceFlags(readEvidenceProvenance(bytes))).toEqual([]);
  });

  it("survives WhatsApp-style re-compression without flagging it", async () => {
    // What a forwarded receipt actually is: a screenshot decoded and re-encoded
    // by another libjpeg at a lower quality and a smaller size. Still standard
    // tables, still a screen shape — the population this must not accuse.
    const original = await canvas(1080, 2400).jpeg({ quality: 92 }).toBuffer();
    const forwarded = await sharp(original)
      .resize({ width: 702 })
      .jpeg({ quality: 70 })
      .toBuffer();

    expect(provenanceFlags(readEvidenceProvenance(forwarded))).toEqual([]);
  });

  it("names the editor when the file carries an editor's Software tag", async () => {
    const bytes = await canvas(1080, 2400)
      .withExif({ IFD0: { Software: "Adobe Photoshop 25.1 (Windows)" } })
      .jpeg({ quality: 80 })
      .toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.softwareTag).toContain("Adobe Photoshop");
    expect(provenance?.editorSignature).toContain("Adobe Photoshop");
    expect(provenanceFlags(provenance)).toContain(PROVENANCE_FLAGS.EDITOR_SIGNATURE);
  });

  it("does not treat an unrecognised Software tag as an editor", async () => {
    // The safe direction: a writer this module has never heard of produces no
    // flag rather than an accusation.
    const bytes = await canvas(1080, 2400)
      .withExif({ IFD0: { Software: "HostelDays Receipt Service" } })
      .jpeg({ quality: 80 })
      .toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.softwareTag).toContain("HostelDays");
    expect(provenance?.editorSignature).toBeNull();
    expect(provenanceFlags(provenance)).toEqual([]);
  });

  it("calls a file with camera EXIF a photograph, not a screenshot", async () => {
    const bytes = await canvas(1080, 2400)
      .withExif({ IFD0: { Make: "Xiaomi", Model: "Redmi Note 12" } })
      .jpeg({ quality: 80 })
      .toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.hasCameraExif).toBe(true);
    expect(provenanceFlags(provenance)).toContain(PROVENANCE_FLAGS.NOT_A_SCREENSHOT);
  });

  it("flags a crop, because no screen has that shape", async () => {
    // The dimensions of the eSewa receipt in the bug report: a real receipt,
    // cropped out of a real screenshot. Amber and nothing more — cropping the
    // balance out is a resident behaving well.
    const bytes = await canvas(460, 620).jpeg({ quality: 80 }).toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.screenshotShape).toBe(false);
    expect(provenanceFlags(provenance)).toEqual([PROVENANCE_FLAGS.DIMENSIONS_UNUSUAL]);
  });

  it("accepts a landscape desktop-wallet screenshot as a screen shape", async () => {
    const bytes = await canvas(1920, 1080).jpeg({ quality: 80 }).toBuffer();

    expect(readEvidenceProvenance(bytes)?.screenshotShape).toBe(true);
  });

  it("calls quantization tables no IJG quality produces non-standard", () => {
    // A JPEG whose luminance table is flat 3s. libjpeg's relation cannot produce
    // one: at every quality the table is a scaling of a table that is not flat.
    // Editors that ship their own tables are what this catches in the wild.
    const table = new Uint8Array(64).fill(3);
    const bytes = Buffer.concat([
      // SOI
      Buffer.from([0xff, 0xd8]),
      // DQT, length 67, 8-bit precision, table id 0
      Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00]),
      Buffer.from(table),
      // SOF0, length 11, 8-bit, 1080x2400, one component
      Buffer.from([
        0xff, 0xc0, 0x00, 0x0b, 0x08, 0x09, 0x60, 0x04, 0x38, 0x01, 0x01, 0x11, 0x00,
      ]),
      // SOS — the walk stops here
      Buffer.from([0xff, 0xda]),
    ]);
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.container).toBe("jpeg");
    expect(provenance?.quantTablesStandard).toBe(false);
    expect(provenanceFlags(provenance)).toContain(PROVENANCE_FLAGS.RE_ENCODED);
  });

  it("asks nothing of a PNG that a PNG cannot answer", async () => {
    const bytes = await canvas(1080, 2400).png().toBuffer();
    const provenance = readEvidenceProvenance(bytes);

    expect(provenance?.container).toBe("png");
    // Quantization is a JPEG concept. Null is "not applicable", and it must not
    // read as "non-standard" — that is the difference between no signal and an
    // accusation.
    expect(provenance?.quantTablesStandard).toBeNull();
    expect(provenance?.screenshotShape).toBe(true);
    expect(provenanceFlags(provenance)).toEqual([]);
  });

  it("reads a PNG Software text chunk", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", Buffer.from([0, 0, 4, 56, 0, 0, 9, 96, 8, 6, 0, 0, 0])),
      chunk("tEXt", Buffer.concat([
        Buffer.from("Software", "latin1"),
        Buffer.from([0]),
        Buffer.from("GIMP 2.10.34", "latin1"),
      ])),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const provenance = readEvidenceProvenance(png);

    expect(provenance?.softwareTag).toBe("GIMP 2.10.34");
    expect(provenanceFlags(provenance)).toContain(PROVENANCE_FLAGS.EDITOR_SIGNATURE);
  });

  it("returns an empty record rather than throwing on rubbish", () => {
    const provenance = readEvidenceProvenance(Buffer.from("not an image at all"));

    expect(provenance?.container).toBe("other");
    expect(provenanceFlags(provenance)).toEqual([]);
  });

  it("truncated headers cost the signal, never the upload", async () => {
    const full = await canvas(1080, 2400).jpeg({ quality: 80 }).toBuffer();

    expect(() => readEvidenceProvenance(full.subarray(0, 12))).not.toThrow();
  });

  it("has nothing to say about a claim with no provenance recorded", () => {
    // Every asset stored before this shipped. Absent is not suspicious.
    expect(provenanceFlags(null)).toEqual([]);
    expect(provenanceFlags(undefined)).toEqual([]);
  });
});

/** A PNG chunk: length, type, data, CRC. The CRC is not checked by the reader. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);

  length.writeUInt32BE(data.length);

  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}
