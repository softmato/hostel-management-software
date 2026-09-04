/**
 * The platform ID card, drawn on a 2D canvas.
 *
 * One template, three variants — resident, hostel owner and service provider.
 * They share the palette, the geometry and every field position, and differ
 * only in the accent shade, the header curve, the logo glyph and the copy, so
 * the three read as one family of documents issued by the same platform. A
 * resident who is approved as an owner or provider keeps their ID and simply
 * gets re-issued in the matching variant.
 *
 * Canvas rather than DOM-to-image because the card is a *document*: the same
 * drawing code paints the on-screen preview, the file the holder downloads, and
 * the PNG attached to their approval email, so all three are pixel-for-pixel
 * identical. It also keeps the layout independent of the app's theme — a
 * printed ID card that turns dark because the viewer had dark mode on is not an
 * ID card.
 *
 * Every image handed in here MUST be same-origin (or a `data:` URL). A
 * cross-origin one taints the canvas and makes `toBlob()` throw, which is why
 * the photo is proxied through /api/v1/users/resident-identity/photo rather than
 * linked straight to R2.
 */

/** Logical drawing units. Roughly ID-1 portrait (54 × 86 mm). */
export const CARD_WIDTH = 640;
export const CARD_HEIGHT = 1000;

export type IdCardFace = "front" | "back";

/**
 * Which variant of the card to draw. Derived from what the platform has
 * approved the holder for, never stored separately — see
 * `resolvePlatformIdCard`.
 */
export type PlatformIdCardType = "RESIDENT" | "HOSTEL_OWNER" | "SERVICE_PROVIDER";

export type IdCardData = {
  bloodGroup?: string | null;
  /** Platform name from the owner's site config — printed on the card header. */
  brandName: string;
  /** Defaults to the resident variant when a caller has nothing better. */
  cardType?: PlatformIdCardType;
  dateOfBirth?: string | null;
  email?: string | null;
  fullName: string;
  /** Preformatted — the renderer does no date maths. */
  issuedOn: string;
  phone?: string | null;
  photo?: HTMLImageElement | null;
  qr?: HTMLImageElement | null;
  residentId: string;
  role: string;
  siteLabel: string;
};

/*
 * Fixed palette, not theme tokens: see the note above about dark mode. The
 * greens are the brand's (--brand-teal is #0a8a4b) darkened and lightened for
 * ink and accent, so every variant still reads as the same platform.
 */
const INK = "#04301c";
const BRAND = "#0a8a4b";
const ACCENT = "#48c98a";
const PAPER = "#ffffff";
const MUTED = "#5d6f66";
const HAIRLINE = "#d9e5dd";

/**
 * The per-variant deltas. Accents stay inside the brand green so the three
 * cards are recognisably the same document; everything that changes is there to
 * tell them apart at a glance across a desk.
 */
type CardVariant = {
  accent: string;
  /** How far the header's bottom edge bows — the variant's silhouette. */
  bulge: { back: number; front: number };
  backBullets: string[];
  idLabel: string;
  logo: "house" | "building" | "tools";
  title: string;
};

const VARIANTS: Record<PlatformIdCardType, CardVariant> = {
  HOSTEL_OWNER: {
    accent: "#2fae72",
    backBullets: [
      "Show this card to confirm you are the registered owner of your hostel on the platform.",
      "No hostel or resident detail is stored in the code itself — it only carries your platform ID.",
      "Report a lost card from your account menu and the ID stops resolving straight away.",
    ],
    bulge: { back: 30, front: 44 },
    idLabel: "OWNER ID",
    logo: "building",
    title: "HOSTEL OWNER IDENTITY CARD",
  },
  RESIDENT: {
    accent: ACCENT,
    backBullets: [
      "Show the QR code to a hostel and they can fill your registration without asking you to write anything down.",
      "No personal detail is stored in the code itself — it only carries your resident ID.",
      "Turn sharing off from your account menu and the ID stops opening your details straight away.",
    ],
    bulge: { back: 74, front: 105 },
    idLabel: "RESIDENT ID",
    logo: "house",
    title: "RESIDENT IDENTITY CARD",
  },
  SERVICE_PROVIDER: {
    accent: "#6fdda6",
    backBullets: [
      "Show this card when you arrive for a job so the hostel can confirm you are a verified provider.",
      "No job or resident detail is stored in the code itself — it only carries your platform ID.",
      "Hostels send you jobs in the provider mobile app you signed in to with this ID.",
    ],
    bulge: { back: 0, front: 0 },
    idLabel: "PROVIDER ID",
    logo: "tools",
    title: "SERVICE PROVIDER IDENTITY CARD",
  },
};

