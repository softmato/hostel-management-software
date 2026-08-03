/**
 * The resident ID card, drawn on a 2D canvas.
 *
 * Canvas rather than DOM-to-image because the card is a *document*: the same
 * drawing code paints the on-screen preview and the file the resident
 * downloads, so what they save is pixel-for-pixel what they saw. It also keeps
 * the layout independent of the app's theme — a printed ID card that turns dark
 * because the viewer had dark mode on is not an ID card.
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

export type IdCardData = {
  bloodGroup?: string | null;
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
 * ink and accent, so the card still reads as HostelHub.
 */
const INK = "#04301c";
const BRAND = "#0a8a4b";
const ACCENT = "#48c98a";
const PAPER = "#ffffff";
const MUTED = "#5d6f66";
const HAIRLINE = "#d9e5dd";

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
function drawHeaderSweep(ctx: CanvasRenderingContext2D, edgeY: number, bulge: number) {
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

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, edgeY + 20);
  ctx.bezierCurveTo(
    CARD_WIDTH * 0.72,
    edgeY + bulge + 20,
    CARD_WIDTH * 0.28,
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

/** Small house mark, matching the glyph used on the auth screens. */
function drawLogoMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 24;

  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
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

function drawBrandLockup(ctx: CanvasRenderingContext2D, centerY: number) {
  ctx.textAlign = "center";
  drawLogoMark(ctx, CARD_WIDTH / 2, centerY, 44);

  ctx.fillStyle = PAPER;
  ctx.font = font(800, 30);
  ctx.letterSpacing = "3px";
  ctx.fillText("HOSTELHUB", CARD_WIDTH / 2, centerY + 60);

  ctx.fillStyle = ACCENT;
  ctx.font = font(600, 14);
  ctx.letterSpacing = "2px";
  ctx.fillText("RESIDENT IDENTITY CARD", CARD_WIDTH / 2, centerY + 88);
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

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
  ctx.stroke();
}

/* ── faces ── */

function drawFront(ctx: CanvasRenderingContext2D, data: IdCardData) {
  drawHeaderSweep(ctx, 262, 105);
  drawBrandLockup(ctx, 96);
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

  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 14);
  ctx.letterSpacing = "1px";
  ctx.fillText("SCAN TO SHARE MY DETAILS", CARD_WIDTH / 2, qrY + qrSize + 42);
  ctx.letterSpacing = "0px";

  drawFooterSweep(ctx, 946);
}

function drawBack(ctx: CanvasRenderingContext2D, data: IdCardData) {
  drawHeaderSweep(ctx, 168, 74);
  drawBrandLockup(ctx, 62);

  ctx.textAlign = "left";
  ctx.fillStyle = BRAND;
  ctx.font = font(800, 20);
  ctx.letterSpacing = "1px";
  ctx.fillText("HOW THIS CARD WORKS", 62, 336);
  ctx.letterSpacing = "0px";

  const bullets = [
    "Show the QR code to a hostel and they can fill your registration without asking you to write anything down.",
    "No personal detail is stored in the code itself — it only carries your resident ID.",
    "Turn sharing off from your account menu and the ID stops opening your details straight away.",
  ];

  let y = 380;

  for (const bullet of bullets) {
    ctx.fillStyle = ACCENT;
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
  ctx.fillText("RESIDENT ID", 62, y + 58);
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
