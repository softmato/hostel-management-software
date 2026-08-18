/**
 * A JS-only stand-in for `@react-native-community/netinfo`.
 *
 * `pusher-js/react-native` imports netinfo **at module load** — its
 * `net_info.ts` ends with `export var Network = new NetInfo()`, whose
 * constructor calls `fetch()` and `addEventListener()` immediately. So the very
 * first `require("pusher-js/react-native")` crashes without this file, before a
 * single line of our realtime code runs.
 *
 * Installing netinfo for real would drop the app out of Expo Go — it is not one
 * of Expo Go's bundled native modules — and the whole app would then need a dev
 * build to open at all, to answer a question Pusher already answers for itself.
 * Its socket reconnects on its own with backoff, and `lib/realtime.ts`
 * reconnects on foreground. Reachability here is an optimisation, not a
 * requirement.
 *
 * ## What Pusher actually reads
 *
 * `connectionState.type`, lower-cased and compared to `"none"` — **not**
 * `isConnected`, which is the field anyone would guess and which Pusher would
 * silently treat as always-online. Returning `"unknown"` reports online, which
 * is the behaviour we want: a wrong "offline" would stop it trying, whereas a
 * wrong "online" just fails a connection attempt it then retries.
 *
 * Deliberately plain JS, not TypeScript: it is resolved by Metro through
 * `resolveRequest` in `metro.config.js`, not imported by our source, so nothing
 * typechecks it and a `.ts` extension would only imply otherwise.
 */

const STATE = { isConnected: true, isInternetReachable: true, type: "unknown" };

function fetchState() {
  return Promise.resolve(STATE);
}

/** Returns the unsubscribe function netinfo's real API returns. */
function addEventListener() {
  return () => {};
}

const NetInfo = {
  addEventListener,
  configure: () => {},
  fetch: fetchState,
  refresh: fetchState,
  useNetInfo: () => STATE,
};

module.exports = NetInfo;
module.exports.default = NetInfo;
module.exports.addEventListener = addEventListener;
module.exports.fetch = fetchState;
