import { PLATFORM_SITE_URL } from "@hostel/shared/brand/brand";

/**
 * Canonical public base URL for absolute links (SEO metadata, sitemap, robots).
 * Falls back to localhost for local dev. Trailing slash stripped so callers can
 * safely template `${siteUrl()}/path`.
 */
export function siteUrl() {
  const raw =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return raw.replace(/\/+$/, "");
}

/**
 * An address nobody outside this network can reach: `localhost`, a loopback or
 * private-range IP, a `.local` name. The LAN address the phone uses to talk to
 * a dev server belongs here too — it works on the desk and nowhere else.
 */
const PRIVATE_HOST =
  /^(https?:\/\/)?(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|[^/]*\.local)(:\d+)?$/i;

/**
 * The base URL a link may carry **out of this process** — into an email, a push
 * payload or a printed paper.
 *
 * Never localhost. `siteUrl()` answers for the browser that is already here, so
 * falling back to this machine's own address is right for a canonical tag and
 * wrong for everything else: mail is read on a phone, hours later, where
 * `http://localhost:3000/bookings/...` is a dead link. Every such link was dead
 * whenever it was sent from a developer's machine, and it failed silently — the
 * mail sent, the recipient just could not open it.
 *
 * So an address only this machine can resolve is replaced by the real site.
 * Configure `APP_URL` in production and this is a no-op there.
 */
export function outboundUrl() {
  const base = siteUrl();

  return PRIVATE_HOST.test(base) ? PLATFORM_SITE_URL : base;
}
