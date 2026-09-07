/**
 * Reading the *file*, not the picture (evidence pipeline, phase 5).
 *
 * Every other evidence check in this module reads what the receipt **says** —
 * the amount, the transaction id, the payee, the direction. All of them are
 * defeated by the same attack, and it is not a sophisticated one: open a real
 * receipt in any photo editor, change the amount, screenshot the result. The
 * text is then perfectly legible, perfectly consistent, and a lie. OCR cannot
 * see it, because there is nothing wrong with the pixels.
 *
 * What *is* wrong is the file. A screenshot straight off a phone and a
 * screenshot that has been through Photoshop are different objects at the byte
 * level, and the difference survives in places the editor has no reason to
 * clean up: an EXIF `Software` tag, a PNG `tEXt` chunk, a JPEG quantization
 * table that no camera and no screenshot pipeline would ever emit, an aspect
 * ratio that corresponds to no screen. This module reads those.
 *
 * **Three rules, and they are the same three the recogniser lives by.**
 *
 * 1. **None of this may ever refuse a claim.** Every signal here has an
 *    innocent explanation, and most of the innocent explanations describe a
 *    resident behaving *well*: cropping their account balance out of the
 *    screenshot before sending it, circling the amount with an arrow so the
 *    warden finds it, forwarding through WhatsApp because that is how they send
 *    everything, photographing a paper deposit slip because their bank issues
 *    paper. A hard refusal here would punish the careful and inconvenience
 *    nobody else. All four flags are amber.
 * 2. **One flag is noise; three are a pattern.** The value of this module is not
 *    in any single verdict. It is in the warden's queue, where a claim carrying
 *    an editor signature *and* non-standard quantization tables *and* an
 *    impossible aspect ratio is worth five minutes of a human's attention in a
 *    way that no one of those is on its own. `review.service` therefore groups
 *    them into their own check block rather than folding them in with the
 *    content checks — the warden needs to see at a glance whether the concern is
 *    what the receipt says or whether the file is what it claims to be.
 * 3. **It runs at upload, not at claim.** The bytes are already in hand at
 *    completion, the claim path is the one a resident is watching, and computing
 *    it early means we also hold the signal for assets that are never claimed —
 *    which is what makes it possible to notice the same doctored file being
 *    tried against three different invoices.
 *
 * **Error Level Analysis is deliberately absent.** It is the technique every
 * article on image forensics reaches for and it is not usable here: it fires on
 * legitimate UI gradients, which is precisely what a wallet receipt is made of.
 * At this volume its false positives would cost more warden time than the real
 * detections save.
 *
 * No new dependency. Everything below is a container walk — JPEG marker
 * segments, PNG chunks — over bytes we already have in memory.
 */

/** Flags this module can raise. All amber, none a rejection. */
export const PROVENANCE_FLAGS = {
  /**
   * The dimensions correspond to no screen — neither a phone held upright nor a
   * desktop window. Innocent: a crop, which is the single most common thing a
   * privacy-conscious resident does to a screenshot of their bank balance.
   */
  DIMENSIONS_UNUSUAL: "EVIDENCE_DIMENSIONS_UNUSUAL",
  /**
   * The file names the program that last wrote it, and that program is an image
   * editor. Innocent: marking the receipt up with an arrow, cropping in a photos
   * app that stamps itself.
   */
  EDITOR_SIGNATURE: "EVIDENCE_EDITOR_SIGNATURE",
  /**
   * The file carries camera EXIF — exposure, aperture, a lens. A screenshot has
   * none of that, so this is a photograph. Innocent, and common in Nepal: a
   * photograph of a paper deposit slip is a real receipt. Also what you get when
   * somebody photographs a screen rather than screenshotting it, which is not.
   */
  NOT_A_SCREENSHOT: "EVIDENCE_NOT_A_SCREENSHOT",
  /**
   * The JPEG's quantization tables are not the standard ones derived from the
   * IJG table at any quality — so something other than a camera, a phone
   * screenshot pipeline or a chat app produced these bytes. Innocent: Photoshop
   * and Apple both ship their own tables, and plenty of people crop in one of
   * them without editing anything else.
   */
  RE_ENCODED: "EVIDENCE_FILE_RE_ENCODED",
} as const;

