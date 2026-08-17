/**
 * Turning what the camera saw into the code the server wants.
 *
 * ## The QR does not contain the code
 *
 * It contains a **link**. `activationUrl()` in
 * `apps/web/src/modules/residents/activation.service.ts` renders the PNG from
 * `<app>/resident-activation?code=<code>`, so a scanner that posts the decoded
 * string straight to `/resident/activate` sends a whole URL and gets
 * `ACTIVATION_CODE_INVALID` — with nothing on screen to explain why, because the
 * code in the picture *was* correct.
 *
 * The same QR is also printed for the web flow, so this cannot be fixed by
 * changing what the QR encodes without breaking the browser path.
 *
 * ## Case and whitespace
 *
 * `hashActivationCode` hashes `code.trim().toUpperCase()`, so the server is
 * already case-insensitive. Normalising here anyway means the manual-entry field
 * shows the same thing the sticker does, and a typed lower-case code does not
 * *look* wrong while working.
 *
 * Generated codes are 8 characters of `A–Z0–9` (`generatePlainCode`), but the
 * accepted range is the validation schema's 6–32, not the generator's 8 — a
 * hand-issued or legacy code must still go through.
 */

/** `activationCodeSchema`: `z.string().trim().min(6).max(32)`. */
export const CODE_MIN = 6;
export const CODE_MAX = 32;

/** Trim, drop inner spaces, upper-case. What both entry paths run through. */
export function normalizeActivationCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * The code inside a scanned payload, or `null` if there isn't one.
 *
 * Accepts the activation URL (any host — dev is a LAN IP, production is the
 * configured domain, and pinning either would break the other), and a bare code
 * for QRs that carry only that.
 *
 * A regex rather than `URL`: Hermes ships no `URL` parser and the polyfill is
 * not installed, so `new URL()` throws on device while passing in Node — a test
 * that goes green and a screen that never scans.
 */
export function parseScannedCode(raw: string): string | null {
  const scanned = raw.trim();

  if (!scanned) {
    return null;
  }

  const fromQuery = /[?&]code=([^&#\s]+)/i.exec(scanned);

  if (fromQuery) {
    return validCode(safeDecode(fromQuery[1]));
  }

  // Not a link, so the whole payload has to be the code itself. Anything with a
  // scheme or a path is a QR for something else — a wifi config, a vCard, some
  // other product's ticket — and must not be posted as an activation attempt.
  if (/[:/\\?#]/.test(scanned)) {
    return null;
  }

  return validCode(scanned);
}

/**
 * The reason a manually typed code cannot be submitted, or `null` when it can.
 *
 * Mirrors `activationCodeSchema` so the button explains itself before a round
 * trip; the server still validates, this only saves a request and a wait.
 */
export function activationCodeError(raw: string): string | null {
  const code = normalizeActivationCode(raw);

  if (!code) {
    return "Enter the code from your activation email or sticker.";
  }

  if (code.length < CODE_MIN) {
    return `Activation codes are at least ${CODE_MIN} characters.`;
  }

  if (code.length > CODE_MAX) {
    return `Activation codes are at most ${CODE_MAX} characters.`;
  }

  return null;
}

function validCode(candidate: string): string | null {
  const code = normalizeActivationCode(candidate);

  return activationCodeError(code) === null ? code : null;
}

/** A percent-encoded code is still a code; a malformed escape is not fatal. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
