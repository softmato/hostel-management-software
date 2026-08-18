import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import type { Coordinates } from "@/lib/geo";
import {
  ATTRIBUTION,
  inlineJson,
  LEAFLET_CSS,
  LEAFLET_CSS_SRI,
  LEAFLET_JS,
  LEAFLET_JS_SRI,
  TILE_URL,
} from "@/lib/leaflet";

/**
 * The map every other map screen turned into: pins, a selection, and a route.
 *
 * ## The page is built once and then *driven*
 *
 * This is the whole performance story, and it is the one thing that must not be
 * undone. `source={{ html }}` remounts the WebView every time the string
 * changes — a fresh browser, a fresh Leaflet, fresh tiles over the network, and
 * the reader's pan and zoom thrown away. `HostelMap` rebuilds its page whenever
 * its markers change, which is fine for a static list and unusable for a screen
 * with a search field: every keystroke would reload the map.
 *
 * So the HTML here is created **once** (`useState` with a lazy initialiser, so
 * even a re-render cannot replace it) as an empty shell that exposes
 * `window.__map`. Everything after that — markers, the selection, the device
 * dot, the route — is `injectJavaScript`, which runs inside the page that is
 * already loaded. Typing in the search box moves pins; it does not reload a map.
 *
 * ## Injection is gated on `ready`
 *
 * A script injected before Leaflet has parsed is simply lost, and the failure
 * looks like an empty map with no error anywhere. The page posts `ready` when
 * `window.__map` exists, and every effect below depends on that flag — so the
 * first paint is always the full state, in one pass, however slow the CDN was.
 *
 * ## What crosses the bridge
 *
 * Out: JSON this component built. In: `{ type: "ready" }`, `{ type: "select",
 * id }` and `{ type: "clear" }` — nothing else is honoured, and the id is
 * matched against the markers this component was given before it is passed on.
 * The page is third-party JavaScript (Leaflet, from a CDN, with an SRI hash) and
 * is treated as untrusted input in both directions.
 */

/**
 * Deliberately four fields.
 *
 * This object is serialised into a script and injected on every search
 * keystroke, so it carries what the *map* needs and nothing the card needs —
 * price, rating, photos and facilities are read from the hostel itself, natively,
 * when a pin is tapped. A marker payload that grew to the full listing would put
 * sixty hostels' photo arrays through a string bridge to draw sixty 18px dots.
 */
export type MapMarker = {
  /** The hostel id. Comes back over the bridge, so it is matched, never trusted. */
  id: string;
  lat: number;
  lng: number;
  /** The long-press tooltip, and what a screen reader announces for the pin. */
  name: string;
};

export type MapHandle = {
  /** Centre on a point — "locate me", or a search result being chosen. */
  center: (point: Coordinates, zoom?: number) => void;
  /** Frame every pin currently on the map. */
  fitAll: () => void;
};

export type MapExplorerProps = {
  markers: MapMarker[];
  /** The device, when it has a fix. Drawn as a blue dot, never as a pin. */
  me: Coordinates | null;
  onSelect: (id: string | null) => void;
  /**
   * The line to draw, in order. `null` clears it.
   *
   * `dashed` says the line is the straight one between two points rather than
   * a road, and the map draws it differently for a reason: a straight line
   * through a riverbank rendered as a solid route is a direction to walk into a
   * river. The card says so too, but the map itself should not lie.
   */
  route: { dashed: boolean; points: Coordinates[] } | null;
  selectedId: string | null;
};

export const MapExplorer = forwardRef<MapHandle, MapExplorerProps>(function MapExplorer(
  { markers, me, onSelect, route, selectedId },
  ref,
) {
  const { colors } = useAppTheme();
  const webview = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  // Lazy initialiser: the shell is built on the first render and never again,
  // so the WebView's `source` is referentially stable for the life of the
  // screen. Colours are captured here; a theme switch mid-map keeps the tiles
  // it has, which is better than a reload for a change nobody makes twice.
  const [html] = useState(() => buildShell(colors.primary, colors.background));

  const call = useCallback((script: string) => {
    // The trailing `true;` is required on iOS: `injectJavaScript` warns when the
    // evaluated expression is not a primitive, and a Leaflet call returns an
    // object.
    webview.current?.injectJavaScript(`${script}; true;`);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      center: (point, zoom = 15) =>
        call(`window.__map.center(${point.lat}, ${point.lng}, ${zoom})`),
      fitAll: () => call("window.__map.fitAll()"),
    }),
    [call],
  );

  const ids = useMemo(() => new Set(markers.map((marker) => marker.id)), [markers]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: unknown;

      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (typeof message !== "object" || message === null) {
        return;
      }

      const { id, type } = message as { id?: unknown; type?: unknown };

      if (type === "ready") {
        setReady(true);
        return;
      }

      if (type === "clear") {
        onSelect(null);
        return;
      }

      // An id the page was never given cannot select anything. This is the one
      // place a string from inside the WebView could reach navigation.
      if (type === "select" && typeof id === "string" && ids.has(id)) {
        onSelect(id);
      }
    },
    [ids, onSelect],
  );

  /*
   * Four effects, one per thing the page holds, so a change to any of them
   * costs exactly one small script and never touches the rest. `ready` is in
   * every dependency list: it flips once, and that pass sets the full state.
   */
  useEffect(() => {
    if (ready) {
      call(`window.__map.setMarkers(${inlineJson(markers)})`);
    }
  }, [call, markers, ready]);

  useEffect(() => {
    if (ready) {
      call(`window.__map.setMe(${inlineJson(me)})`);
    }
  }, [call, me, ready]);

  useEffect(() => {
    if (ready) {
      call(`window.__map.setRoute(${inlineJson(route)})`);
    }
  }, [call, ready, route]);

  useEffect(() => {
    if (ready) {
      call(`window.__map.select(${inlineJson(selectedId)})`);
    }
  }, [call, ready, selectedId]);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.muted }}>
      <WebView
        allowFileAccess={false}
        androidLayerType="hardware"
        domStorageEnabled={false}
        javaScriptEnabled
        onMessage={onMessage}
        originWhitelist={["*"]}
        ref={webview}
        renderError={() => (
          <View className="flex-1 items-center justify-center bg-card px-6">
            <Text className="text-center" variant="muted">
              The map needs a connection. Search and the hostel list still work.
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
});

