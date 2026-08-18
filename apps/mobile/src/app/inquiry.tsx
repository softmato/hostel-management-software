import { Redirect, useLocalSearchParams } from "expo-router";

import { parseReferralLink } from "@/lib/referral-link";

/**
 * `https://<site>/inquiry?ref=<code>` — the link residents actually share.
 *
 * ## Why a whole screen for a redirect
 *
 * The referrer's link is a **web** URL: `referral.service.ts` builds
 * `/inquiry?ref=<code>` and the resident portal turns it into
 * `https://<site>/inquiry?ref=<code>` before copying it to the clipboard. Once
 * verified app links are live (`/.well-known/assetlinks.json` on the web,
 * `intentFilters` in `app.json`), Android hands that URL to this app — and
 * expo-router resolves it **by path**, so it looks for `app/inquiry.tsx`.
 *
 * Without this file it finds nothing and the tap lands on `+not-found`: the app
 * opens, and shows a dead end, which is worse than having stayed in the browser.
 *
 * The referral screen itself is `app/ref/[code].tsx`, named after the app's own
 * scheme (`hostelhub://ref/<code>`). Rather than duplicate that form, this
 * translates one address for the other — one screen, two ways in.
 *
 * ## `<Redirect>`, not an effect
 *
 * It resolves during render, so nothing is drawn at this path before the move.
 * An effect would mount, paint a frame, and then navigate — a visible flash on
 * the first thing someone sees after tapping a friend's link.
 *
 * ## A missing or malformed code is not an error screen
 *
 * Someone who followed a referral link that lost its query string in a chat app
 * still wanted a hostel. They get the public app, which is a working product,
 * rather than a message about a link they did not write.
 */
export default function InquiryLinkScreen() {
  const params = useLocalSearchParams<{
    ref?: string;
    refCode?: string;
    referral?: string;
  }>();

  // Three spellings, because a link that has been through a chat app, an email
  // client and a paste is not always the one that was generated. `?ref=` is what
  // the service produces; the other two cost nothing to accept.
  const code = parseReferralLink(params.ref ?? params.referral ?? params.refCode ?? "");

  return <Redirect href={code ? `/ref/${code}` : "/(public)"} />;
}
