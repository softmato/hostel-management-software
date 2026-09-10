/**
 * Every call this platform makes to a map provider, with a deadline on it.
 *
 * Nominatim, Overpass and Google Places are all third parties on the far side
 * of the internet, and Overpass's public mirrors in particular answer 504 or
 * simply accept the connection and go quiet under load. `fetch` has no timeout
 * of its own, so an unanswered request holds the caller open indefinitely.
 *
 * That was survivable while these ran only from a profile save and a nightly
 * cron. It stopped being survivable when publishing a hostel started geocoding:
 * a team agent is standing in a lobby with the owner, having just taken their
 * money, and the registration must not hang because a free OpenStreetMap mirror
 * in Germany is busy. A bounded wait that gives up and lets the nightly sweep
 * retry is the correct trade — the listing is better with a map and is not worth
 * a stalled submit.
 *
 * Returns null instead of throwing on a timeout or a transport error, because
 * every caller already treats "no response" as "try the next provider".
 */
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchUpstream(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};

  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) }).catch(
    () => null,
  );
}