/**
 * The empty page, with its API attached to `window.__map`.
 *
 * Everything below is written to be called repeatedly and cheaply: markers live
 * in one `LayerGroup` that is cleared and refilled (60 pins is nothing, and a
 * diff would be more code than it saves), the route is a single polyline
 * replaced in place, and selection only swaps a CSS class rather than rebuilding
 * a marker.
 */
function buildShell(accent: string, background: string): string {
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
    transition: height .12s ease, width .12s ease;
    width: 18px;
  }
  /* The selected pin grows rather than changing colour: the palette has one
     accent, and a second colour here would read as a second kind of thing. */
  .pin.on { height: 26px; width: 26px; }
  .me {
    background: #1d7fe0;
    border: 3px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
    height: 16px;
    width: 16px;
  }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  // Leaflet failed to load — a blocked CDN or a stale SRI hash. Say nothing and
  // never post ready: the native side keeps its own UI and the map stays grey.
  if (typeof L === 'undefined') {
    return;
  }

  var map = L.map('map', { attributionControl: true, zoomControl: false })
    .setView([27.7172, 85.324], 12);

  L.tileLayer(${JSON.stringify(TILE_URL)}, {
    attribution: ${JSON.stringify(ATTRIBUTION)},
    maxZoom: 18
  }).addTo(map);

  var pins = L.layerGroup().addTo(map);
  var byId = {};
  var meMarker = null;
  var line = null;
  var selected = null;
  var fitted = false;

  function icon(on) {
    return L.divIcon({
      className: '',
      html: '<div class="pin' + (on ? ' on' : '') + '"></div>',
      iconAnchor: on ? [13, 26] : [9, 18],
      iconSize: on ? [26, 26] : [18, 18]
    });
  }

  window.__map = {
    setMarkers: function (list) {
      pins.clearLayers();
      byId = {};

      list.forEach(function (marker) {
        var pin = L.marker([marker.lat, marker.lng], {
          icon: icon(marker.id === selected),
          title: marker.name
        });

        pin.on('click', function () { post({ id: marker.id, type: 'select' }); });
        pin.addTo(pins);
        byId[marker.id] = pin;
      });

      // Frame the catalogue once, on the first set that has anything in it.
      // Refitting on every search would yank the map out from under somebody
      // who had panned somewhere deliberately.
      if (!fitted && list.length > 0) {
        fitted = true;
        window.__map.fitAll();
      }
    },

    setMe: function (point) {
      if (meMarker) {
        map.removeLayer(meMarker);
        meMarker = null;
      }

      if (!point) {
        return;
      }

      meMarker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconAnchor: [8, 8], iconSize: [16, 16] })
      }).addTo(map);
    },

    setRoute: function (payload) {
      if (line) {
        map.removeLayer(line);
        line = null;
      }

      if (!payload || !payload.points || payload.points.length < 2) {
        return;
      }

      var latlngs = payload.points.map(function (point) { return [point.lat, point.lng]; });

      line = L.polyline(latlngs, {
        color: payload.dashed ? '#1d7fe0' : ${JSON.stringify(accent)},
        dashArray: payload.dashed ? '6 8' : null,
        opacity: 0.9,
        weight: 5
      }).addTo(map);

      map.fitBounds(latlngs, { paddingBottomRight: [40, 220], paddingTopLeft: [40, 120] });
    },

    select: function (id) {
      [selected, id].forEach(function (key) {
        if (key && byId[key]) {
          byId[key].setIcon(icon(key === id));
        }
      });

      selected = id;

      if (id && byId[id]) {
        // Enough of a nudge to bring a pin out from behind the card at the
        // bottom of the screen, without the jump of a re-centre.
        map.panTo(byId[id].getLatLng(), { animate: true, duration: 0.25 });
      }
    },

    center: function (lat, lng, zoom) {
      map.setView([lat, lng], zoom, { animate: true });
    },

    fitAll: function () {
      var points = Object.keys(byId).map(function (key) { return byId[key].getLatLng(); });

      if (points.length === 1) {
        map.setView(points[0], 15, { animate: true });
      } else if (points.length > 1) {
        map.fitBounds(points, { padding: [50, 50] });
      }
    }
  };

  // A tap on the map itself, not on a pin, closes the card.
  map.on('click', function () { post({ type: 'clear' }); });

  // Leaflet measures its container, and inside a WebView that container has no
  // height on the first frame.
  setTimeout(function () {
    map.invalidateSize();
    post({ type: 'ready' });
  }, 60);
})();
</script>
</body>
</html>`;
}
