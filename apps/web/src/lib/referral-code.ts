/**
 * The `?ref=` code on `/inquiry`.
 *
 * ## Why this exists
 *
 * `referral.service.ts` has been handing every resident a `/inquiry?ref=<code>`
 * link to share since referrals shipped. The inquiry page read `hostel` and
 * `room` and ignored `ref` entirely, and nothing outside a test ever called
 * `POST /public/inquiries/with-referral` — so every referral shared until now
 * was filed as an ordinary inquiry against whichever hostel the page happened to
 * default to, and the referrer was never credited. The mobile app's
 * `app/ref/[code].tsx` was the first real consumer; this is the web half.
 *
 * ## The range is the server's, and it is not the activation range
 *
 * `referredInquiryCreateSchema` accepts 4–32 characters. `activationCodeSchema`
 * accepts 6–32. Sharing one validator between the two would silently reject a
 * valid four-character referral code, so the two stay separate on purpose —
 * `apps/mobile/src/lib/referral-link.ts` carries the same note.
 *
 * Validating here rather than posting whatever arrived keeps a mistyped or
 * truncated link out of a 400 that reads as "the form is broken": a link the
 * page cannot make sense of gets the ordinary inquiry flow instead, which still
 * works.
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
 * The referral code carried by a URL's query string, or `null`.
 *
 * Accepts the `ref` the service actually generates plus the two spellings a
 * hand-edited link tends to grow (`referral`, `refCode`), because the cost of
 * accepting them is nothing and the cost of missing one is a dropped referral
 * that nobody can see was dropped.
 */
export function readReferralCode(
  params: Pick<URLSearchParams, "get"> | null | undefined,
): string | null {
  if (!params) {
    return null;
  }

  for (const key of ["ref", "referral", "refCode"]) {
    const raw = params.get(key);

    if (raw && isValidReferralCode(raw)) {
      return normalizeReferralCode(raw);
    }
  }

  return null;
}