export type EvidenceProvenance = {
  container: "jpeg" | "other" | "pdf" | "png" | "webp";
  /** The editor named in the file's own metadata, verbatim, or null. */
  editorSignature: string | null;
  /** Exposure, aperture or a lens in EXIF — present on a photo, never on a shot. */
  hasCameraExif: boolean;
  /** Estimated IJG quality 1-100, or null when it is not a JPEG. */
  jpegQuality: number | null;
  /**
   * Whether the quantization tables are the standard IJG ones at the estimated
   * quality. Null when the question does not apply — anything but a JPEG.
   */
  quantTablesStandard: boolean | null;
  /**
   * Whether the dimensions are consistent with a whole screen. Null when the
   * dimensions could not be read.
   */
  screenshotShape: boolean | null;
  /** The raw `Software` value, kept for the warden to read. */
  softwareTag: string | null;
};

/**
 * Programs that write their own name into a file they saved.
 *
 * Matched case-insensitively as substrings of the `Software` tag, because the
 * exact strings vary by version — Photoshop writes `Adobe Photoshop 25.1
 * (Windows)`, GIMP writes `GIMP 2.10.34`. Deliberately not exhaustive: a new
 * editor simply produces no flag, which is the safe direction. A name that is
 * *not* here is never treated as suspicious.
 *
 * Screenshot pipelines and chat apps are absent on purpose. Android's
 * screenshot service, iOS, and WhatsApp all write no `Software` tag at all, so
 * their absence from this list is what makes the list mean something.
 */
const EDITOR_MARKERS = [
  "adobe imageready",
  "adobe lightroom",
  "adobe photoshop",
  "affinity photo",
  "canva",
  "figma",
  "gimp",
  "inkscape",
  "inshot",
  "krita",
  "lunapic",
  "meitu",
  "paint 3d",
  "paint.net",
  "photo editor",
  "photopea",
  "photoscape",
  "picsart",
  "pixelmator",
  "pixlr",
  "remini",
  "sketch",
  "snapseed",
];

function editorFrom(software: string | null): string | null {
  if (!software) return null;

  const haystack = software.toLowerCase();

  return EDITOR_MARKERS.some((marker) => haystack.includes(marker)) ? software : null;
}

/**
 * Is this the shape of a whole screen?
 *
 * **Aspect ratio, not a resolution table, and that is a correctness choice.**
 * The obvious implementation is a list of known device resolutions, and it is
 * wrong here for a reason this project has already measured: an image uploaded
 * through WhatsApp arrives at 702x1600, which is a real Redmi screenshot scaled
 * to fit a messenger's own limit and matches no device that has ever shipped. A
 * resolution table would flag every forwarded receipt on the platform, which is
 * most of them.
 *
 * The ratio survives that scaling exactly. So the question asked is the one that
 * actually generalises: could any screen have this shape? Phones are tall and
 * narrow, monitors are wide. What is neither is a crop — and a crop is worth
 * knowing about, because cropping is how a balance disappears and also how a
 * doctored region is separated from the parts that would give it away.
 *
 * The bands are loose on purpose. This is asking "is this impossible?", not
 * "which phone was this?".
 */
function isScreenShape(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;

  const ratio = width / height;

  // Portrait: a 16:9 phone is 0.5625, a modern 20:9 is 0.45, an old 4:3 is 0.75.
  if (ratio >= 0.4 && ratio <= 0.72) return true;

  // Landscape: a phone turned sideways, a tablet, a laptop, an ultrawide.
  return ratio >= 1.3 && ratio <= 2.5;
}

/** The standard JPEG luminance quantization table, Annex K, natural order. */
const STANDARD_LUMINANCE = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40,
  57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35,
  55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112,
  100, 103, 99,
];

/** Where each coefficient of a DQT segment sits in natural order. */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41,
  34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30,
  37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** The IJG scaling relation, forward: quality to table entry. */
function ijgEntry(standard: number, quality: number): number {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;

  return Math.min(255, Math.max(1, Math.floor((standard * scale + 50) / 100)));
}

/**
 * The IJG quality this luminance table was built at, and whether it *was*.
 *
 * `libjpeg` — and therefore every Android screenshot, every WhatsApp re-encode,
 * every `sharp` output and the overwhelming majority of cameras — derives its
 * tables from one published table by a single scaling formula. So a table either
 * matches that formula at some integer quality or it was written by something
 * that rolled its own, and Photoshop, Apple's imaging stack and several
 * "beautify" apps all roll their own.
 *
 * Both halves are returned because they are different facts: the quality is
 * context for a human reading the queue, and the match is the flag.
 */