function variantOf(data: IdCardData) {
  return VARIANTS[data.cardType ?? "RESIDENT"];
}

/**
 * What to call this card in prose — "your **resident** ID card". Kept beside
 * the variants so a new card type cannot be added without naming it.
 */
const CARD_NOUNS: Record<PlatformIdCardType, string> = {
  HOSTEL_OWNER: "hostel owner",
  RESIDENT: "resident",
  SERVICE_PROVIDER: "service provider",
};

export function idCardNoun(cardType: PlatformIdCardType = "RESIDENT") {
  return CARD_NOUNS[cardType];
}

const SANS = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

const font = (weight: number, size: number) => `${weight} ${size}px ${SANS}`;

/* ── geometry helpers ── */

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Truncates with an ellipsis so a long email can never run off the card. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let clipped = text;

  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }

  return `${clipped}…`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;

    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

/* ── shared chrome ── */

/**
 * The signature curve of the reference template: a dark block whose bottom edge
 * bulges downward, trailed by a lighter accent stroke.
 */
function drawHeaderSweep(
  ctx: CanvasRenderingContext2D,
  edgeY: number,
  bulge: number,
  accent: string,
) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(CARD_WIDTH, 0);
  ctx.lineTo(CARD_WIDTH, edgeY);
  ctx.bezierCurveTo(
    CARD_WIDTH * 0.72,
    edgeY + bulge,
    CARD_WIDTH * 0.28,
    edgeY + bulge,
    0,
    edgeY,
  );
  ctx.closePath();
  ctx.fill();

  // The same curve, 20 lower. The control points are mirrored against the fill's
  // because this is drawn left to right and that one right to left — copying
  // them across unchanged made the stroke reach its full depth by a third of the
  // way in and then run along the fill's edge, pinching against it instead of
  // trailing it.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, edgeY + 20);
  ctx.bezierCurveTo(
    CARD_WIDTH * 0.28,
    edgeY + bulge + 20,
    CARD_WIDTH * 0.72,
    edgeY + bulge + 20,
    CARD_WIDTH,
    edgeY + 20,
  );
  ctx.stroke();
}

function drawFooterSweep(ctx: CanvasRenderingContext2D, edgeY: number) {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, CARD_HEIGHT);
  ctx.lineTo(0, edgeY + 40);
  ctx.bezierCurveTo(
    CARD_WIDTH * 0.28,
    edgeY - 30,
    CARD_WIDTH * 0.72,
    edgeY - 30,
    CARD_WIDTH,
    edgeY + 40,
  );
  ctx.lineTo(CARD_WIDTH, CARD_HEIGHT);
  ctx.closePath();
  ctx.fill();
}

/**
 * The variant's glyph, drawn in a 24×24 box: the auth screens' house for a
 * resident, a taller block for an owner, a crossed tool for a provider.
 */
function drawLogoMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  variant: CardVariant,
) {
  const s = size / 24;

  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = variant.accent;
  ctx.beginPath();

  if (variant.logo === "building") {
    // Two stacked blocks with a doorway — a property, not a home.
    ctx.rect(4, 4, 7, 17);
    ctx.rect(13, 9, 7, 12);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillRect(6, 14, 3, 7);
    ctx.restore();
    return;
  }

  if (variant.logo === "tools") {
    // A wrench laid across a bar: the trade mark.
    ctx.moveTo(4, 18);
    ctx.lineTo(14, 8);
    ctx.lineTo(17, 11);
    ctx.lineTo(7, 21);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(18, 7, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(19.5, 5.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.moveTo(3, 9.5);
  ctx.lineTo(12, 3);
  ctx.lineTo(21, 9.5);
  ctx.lineTo(21, 20);
  ctx.quadraticCurveTo(21, 21, 20, 21);
  ctx.lineTo(14, 21);
  ctx.lineTo(14, 14);
  ctx.lineTo(10, 14);
  ctx.lineTo(10, 21);
  ctx.lineTo(4, 21);
  ctx.quadraticCurveTo(3, 21, 3, 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBrandLockup(
  ctx: CanvasRenderingContext2D,
  centerY: number,
  brandName: string,
  variant: CardVariant,
) {
  ctx.textAlign = "center";
  drawLogoMark(ctx, CARD_WIDTH / 2, centerY, 44, variant);

  ctx.fillStyle = PAPER;
  ctx.font = font(800, 30);
  ctx.letterSpacing = "3px";
  ctx.fillText(
    ellipsize(ctx, brandName.toUpperCase(), CARD_WIDTH - 80),
    CARD_WIDTH / 2,
    centerY + 60,
  );

  ctx.fillStyle = variant.accent;
  ctx.font = font(600, 14);
  ctx.letterSpacing = "2px";
  ctx.fillText(
    ellipsize(ctx, variant.title, CARD_WIDTH - 80),
    CARD_WIDTH / 2,
    centerY + 88,
  );
  ctx.letterSpacing = "0px";
}

function initialsOf(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase() || "?";
}

function drawPortrait(
  ctx: CanvasRenderingContext2D,
  data: IdCardData,
  cx: number,
  cy: number,
  radius: number,
) {
  // White ring, so the portrait reads as a cut-out wherever the sweep lands.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  if (data.photo && data.photo.naturalWidth > 0) {
    // Cover-crop: fill the circle without ever squashing a face.
    const { naturalHeight: ih, naturalWidth: iw } = data.photo;
    const side = Math.min(iw, ih);

    ctx.drawImage(
      data.photo,
      (iw - side) / 2,
      (ih - side) / 2,
      side,
      side,
      cx - radius,
      cy - radius,
      radius * 2,
      radius * 2,
    );
  } else {
    ctx.fillStyle = "#e4f2ea";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = BRAND;
    ctx.font = font(800, radius * 0.8);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(data.fullName), cx, cy + 2);
    ctx.textBaseline = "alphabetic";
  }

  ctx.restore();

  ctx.strokeStyle = variantOf(data).accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
  ctx.stroke();
}

/* ── faces ── */

function drawFront(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const variant = variantOf(data);

  drawHeaderSweep(ctx, 262, variant.bulge.front, variant.accent);
  drawBrandLockup(ctx, 96, data.brandName, variant);
  drawPortrait(ctx, data, CARD_WIDTH / 2, 322, 94);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = font(800, 38);
  ctx.fillText(ellipsize(ctx, data.fullName, CARD_WIDTH - 80), CARD_WIDTH / 2, 478);

  ctx.fillStyle = BRAND;
  ctx.font = font(700, 19);
  ctx.letterSpacing = "2px";
  ctx.fillText(
    ellipsize(ctx, data.role.toUpperCase(), CARD_WIDTH - 96),
    CARD_WIDTH / 2,
    510,
  );
  ctx.letterSpacing = "0px";

  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(120, 538);
  ctx.lineTo(CARD_WIDTH - 120, 538);
  ctx.stroke();

  const rows: Array<[string, string]> = [
    ["ID NO", data.residentId],
    ["DOB", data.dateOfBirth || "—"],
    ["BLOOD", data.bloodGroup || "—"],
    ["PHONE", data.phone || "—"],
    ["E-MAIL", data.email || "—"],
  ];

  const labelX = 78;
  const valueX = 232;
  let y = 578;

  ctx.textAlign = "left";

  for (const [label, value] of rows) {
    ctx.fillStyle = BRAND;
    ctx.font = font(800, 17);
    ctx.fillText(label, labelX, y);

    ctx.fillStyle = MUTED;
    ctx.font = font(600, 17);
    ctx.fillText(":", valueX - 16, y);

    ctx.fillStyle = INK;
    ctx.font = font(600, 17);
    ctx.fillText(ellipsize(ctx, value, CARD_WIDTH - valueX - 70), valueX, y);

    y += 38;
  }

  // The QR replaces the reference template's barcode — it is the whole point of
  // the card, so it gets the full width of the lower block.
  const qrSize = 158;
  const qrX = (CARD_WIDTH - qrSize) / 2;
  const qrY = 752;

  ctx.fillStyle = PAPER;
  roundedRectPath(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 16);
  ctx.fill();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  if (data.qr) {
    ctx.drawImage(data.qr, qrX, qrY, qrSize, qrSize);
  }

  drawFooterSweep(ctx, 946);

  // Printed *on* the footer, in paper, and drawn after it.
  //
  // The QR block ends at 922 and the sweep's crown reaches 933, so there is no
  // white left to caption into — which is why this line used to be painted in
  // MUTED and then buried under the sweep on the very next call. It was invisible
  // on the preview, the download and the emailed PNG alike. Nothing about the
  // layout needed to move; the caption just belongs to the dark band.
  ctx.textAlign = "center";
  ctx.fillStyle = PAPER;
  ctx.font = font(600, 14);
  ctx.letterSpacing = "1px";
  ctx.fillText("SCAN TO SHARE MY DETAILS", CARD_WIDTH / 2, qrY + qrSize + 42);
  ctx.letterSpacing = "0px";
}

function drawBack(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const variant = variantOf(data);

  drawHeaderSweep(ctx, 168, variant.bulge.back, variant.accent);
  drawBrandLockup(ctx, 62, data.brandName, variant);

  ctx.textAlign = "left";
  ctx.fillStyle = BRAND;
  ctx.font = font(800, 20);
  ctx.letterSpacing = "1px";
  ctx.fillText("HOW THIS CARD WORKS", 62, 336);
  ctx.letterSpacing = "0px";

  let y = 380;

  for (const bullet of variant.backBullets) {
    ctx.fillStyle = variant.accent;
    ctx.beginPath();
    ctx.arc(70, y - 6, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = MUTED;
    ctx.font = font(500, 16);

    for (const line of wrapLines(ctx, bullet, CARD_WIDTH - 160)) {
      ctx.fillText(line, 92, y);
      y += 24;
    }

    y += 18;
  }

  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(62, y + 6);
  ctx.lineTo(CARD_WIDTH - 62, y + 6);
  ctx.stroke();

  ctx.fillStyle = BRAND;
  ctx.font = font(800, 14);
  ctx.letterSpacing = "2px";
  ctx.fillText(variant.idLabel, 62, y + 58);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = INK;
  ctx.font = font(800, 30);
  ctx.letterSpacing = "2px";
  ctx.fillText(data.residentId, 62, y + 96);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = MUTED;
  ctx.font = font(500, 15);
  ctx.fillText(`Issued ${data.issuedOn}`, 62, y + 126);

  // Signature rule, as on the reference back face.
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(62, 812);
  ctx.lineTo(320, 812);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = MUTED;
  ctx.font = font(600, 14);
  ctx.fillText("Cardholder signature", 62, 838);

  ctx.fillStyle = INK;
  ctx.font = font(700, 15);
  ctx.fillText(data.siteLabel, 62, 892);

  drawFooterSweep(ctx, 946);
}

/* ── public API ── */

/** Draws one face into the current transform, in CARD_WIDTH × CARD_HEIGHT units. */
export function drawIdCard(
  ctx: CanvasRenderingContext2D,
  data: IdCardData,
  face: IdCardFace,
) {
  ctx.save();
  roundedRectPath(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 30);
  ctx.clip();

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.textBaseline = "alphabetic";

  if (face === "front") {
    drawFront(ctx, data);
  } else {
    drawBack(ctx, data);
  }

  ctx.restore();
}

/**
 * Paints a face onto a real canvas element at `scale`× the logical size, sizing
 * the backing store for the device pixel ratio so the card is not soft on a
 * retina screen.
 */
export function paintIdCard(
  canvas: HTMLCanvasElement,
  data: IdCardData,
  face: IdCardFace,
  scale = 2,
) {
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return;
  }

  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawIdCard(ctx, data, face);
}

/**
 * Loads an image for the card. Resolves `null` instead of rejecting: a missing
 * photo or an unavailable QR should degrade the card, never break it.
 */
export function loadCardImage(src: string | null | undefined) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }

    const image = new Image();
    // Same-origin already, but this keeps the canvas untainted if the photo ever
    // moves to a CORS-enabled bucket.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * Both faces on one sheet, the way the template is presented — what the
 * "Download" button saves.
 */
export function renderIdCardSheet(data: IdCardData, scale = 2): Promise<Blob | null> {
  const gap = 56;
  const pad = 56;
  const canvas = document.createElement("canvas");
  canvas.width = (pad * 2 + CARD_WIDTH * 2 + gap) * scale;
  canvas.height = (pad * 2 + CARD_HEIGHT) * scale;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return Promise.resolve(null);
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = "#eef4f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const [index, face] of (["front", "back"] as const).entries()) {
    ctx.save();
    ctx.translate(pad + index * (CARD_WIDTH + gap), pad);
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(4, 48, 28, 0.18)";
    ctx.shadowOffsetY = 8;
    roundedRectPath(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 30);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    drawIdCard(ctx, data, face);
    ctx.restore();
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
