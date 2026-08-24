/**
 * Turning what the camera saw into a resident ID.
 *
 * ## The QR does not contain the ID
 *
 * It contains a link. `residentIdShareUrl()` in
 * `apps/web/src/modules/users/resident-identity.service.ts` builds
 * `<site>/resident-id/HH-4K7M-9XQ2`, and that string is what the card's QR
 * encodes — the same image is printed for the web flow, so it cannot be changed
 * to carry the bare id without breaking the browser path.
 *
 * ## Why the phone parses it at all, when the server would
 *
 * `normalizeResidentId` on the server accepts the same three forms and this is a
 * faithful mirror of it, tested against the same cases. The point is not to
 * replace that check but to **stop the request happening**: `onBarcodeScanned`
 * fires on every frame a code is in view, so a warden pointing the camera at a
 * bus ticket would otherwise post a lookup several times a second, burn the
 * endpoint's rate limit, and see an error toast for a QR that was never ours.
 *
 * A regex rather than `URL`: Hermes ships no `URL` parser and the polyfill is
 * not installed here, so `new URL()` throws on device while passing in Node —
 * a green test and a screen that never scans. Same trap as
 * `lib/activation-code.ts`.
 */

/**
 * The resident ID inside a scanned payload, or `null` if there is not one.
 *
 * Accepts the share URL on any host (dev is a LAN IP, production is the
 * configured domain, and pinning either breaks the other), a hand-typed
 * `hh 4k7m-9xq2`, and the canonical `HH-4K7M-9XQ2`. Always returns the
 * canonical form.
 */
export function normalizeResidentId(value: string): string | null {
  // Query and hash go first, or `/resident-id/HH-…?utm=qr` would resolve to the
  // tracking parameter instead of the id.
  const path = value.trim().split(/[?#]/)[0] ?? "";
  const tail = path.split("/").filter(Boolean).pop() ?? path;
  const compact = tail.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!/^HH[A-Z0-9]{8}$/.test(compact)) {
    return null;
  }

  return `HH-${compact.slice(2, 6)}-${compact.slice(6, 10)}`;
}

/**
 * The reason a typed id cannot be looked up, or `null` when it can.
 *
 * The manual field is not a fallback for a broken camera so much as the other
 * half of the feature: a cracked screen, a photocopied card, a phone whose
 * camera permission was refused months ago, and a card read out over the phone
 * all end here.
 */
export function residentIdError(raw: string): string | null {
  if (!raw.trim()) {
    return "Type the ID printed under the QR on their card.";
  }

  return normalizeResidentId(raw)
    ? null
    : "That is not a resident ID. It reads like HH-4K7M-9XQ2.";
}

/** What the manual field shows while it is being typed: upper case, no spaces. */
export function formatResidentIdInput(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
