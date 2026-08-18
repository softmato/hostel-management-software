import { useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { boundsCenter, type Coordinates, hostelCoordinates } from "@/lib/geo";
import { priceRange } from "@/lib/hostel-display";
import type { PublicHostel } from "@/lib/public-api";

/**
 * Hostels on a map — Leaflet and OpenStreetMap tiles, inside a `WebView`.
 *
 * ## Why not `react-native-maps`
 *
 * It needs a Google Maps **Android** API key, and there is none: `.env` carries
 * `GOOGLE_CLIENT_ID`, which is OAuth and unrelated. Getting one means a billing
 * account, a key to rotate, and a per-load cost on a screen we want everyone to
 * open. The web app already made this call — `components/maps/leaflet-map.tsx`
 * draws the same OSM tiles — so this matches what the product already ships
 * rather than introducing a second map provider for one platform.
 *
 * The trade is real and worth naming: a WebView is heavier than a native map
 * view, pinch and pan are the browser's rather than the platform's, and the
 * whole thing is blank without a network. That last one is why the map is an
 * addition to the distance sort and never the only way to see nearby hostels —
 * the list is sorted with or without this.
 *
 * ## The HTML is built once per data change
 *
 * `source={{ html }}` remounts the WebView whenever the string changes, which
 * throws away the user's pan and zoom. So the markup is memoised on the marker
 * payload, not rebuilt every render.
 *
 * ## Tiles stay light in dark mode
 *
 * The usual trick — `filter: invert(1) hue-rotate(180deg)` — turns parks purple
 * and makes labels unreadable at small sizes. A light map in a dark app reads as
 * a photo, which is what a map is; an inverted one reads as broken.
 */

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OSM's licence requires visible attribution. It is not decoration. */
const ATTRIBUTION = "© OpenStreetMap contributors";

/*
 * Leaflet, from unpkg.
 *
 * ## Why a CDN is acceptable here and not everywhere
 *
 * The map is useless without a network anyway — the tiles are remote — so a
 * bundled copy would add ~150 KB to every install to save one request on a
 * screen that is already making dozens. The list is always there with or without
 * this component, and `renderError` says so.
 *
 * ## `integrity` is not optional
 *
 * This is third-party JavaScript executing inside a WebView that our own page
 * hands a `postMessage` bridge to. Without a subresource-integrity hash, whoever
 * controls the CDN — or anyone able to intercept it — chooses what runs next to
 * that bridge. The hashes below are Leaflet 1.9.4's published ones; a mismatch
 * makes the browser refuse the file, which fails to the empty-map state rather
 * than to running something unverified.
 *
 * Changing the version means changing the hashes in the same edit. A stale hash
 * looks exactly like an offline device.
 */
const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS_SRI =
  "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_SRI =
  "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

type Marker = {
  lat: number;
  lng: number;
  name: string;
  price: string;
  slug: string;
};

export function HostelMap({
  fill = false,
  height = 260,
  hostels,
  me,
  onSelect,
}: {
  /**
   * Take the whole space the parent gives instead of a fixed `height`, for the
   * browse screen's Map view where the map *is* the page.
   *
   * A parent using this must not be scrollable: a full-bleed map inside a
   * vertical `ScrollView` puts two pan gestures on the same pixels and the map
   * loses roughly half of them, which reads as the map being unresponsive
   * rather than as a gesture conflict.
   */
  fill?: boolean;
  /** Ignored when `fill` is set. */
  height?: number;
  hostels: PublicHostel[];
  /** The device's position, when it has been given. Drawn as a separate dot. */
  me: Coordinates | null;
  onSelect: (slug: string) => void;
}) {
  const { colors } = useAppTheme();
  const webviewRef = useRef<WebView>(null);

  const markers = useMemo<Marker[]>(
    () =>
      hostels.flatMap((hostel) => {
        const point = hostelCoordinates(hostel);

        // An un-geocoded hostel has no pin. It is still in the list below —
        // dropping it from the map is honest, dropping it from both is not.
        return point
          ? [
              {
                lat: point.lat,
                lng: point.lng,
                name: hostel.name,
                price: priceRange(hostel.pricing),
                slug: hostel.slug,
              },
            ]
          : [];
      }),
    [hostels],
  );

  const html = useMemo(
    () => buildHtml(markers, me, colors.primary, colors.background),
    [colors.background, colors.primary, markers, me],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    const slug = event.nativeEvent.data;

    // The page only ever posts a slug it was given, but it is still untrusted
    // input crossing a bridge, so it is matched against the markers rather
    // than pushed into a route.
    if (markers.some((marker) => marker.slug === slug)) {
      onSelect(slug);
    }
  };

  if (markers.length === 0) {
    return (
      <View
        className={`items-center justify-center rounded-2xl border border-border bg-card ${
          fill ? "flex-1" : ""
        }`}
        style={fill ? undefined : { height }}
      >
        <Text variant="muted">No hostels here have been placed on the map yet.</Text>
      </View>
    );
  }

  return (
    <View
      className={`overflow-hidden rounded-2xl border border-border ${fill ? "flex-1" : ""}`}
      style={
        fill
          ? { backgroundColor: colors.muted }
          : { backgroundColor: colors.muted, height }
      }
    >
      <WebView
        // Nothing here needs storage, cookies or a file handle; the page is a
        // fixed string that renders coordinates.
        allowFileAccess={false}
        androidLayerType="hardware"
        domStorageEnabled={false}
        javaScriptEnabled
        onMessage={onMessage}
        originWhitelist={["*"]}
        ref={webviewRef}
        renderError={() => (
          <View className="flex-1 items-center justify-center bg-card px-6">
            <Text className="text-center" variant="muted">
              The map needs a connection. The list below still works.
            </Text>
          </View>
        )}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        source={{ html }}
        style={{ backgroundColor: colors.muted, flex: 1 }}
      />
    </View>
  );
}

/**
 * The whole page, as one string.
 *
 * Leaflet comes from unpkg rather than being bundled: the map is useless without
 * a network anyway — the tiles are remote — so a local copy of the library would
 * add ~150 KB to every bundle to save a request on a screen that is already
 * making dozens.
 */
function buildHtml(
  markers: Marker[],
  me: Coordinates | null,
  accent: string,
  background: string,
): string {
  const { center, zoom } = boundsCenter(
    markers.map((marker) => ({ lat: marker.lat, lng: marker.lng })),
  );

  const payload = JSON.stringify({ accent, center, markers, me, zoom })
    // `</script>` inside a JSON string would close the tag it sits in. A hostel
    // called "</script>" is unlikely; a hostel called anything is not our call.
    .replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: ${background}; }
  .pin {
    background: ${accent};
    border: 2px solid #ffffff;
    border-radius: 50% 50% 50% 0;
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
    height: 18px;
    transform: rotate(-45deg);
    width: 18px;
  }
  .me {
    background: #1d7fe0;
    border: 3px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
    height: 16px;
    width: 16px;
  }
  .leaflet-popup-content { font: 13px -apple-system, Roboto, sans-serif; margin: 10px 12px; }
  .leaflet-popup-content b { display: block; margin-bottom: 2px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  var data = ${payload};

  var map = L.map('map', { attributionControl: true, zoomControl: false })
    .setView([data.center.lat, data.center.lng], data.zoom);

  L.tileLayer(${JSON.stringify(TILE_URL)}, {
    attribution: ${JSON.stringify(ATTRIBUTION)},
    maxZoom: 18
  }).addTo(map);

  var pin = L.divIcon({ className: '', html: '<div class="pin"></div>', iconAnchor: [9, 18], iconSize: [18, 18] });

  data.markers.forEach(function (marker) {
    L.marker([marker.lat, marker.lng], { icon: pin })
      .addTo(map)
      .bindPopup('<b>' + escapeHtml(marker.name) + '</b>' + escapeHtml(marker.price) + '<br/><a href="#" data-slug="' + escapeHtml(marker.slug) + '">View hostel</a>');
  });

  if (data.me) {
    L.marker([data.me.lat, data.me.lng], {
      icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconAnchor: [8, 8], iconSize: [16, 16] })
    }).addTo(map).bindPopup('You are here');
  }

  // Fit every pin once the layout has settled. Leaflet measures the container,
  // and inside a WebView that container has zero height on the first frame.
  setTimeout(function () {
    map.invalidateSize();

    if (data.markers.length > 1) {
      map.fitBounds(data.markers.map(function (marker) { return [marker.lat, marker.lng]; }), {
        padding: [28, 28]
      });
    }
  }, 60);

  // Delegated, because popups are created and destroyed as they open and close.
  document.addEventListener('click', function (event) {
    var slug = event.target && event.target.getAttribute && event.target.getAttribute('data-slug');

    if (slug) {
      event.preventDefault();
      window.ReactNativeWebView.postMessage(slug);
    }
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
})();
</script>
</body>
</html>`;
}