function analyseLuminanceTable(table: number[]): {
  quality: number | null;
  standard: boolean;
} {
  if (table.length < 64) return { quality: null, standard: false };

  // Natural order, so the table lines up with STANDARD_LUMINANCE.
  const natural: number[] = new Array<number>(64).fill(0);

  for (let index = 0; index < 64; index += 1) {
    natural[ZIGZAG[index] as number] = table[index] as number;
  }

  let best: { error: number; quality: number } | null = null;

  for (let quality = 1; quality <= 100; quality += 1) {
    let error = 0;

    for (let index = 0; index < 64; index += 1) {
      const expected = ijgEntry(STANDARD_LUMINANCE[index] as number, quality);

      error += Math.abs(expected - (natural[index] as number));
    }

    if (!best || error < best.error) {
      best = { error, quality };
    }
  }

  if (!best) return { quality: null, standard: false };

  /*
   * Two units of total error across sixty-four entries.
   *
   * Not zero: a handful of encoders round the scaling the other way on one or
   * two coefficients, and calling those non-standard would flag ordinary phone
   * screenshots. Two is tight enough that a table designed from scratch — which
   * disagrees on dozens of entries, usually by tens — cannot reach it.
   */
  return { quality: best.quality, standard: best.error <= 2 };
}

type JpegScan = {
  height: number | null;
  luminanceTable: number[] | null;
  segments: Array<{ end: number; marker: number; start: number }>;
  width: number | null;
};

/**
 * Walks a JPEG's marker segments.
 *
 * Stops at `SOS` (start of scan): everything past it is entropy-coded image
 * data with no segment structure, and the metadata this module wants is all in
 * front of it.
 */
function scanJpeg(bytes: Uint8Array): JpegScan | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const scan: JpegScan = {
    height: null,
    luminanceTable: null,
    segments: [],
    width: null,
  };
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] as number;

    // Fill bytes and the standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    // Start of scan — compressed data from here on.
    if (marker === 0xda) break;

    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);

    if (length < 2 || offset + 2 + length > bytes.length) break;

    const start = offset + 4;
    const end = offset + 2 + length;

    scan.segments.push({ end, marker, start });

    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 — every frame header carries the size in
    // the same place. DHT (0xc4), JPG (0xc8) and DAC (0xcc) do not.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      scan.width === null &&
      start + 5 < bytes.length
    ) {
      scan.height = ((bytes[start + 1] as number) << 8) | (bytes[start + 2] as number);
      scan.width = ((bytes[start + 3] as number) << 8) | (bytes[start + 4] as number);
    }

    // DQT. One segment may hold several tables back to back.
    if (marker === 0xdb) {
      let cursor = start;

      while (cursor < end) {
        const spec = bytes[cursor] as number;
        const precision = spec >> 4;
        const identifier = spec & 0x0f;
        const size = precision === 0 ? 64 : 128;

        cursor += 1;

        if (cursor + size > end) break;

        // Table 0 is luminance, which is the one the IJG relation describes.
        if (identifier === 0 && scan.luminanceTable === null) {
          const table: number[] = [];

          for (let index = 0; index < 64; index += 1) {
            table.push(
              precision === 0
                ? (bytes[cursor + index] as number)
                : (((bytes[cursor + index * 2] as number) << 8) |
                    (bytes[cursor + index * 2 + 1] as number)),
            );
          }

          scan.luminanceTable = table;
        }

        cursor += size;
      }
    }

    offset = end;
  }

  return scan;
}

/** EXIF tags this module reads, all in IFD0 or the Exif sub-IFD. */
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_EXIF_IFD = 0x8769;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_ISO = 0x8827;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_LENS_MODEL = 0xa434;

type ExifFacts = { hasCameraExif: boolean; software: string | null };

/**
 * Reads the TIFF block inside an `APP1 Exif` segment.
 *
 * Hand-rolled rather than pulled from a library, and the reason is the shape of
 * the job: two tags out of an IFD is about sixty lines, while an EXIF parser is
 * a dependency that ships a full tag dictionary, a Node/browser split and its
 * own maintenance surface for a function that must never throw. Every read below
 * is bounds-checked and the whole thing is wrapped by its caller — a malformed
 * or hostile header costs the signal, never the upload.
 */
