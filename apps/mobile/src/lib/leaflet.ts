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
 * The three ways to draw the world, and what each one costs.
 *
 * Every entry is a plain XYZ tile source, which is all Leaflet needs — no
 * plugin, no key, no account. What differs between them is not the URL:
 *
 * - **`attribution` is a licence condition.** Each provider requires its own
 *   credit visible on the map, so the chip in `MapExplorer` changes with the
 *   layer. It is not a caption that can be shortened to fit.
 * - **`maxZoom` is not the same everywhere.** OpenTopoMap stops at 17 where the
 *   other two reach 19, so switching to it from a closer view has to bring the
 *   map down or the reader gets a grey screen and thinks it broke.
 * - **Weight.** Satellite tiles are photographs — several times the bytes of a
 *   vector-drawn street map, over whatever mobile data the reader is paying
 *   for. That is a reason to keep Standard the default, not a reason to omit
 *   the option: from above, a hostel's actual roof and lane tell you more about
 *   where you are going than any street map does.
 *
 * Esri's path is **`{z}/{y}/{x}`** — y before x, unlike every other provider
 * here. Written the usual way round it does not error; it quietly serves tiles
 * from somewhere else entirely.
 */
export const MAP_LAYERS = [
  {
    attribution: ATTRIBUTION,
    id: "standard",
    label: "Standard",
    maxZoom: 19,
    /** OSM's own tiles use three subdomains; the others use none. */
    subdomains: "abc",
    url: TILE_URL,
  },
  {
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    id: "satellite",
    label: "Satellite",
    maxZoom: 19,
    subdomains: "",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    attribution: "© OpenStreetMap contributors, SRTM — © OpenTopoMap (CC-BY-SA)",
    id: "terrain",
    label: "Terrain",
    maxZoom: 17,
    subdomains: "abc",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  },
] as const;

export type MapLayerId = (typeof MAP_LAYERS)[number]["id"];

export function mapLayer(id: MapLayerId): (typeof MAP_LAYERS)[number] {
  return MAP_LAYERS.find((layer) => layer.id === id) ?? MAP_LAYERS[0];
}

/**
 * JSON for a `<script>` body.
 *
 * `</script>` inside a JSON string closes the tag it sits in. A hostel called
 * "</script>" is unlikely; a hostel called anything is not our call.
 */
export function inlineJson(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\u003c");
}
