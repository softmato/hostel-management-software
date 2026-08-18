/**
 * What a referral screen says, and what a share actually sends.
 *
 * Pure, so it can be tested — `lib/referral-link.ts` is the sibling that *parses*
 * an incoming link; this one composes the outgoing message and the wording.
 *
 * ## Why the share sends the code and not the web link
 *
 * `serializeReferralCode` builds `link: "/inquiry?ref=<code>"`, and the resident
 * portal copies that to the clipboard. **The page it points at ignores `ref`.**
 * `public-inquiry-page.tsx` reads `hostel` and `room` from the query string and
 * nothing else, and `/public/inquiries/with-referral` — the one endpoint that
 * credits a referral — is called only by this app and one test. So a friend who
 * follows that link files an ordinary inquiry and the referrer is never credited.
 * Verified again on 2026-08-17; it is a §1 row in `docs/MOBILE_APP_PHASES.md`.
 *
 * The **code** works today by two routes that do not depend on that page:
 * `app/ref/[code].tsx` in this app, and `linkReferralOnRegistration`, which
 * attaches a walk-in registration to a code the warden types at the desk. So the
 * share leads with the code and tells the friend what to do with it. Putting the
 * link in the message would be shipping a control that silently does nothing —
 * and here "nothing" means the resident quietly loses a reward they earned.
 *
 * When the web page starts reading `?ref=`, add the link back to
 * {@link buildReferralShare} and delete this paragraph.
 */

import { formatMoney } from "@/lib/format";
import type { ReferralStatus, ReferralSummary } from "@/lib/referral-api";

/** `app.json`'s `scheme`. The deep link `app/ref/[code].tsx` answers. */
const APP_SCHEME = "hostelhub";

/** `hostelhub://ref/<code>` — what this app opens `app/ref/[code].tsx` with. */
export function referralAppLink(code: string): string {
  return `${APP_SCHEME}://ref/${encodeURIComponent(code)}`;
}

/**
 * The stored link resolved against an origin.
 *
 * `link` is relative so one row is correct on localhost, on vercel.app and on a
 * custom domain — the same reasoning as the stored media URLs in `lib/media.ts`,
 * and the same problem on a phone, which has no page origin to resolve against.
 * `API_BASE_URL` is the right base because `apps/web` serves both the API and the
 * site.
 *
 * Kept even though {@link buildReferralShare} does not use it: the screen shows
 * the resident what their link *is*, and the day the web reads `?ref=` this is
 * what gets shared.
 */
export function referralShareUrl(link: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = link.startsWith("/") ? link : `/${link}`;

  return `${base}${path}`;
}

/**
 * Human words for `Referral.status`.
 *
 * `humanizeEnum` would render `INQUIRY_CREATED` as "Inquiry created", which is the
 * database's view of the event rather than the referrer's: what they care about is
 * that their friend has been in touch and nothing has happened yet.
 */
const STATUS_LABELS: Record<ReferralStatus, string> = {
  CANCELLED: "Cancelled",
  INQUIRY_CREATED: "Inquiry sent",
  JOINED: "Joined the hostel",
  REWARDED: "Rewarded",
};

export function referralStatusLabel(status: string): string {
  return STATUS_LABELS[status as ReferralStatus] ?? status;
}

/**
 * The message the share sheet sends.
 *
 * One string rather than a `{ message, url }` pair: `Share.share` on Android
 * ignores `url` entirely and only sends `message`, so anything important has to be
 * in the text or it reaches nobody on the platform this app ships to first.
 */
export function buildReferralShare({
  code,
  hostelName,
}: {
  code: string;
  /** Named when the resident's own hostel is known — it never has to be guessed. */
  hostelName?: string | null;
}): string {
  const place = hostelName?.trim() ? hostelName.trim() : "my hostel";

  return [
    `Looking for a room? Use my referral code ${code} at ${place}.`,
    "",
    `Give the code when you register, or enter it in the ${APP_SCHEME} app when you send your inquiry, and we both get credited.`,
  ].join("\n");
}

/**
 * The rewards sentence, following the web's copy.
 *
 * Approved and paid are added together because both are money the hostel has
 * committed to; `PENDING` deliberately is not, since an unapproved reward is a
 * request, not an amount. Nothing is automatic — a hostel records these by hand,
 * and the wording has to keep that expectation honest.
 */
export function describeRewards(
  summary: Pick<ReferralSummary, "rewardApprovedAmount" | "rewardPaidAmount">,
  rewardCount: number,
): string {
  const total = summary.rewardApprovedAmount + summary.rewardPaidAmount;

  if (total <= 0) {
    return "No rewards recorded yet — your hostel adds these by hand once a referral converts.";
  }

  const across =
    rewardCount === 1 ? "1 referral" : `${rewardCount} referrals`;

  return `You have earned ${formatMoney(total)} across ${across}. Your hostel applies rewards manually.`;
}

/**
 * The three tiles the web shows, with its hint copy.
 *
 * `converted` is the one tied to real money — a verified first payment — so its
 * hint says exactly that rather than something vaguer that reads as a synonym for
 * "joined".
 */
export function referralTiles(
  summary: ReferralSummary,
): { hint: string; label: string; value: number }[] {
  return [
    { hint: "Friends you referred", label: "Sent", value: summary.sent },
    { hint: "Registered at the hostel", label: "Joined", value: summary.joined },
    { hint: "First payment verified", label: "Converted", value: summary.converted },
  ];
}
