/**
 * The three ways to draw the world, and what each one costs.
 *
 * Ported from `apps/mobile/src/lib/leaflet.ts` — without the CDN URLs, the SRI
 * hashes and `inlineJson`, all of which exist only because the phone runs
 * Leaflet inside a WebView from a script tag. Here it is an npm dependency in
 * the same bundle as the React tree, so there is no third-party script to pin
 * and no JSON to escape into one.
 *
 * Every entry is a plain XYZ tile source, which is all Leaflet needs — no
 * plugin, no key, no account. What differs between them is not the URL:
 *
 * - **`attribution` is a licence condition.** Each provider requires its own
 *   credit visible on the map, so the chip on the canvas changes with the
 *   layer. It is not a caption that can be shortened to fit.
 * - **`maxZoom` is not the same everywhere.** OpenTopoMap stops at 17 where the
 *   other two reach 19, so switching to it from a closer view has to bring the
 *   map down or the reader gets a grey screen and thinks it broke.
 * - **Weight.** Satellite tiles are photographs — several times the bytes of a
 *   vector-drawn street map. That is a reason to keep Standard the default, not
 *   a reason to omit the option: from above, a hostel's actual roof and lane
 *   tell you more about where you are going than any street map does.
 *
 * Esri's path is **`{z}/{y}/{x}`** — y before x, unlike every other provider
 * here. Written the usual way round it does not error; it quietly serves tiles
 * from somewhere else entirely.
 */

export const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OSM's licence requires visible attribution. It is not decoration. */
export const ATTRIBUTION = "© OpenStreetMap contributors";

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
