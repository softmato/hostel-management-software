/**
 * The Leaflet build both maps in this app load, in one place.
 *
 * ## Why this is a module and not two copies
 *
 * Every map here is a Leaflet page inside a `WebView` — there is no Google Maps
 * key and no `react-native-maps` (see `components/hostel-map.tsx` for that
 * decision). Two components now build such a page: the hostel map and the
 * directions map. The five constants below travel as a set, and the two that
 * matter cannot be edited independently: **an SRI hash belongs to exactly one
 * version of one file.** A copy that had its version bumped and its hash left
 * behind does not throw — the browser silently refuses the script, and the map
 * renders as a blank grey box that looks exactly like being offline.
 *
 * ## `integrity` is not optional
 *
 * This is third-party JavaScript executing inside a WebView our own page hands a
 * `postMessage` bridge to. Without a subresource-integrity hash, whoever
 * controls the CDN — or anyone able to intercept it — chooses what runs next to
 * that bridge. The hashes below are Leaflet 1.9.4's published ones.
 *
 * ## Why a CDN at all
 *
 * A map is useless without a network — the tiles are remote — so bundling
 * ~150 KB into every install saves one request on a screen already making
 * dozens. Both callers render a "needs a connection" state instead.
 */

export const LEAFLET_VERSION = "1.9.4";

export const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
export const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

export const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
export const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OSM's licence requires visible attribution. It is not decoration. */
export const ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * JSON for a `<script>` body.
 *
 * `</script>` inside a JSON string closes the tag it sits in. A hostel called
 * "</script>" is unlikely; a hostel called anything is not our call.
 */
export function inlineJson(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\u003c");
}
