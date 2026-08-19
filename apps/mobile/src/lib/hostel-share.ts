/**
 * What gets sent when someone shares a hostel.
 *
 * Pure and dependency-free, so it is testable node-side — the screen that calls
 * it imports `react-native`'s `Share`, which Vitest here cannot load (same split
 * as `lib/mime.ts` out of `lib/uploads.ts`).
 *
 * ## The link points at the website, not at the app
 *
 * A shared hostel lands in a WhatsApp thread, and most of the people in that
 * thread do not have this app. A deep link would open a store page for two of
 * them and nothing at all for the rest, whereas `/hostels/{slug}` opens for
 * everybody — and opens *into* the same listing, with the same photos and the
 * same price, because both clients render one payload.
 *
 * On a phone that does have the app installed, Android's verified App Links
 * (`apps/web/public/.well-known/assetlinks.json`, task §2.3) hand that same URL
 * back to the app. So the website URL is not a fallback: it is the address that
 * works everywhere and gets upgraded where it can be.
 *
 * ## Why the message repeats what the link already contains
 *
 * Chat apps unfurl a link when they feel like it — not on a slow connection, not
 * in every client, and never in an SMS. The name, the place and the price are
 * the three things that decide whether the recipient taps at all, so they are in
 * the text rather than left to a preview card that may not arrive.
 */

/** `https://site/hostels/green-view-hostel`. */
export function hostelPublicUrl(baseUrl: string, slug: string): string {
  // Trailing slashes stripped rather than trusted: `baseUrl` is
  // `EXPO_PUBLIC_API_URL` or a LAN address in development, and a stray slash
  // produces a `//hostels/…` path that some hosts redirect and others 404.
  return `${baseUrl.replace(/\/+$/, "")}/hostels/${encodeURIComponent(slug)}`;
}

/**
 * The shared text.
 *
 * Each line is dropped when it has nothing to say rather than printed empty —
 * a hostel with no stated price should not be shared as a hostel priced at
 * nothing, and `priceRange` returns a dash for that case, which is fine on a
 * card and reads as a typo in a message.
 */
export function buildHostelShare({
  name,
  place,
  price,
  url,
}: {
  name: string;
  /** Already formatted, e.g. `Ghattekulo, Kathmandu`. */
  place: string;
  /** Already formatted, e.g. `NPR 7,000 – 9,000`. Blank or `—` is dropped. */
  price: string;
  url: string;
}): string {
  const trimmedPrice = price.trim();
  const hasPrice = trimmedPrice !== "" && !/^[—–-]+$/.test(trimmedPrice);

  const lines = [
    name.trim(),
    place.trim(),
    hasPrice ? `${trimmedPrice} per month` : "",
  ].filter(Boolean);

  // The blank line before the URL is what keeps most chat clients from swallowing
  // the last word of the price into the link when they auto-detect it.
  return `${lines.join("\n")}\n\n${url}`;
}
