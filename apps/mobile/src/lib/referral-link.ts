/**
 * Reading a referral code out of a link.
 *
 * ## What the referrer actually shares
 *
 * `referral.service.ts` builds `link: "/inquiry?ref=<code>"`, which the resident
 * portal turns into `https://<site>/inquiry?ref=<code>` before copying it to the
 * clipboard. That is the link that gets pasted into Messenger, so `?ref=` is the
 * shape this has to understand — not a format invented for the app.
 *
 * The app's own scheme is `hostelhub://ref/<code>` (`app.json`), which
 * expo-router maps to `app/ref/[code].tsx` by file name, cold start and warm
 * alike. Both forms are parsed here so a code survives whichever way it arrives:
 * a tapped app link, or a web URL a friend pasted into the search box.
 *
 * ## An https link will not open the app yet
 *
 * That needs verified app links — `assetlinks.json` served from the domain and
 * `intentFilters` in `app.json` on Android, `associatedDomains` plus an AASA
 * file on iOS. None of that is configured, so a tapped `https://…/inquiry?ref=`
 * opens the browser. Parsing it here costs nothing and means the app is ready
 * the day those are set up; it is not a claim that they work now.
 *
 * ## Codes are not activation codes
 *
 * `referredInquiryCreateSchema` accepts 4–32 characters — a *different* range
 * from `activationCodeSchema`'s 6–32. Sharing one validator between the two
 * would silently reject a valid four-character referral code.
 */

/** `referredInquiryCreateSchema`: `z.string().trim().min(4).max(32)`. */
export const REFERRAL_CODE_MIN = 4;
export const REFERRAL_CODE_MAX = 32;

export function normalizeReferralCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidReferralCode(raw: string): boolean {
  const code = normalizeReferralCode(raw);

  return code.length >= REFERRAL_CODE_MIN && code.length <= REFERRAL_CODE_MAX;
}

/**
 * The referral code in a URL, or `null`.
 *
 * Handles `?ref=` on any host, the app scheme's `ref/<code>` path, and a bare
 * code. A regex rather than `URL`, which Hermes does not ship — see
 * `lib/activation-code.ts` for the same reasoning.
 */
export function parseReferralLink(raw: string): string | null {
  const link = raw.trim();

  if (!link) {
    return null;
  }

  const fromQuery = /[?&]ref(?:erral)?(?:Code)?=([^&#\s]+)/i.exec(link);

  if (fromQuery) {
    return valid(safeDecode(fromQuery[1]));
  }

  // `hostelhub://ref/ABC123`, and the `/ref/ABC123` path of any host.
  const fromPath = /(?:^|\/)ref\/([^/?#\s]+)/i.exec(link);

  if (fromPath) {
    return valid(safeDecode(fromPath[1]));
  }

  // Anything else with a scheme or a path is some other link; only a bare code
  // is left.
  if (/[:/\\?#]/.test(link)) {
    return null;
  }

  return valid(link);
}

function valid(candidate: string): string | null {
  const code = normalizeReferralCode(candidate);

  return isValidReferralCode(code) ? code : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