function readExif(bytes: Uint8Array, start: number, end: number): ExifFacts {
  const facts: ExifFacts = { hasCameraExif: false, software: null };
  // The segment opens with the ASCII tag and two padding bytes; the TIFF header
  // starts immediately after them.
  const tiff = start + 6;

  if (tiff + 8 > end) return facts;

  const byteOrder = ((bytes[tiff] as number) << 8) | (bytes[tiff + 1] as number);
  const little = byteOrder === 0x4949;

  if (!little && byteOrder !== 0x4d4d) return facts;

  const u16 = (at: number) =>
    little
      ? (bytes[at] as number) | ((bytes[at + 1] as number) << 8)
      : ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
  const u32 = (at: number) =>
    little
      ? ((bytes[at] as number) |
          ((bytes[at + 1] as number) << 8) |
          ((bytes[at + 2] as number) << 16) |
          ((bytes[at + 3] as number) << 24)) >>>
        0
      : (((bytes[at] as number) << 24) |
          ((bytes[at + 1] as number) << 16) |
          ((bytes[at + 2] as number) << 8) |
          (bytes[at + 3] as number)) >>>
        0;

  const readIfd = (ifdOffset: number, depth: number) => {
    const at = tiff + ifdOffset;

    if (depth > 2 || at + 2 > end) return;

    const count = u16(at);

    // A plausible IFD holds tens of entries. Anything else is a corrupt or
    // hostile header and walking it would be reading arbitrary offsets.
    if (count > 512) return;

    for (let index = 0; index < count; index += 1) {
      const entry = at + 2 + index * 12;

      if (entry + 12 > end) return;

      const tag = u16(entry);
      const type = u16(entry + 2);
      const length = u32(entry + 4);

      if (
        tag === TAG_EXPOSURE_TIME ||
        tag === TAG_FOCAL_LENGTH ||
        tag === TAG_F_NUMBER ||
        tag === TAG_ISO ||
        tag === TAG_LENS_MODEL ||
        tag === TAG_MAKE ||
        tag === TAG_MODEL
      ) {
        facts.hasCameraExif = true;
      }

      if (tag === TAG_EXIF_IFD && type === 4) {
        readIfd(u32(entry + 8), depth + 1);
      }

      // ASCII, and long enough that the value sits outside the entry.
      if (tag === TAG_SOFTWARE && type === 2 && length > 0) {
        const valueAt = length <= 4 ? entry + 8 : tiff + u32(entry + 8);

        if (valueAt >= 0 && valueAt + length <= end) {
          let text = "";

          for (let cursor = 0; cursor < Math.min(length, 128); cursor += 1) {
            const code = bytes[valueAt + cursor] as number;

            if (code === 0) break;

            text += String.fromCharCode(code);
          }

          facts.software = text.trim() || null;
        }
      }
    }
  };

  readIfd(u32(tiff + 4), 0);

  return facts;
}

type PngScan = { height: number | null; software: string | null; width: number | null };

/**
 * Reads a PNG's header and its text chunks.
 *
 * `Software` may arrive in any of the three text chunk types. `zTXt` is
 * deflate-compressed and deliberately not decompressed: it is vanishingly rare
 * for this key, and inflating attacker-supplied bytes on the upload path to read
 * one optional string is a trade nobody should take.
 */
function scanPng(bytes: Uint8Array): PngScan | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (bytes.length < 8 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return null;
  }

  const result: PngScan = { height: null, software: null, width: null };
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length =
      (((bytes[offset] as number) << 24) |
        ((bytes[offset + 1] as number) << 16) |
        ((bytes[offset + 2] as number) << 8) |
        (bytes[offset + 3] as number)) >>>
      0;
    let type = "";

    for (let index = 0; index < 4; index += 1) {
      type += String.fromCharCode(bytes[offset + 4 + index] as number);
    }

    const start = offset + 8;
    const end = start + length;

    if (end > bytes.length) break;

    if (type === "IHDR" && length >= 8) {
      result.width =
        (((bytes[start] as number) << 24) |
          ((bytes[start + 1] as number) << 16) |
          ((bytes[start + 2] as number) << 8) |
          (bytes[start + 3] as number)) >>>
        0;
      result.height =
        (((bytes[start + 4] as number) << 24) |
          ((bytes[start + 5] as number) << 16) |
          ((bytes[start + 6] as number) << 8) |
          (bytes[start + 7] as number)) >>>
        0;
    }

    if ((type === "iTXt" || type === "tEXt") && result.software === null) {
      let text = "";

      for (let cursor = start; cursor < Math.min(end, start + 512); cursor += 1) {
        text += String.fromCharCode(bytes[cursor] as number);
      }

      // Both chunk types are NUL-separated fields. `tEXt` is keyword then value;
      // `iTXt` inserts a compression flag, a method, a language tag and a
      // translated keyword between them — so the last non-trivial field is the
      // value in either case.
      const parts = text.split("\u0000");
      const keyword = (parts[0] ?? "").trim().toLowerCase();

      if (keyword === "software") {
        const value = parts
          .slice(1)
          .map((part) => part.trim())
          .filter((part) => part.length > 1)
          .pop();

        result.software = value ?? null;
      }
    }

    if (type === "IEND") break;

    // length + type + data + CRC
    offset = end + 4;
  }

  return result;
}

/** The container these bytes actually are, read from the bytes. */
function containerOf(bytes: Uint8Array): EvidenceProvenance["container"] {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.slice(from, to)));

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "png";

  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "webp";
  }

  if (bytes.length >= 5 && ascii(0, 5) === "%PDF-") return "pdf";

  return "other";
}

/**
 * What the file says about how it was made.
 *
 * Never throws and never rejects: a container it cannot parse produces a record
 * with nothing in it, which raises no flags. Same contract as `inspectImage` —
 * an unread file is not an accused file.
 */
export function readEvidenceProvenance(
  bytes: Buffer | Uint8Array,
): EvidenceProvenance | null {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const container = containerOf(view);

  const provenance: EvidenceProvenance = {
    container,
    editorSignature: null,
    hasCameraExif: false,
    jpegQuality: null,
    quantTablesStandard: null,
    screenshotShape: null,
    softwareTag: null,
  };

  try {
    if (container === "jpeg") {
      const scan = scanJpeg(view);

      if (!scan) return provenance;

      for (const segment of scan.segments) {
        // APP1, and it is EXIF rather than XMP.
        if (
          segment.marker === 0xe1 &&
          segment.start + 6 <= view.length &&
          String.fromCharCode(
            ...Array.from(view.slice(segment.start, segment.start + 4)),
          ) === "Exif"
        ) {
          const exif = readExif(view, segment.start, segment.end);

          provenance.hasCameraExif ||= exif.hasCameraExif;
          provenance.softwareTag ??= exif.software;
        }
      }

      if (scan.luminanceTable) {
        const analysis = analyseLuminanceTable(scan.luminanceTable);

        provenance.jpegQuality = analysis.quality;
        provenance.quantTablesStandard = analysis.standard;
      }

      if (scan.width !== null && scan.height !== null) {
        provenance.screenshotShape = isScreenShape(scan.width, scan.height);
      }
    }

    if (container === "png") {
      const scan = scanPng(view);

      if (!scan) return provenance;

      provenance.softwareTag = scan.software;

      if (scan.width !== null && scan.height !== null) {
        provenance.screenshotShape = isScreenShape(scan.width, scan.height);
      }
    }
  } catch {
    // A malformed header costs the signal, never the upload.
    return provenance;
  }

  provenance.editorSignature = editorFrom(provenance.softwareTag);

  return provenance;
}

/**
 * The amber flags this file earns, if any.
 *
 * Separate from the read because the read happens at upload and the flags are
 * asked for at claim — and because the judgement is the part worth testing on
 * its own, exactly as `matchClaimFacts` is split from the recogniser.
 */
export function provenanceFlags(
  provenance: EvidenceProvenance | null | undefined,
): string[] {
  if (!provenance) return [];

  const flags: string[] = [];

  if (provenance.editorSignature) flags.push(PROVENANCE_FLAGS.EDITOR_SIGNATURE);
  if (provenance.quantTablesStandard === false) flags.push(PROVENANCE_FLAGS.RE_ENCODED);
  if (provenance.hasCameraExif) flags.push(PROVENANCE_FLAGS.NOT_A_SCREENSHOT);
  if (provenance.screenshotShape === false) {
    flags.push(PROVENANCE_FLAGS.DIMENSIONS_UNUSUAL);
  }

  return flags;
}
