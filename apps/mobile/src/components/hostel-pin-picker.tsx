import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { readApiError } from "@/lib/api-contract";
import { type Coordinates, isUsableCoordinate } from "@/lib/geo";
import {
  ATTRIBUTION,
  inlineJson,
  LEAFLET_CSS,
  LEAFLET_CSS_SRI,
  LEAFLET_JS,
  LEAFLET_JS_SRI,
  TILE_URL,
} from "@/lib/leaflet";
import { requestDeviceLocation } from "@/lib/location";
import { type LocationMatch, lookupRegistrationLocation } from "@/lib/registration-api";

/**
 * Putting a hostel on the map while applying — the phone's version of the
 * website's `LocationPicker` (`apps/web/src/components/maps/location-picker.tsx`).
 *
 * Same four ways in: search a place, paste a Google Maps link, use where you are
 * standing, or move the map by hand. Same lookup behind the first two, so a link
 * pasted here and one pasted on the team desk resolve through one code path.
 *
 * ## The map moves, the pin does not
 *
 * The website drags a marker. On a phone the finger dragging a marker is on top
 * of it, hiding the one spot it is trying to place, so here the pin is fixed at
 * the centre and the map slides underneath — the pattern every ride and
 * delivery app already taught the people using this.
 *
 * ## Why the picker is full screen
 *
 * The application step scrolls, and a pannable map inside a scrolling page puts
 * two pan gestures on the same pixels (see `HostelMap`'s `preview` note). So the
 * step shows a still picture of the pin, and placing it opens a screen whose map
 * owns every gesture.
 */

export type PinAddress = NonNullable<LocationMatch["address"]>;

/** Only used when there is no pin and no typed address to search for. */
const KATHMANDU: Coordinates = { lat: 27.7172, lng: 85.324 };
const PLACED_ZOOM = 18;

/** Something the server's link reader should see, rather than the place search. */
export function looksLikeMapLink(value: string): boolean {
  const trimmed = value.trim();

  return (
    /^(https?:\/\/|www\.|maps\.)/i.test(trimmed) ||
    /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(trimmed)
  );
}

/** ~11 m. Two centres closer than this are the same place for an address lookup. */
function placeKey(point: Coordinates): string {
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
}

function describeAddress(match: { address?: PinAddress; label?: string } | null): string {
  if (!match) {
    return "";
  }

  const parts = [match.address?.address, match.address?.area, match.address?.city].filter(
    Boolean,
  );

  return parts.length > 0 ? parts.join(", ") : (match.label ?? "");
}

/* -------------------------------------------------------------------------- */
/* The map                                                                    */
/* -------------------------------------------------------------------------- */

type PinMapHandle = { moveTo: (point: Coordinates, zoom?: number) => void };

/**
 * One Leaflet page with nothing on it but tiles. The pin is native, drawn over
 * the WebView's centre, so it never lags the map and never needs a bridge call.
 *
 * Built once per mount and then driven (`MapExplorer`'s rule): rebuilding the
 * HTML would reload the map under the owner's finger.
 */
const PinMap = forwardRef<
  PinMapHandle,
  {
    center: Coordinates;
    interactive: boolean;
    onCenter?: (point: Coordinates) => void;
  }
>(function PinMap({ center, interactive, onCenter }, ref) {
  const { colors } = useAppTheme();
  const { height } = useWindowDimensions();
  const webview = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [html] = useState(() =>
    buildPinPage({ background: colors.muted, center, interactive }),
  );
  /*
   * A move asked for before Leaflet has loaded — the search a pin-less picker
   * runs on open usually answers first — is held and replayed on `ready`, not
   * dropped: a dropped one leaves the map on Kathmandu while the pin's address
   * says Bagdol.
   */
  const pending = useRef<{ point: Coordinates; zoom: number } | null>(null);

  const inject = useCallback((point: Coordinates, zoom: number) => {
    webview.current?.injectJavaScript(
      `window.__pin.moveTo(${point.lat}, ${point.lng}, ${zoom}); true;`,
    );
  }, []);

  useEffect(() => {
    if (ready && pending.current) {
      inject(pending.current.point, pending.current.zoom);
      pending.current = null;
    }
  }, [inject, ready]);

  useImperativeHandle(
    ref,
    () => ({
      moveTo: (point, zoom = PLACED_ZOOM) => {
        if (ready) {
          inject(point, zoom);
        } else {
          pending.current = { point, zoom };
        }
      },
    }),
    [inject, ready],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: unknown;

      try {
        message = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      const { lat, lng, type } = (message ?? {}) as {
        lat?: unknown;
        lng?: unknown;
        type?: unknown;
      };

      if (type === "ready") {
        setReady(true);
        return;
      }

      // Untrusted input across a bridge: only a real coordinate is passed on.
      if (type === "center" && ready) {
        const point = { lat: Number(lat), lng: Number(lng) };

        if (isUsableCoordinate(point)) {
          onCenter?.(point);
        }
      }
    },
    [onCenter, ready],
  );

  return (
    <View className="flex-1 overflow-hidden" style={{ backgroundColor: colors.muted }}>
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
              The map needs a connection.
            </Text>
          </View>
        )}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        source={{ html }}
        style={{
          backgroundColor: colors.muted,
          flex: 1,
          pointerEvents: interactive ? "auto" : "none",
        }}
      />

      {ready ? (
        <CentrePin />
      ) : (
        <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
          <Skeleton height={height} radius={0} />
        </View>
      )}

      {/* OpenStreetMap's licence requires the credit to be visible. */}
      <View
        className="absolute bottom-1 left-1 rounded bg-card px-1.5 py-0.5"
        style={{ pointerEvents: "none" }}
      >
        <Text className="text-[9px] text-muted-foreground" variant={null}>
          {ATTRIBUTION}
        </Text>
      </View>
    </View>
  );
});

/** The pin's tip sits on the map's exact centre; the dot marks that point. */
function CentrePin() {
  const { colors } = useAppTheme();

  return (
    <View
      className="items-center justify-center"
      style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}
    >
      <View className="absolute h-1.5 w-1.5 rounded-full bg-foreground" />
      <View style={{ transform: [{ translateY: -19 }] }}>
        <Ionicons color={colors.primary} name="location" size={40} />
      </View>
    </View>
  );
}

function buildPinPage({
  background,
  center,
  interactive,
}: {
  background: string;
  center: Coordinates;
  interactive: boolean;
}): string {
  const payload = inlineJson({ center, interactive, zoom: PLACED_ZOOM });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous" />
<style>html, body, #map { height: 100%; margin: 0; padding: 0; background: ${background}; }</style>
</head>
<body>
<div id="map"></div>
<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  /* No backticks below: this page is a JS template literal. */
  var data = ${payload};
  var on = data.interactive;
  var map = L.map('map', {
    attributionControl: false,
    boxZoom: false,
    doubleClickZoom: on,
    dragging: on,
    keyboard: false,
    scrollWheelZoom: false,
    tap: on,
    touchZoom: on ? 'center' : false,
    zoomControl: false
  }).setView([data.center.lat, data.center.lng], data.zoom);

  L.tileLayer(${JSON.stringify(TILE_URL)}, { maxZoom: 19 }).addTo(map);

  function post(message) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  /*
   * Only once a hand has moved the map. A keyboard opening resizes the page and
   * Leaflet answers with a moveend of its own, which would otherwise count as
   * the owner choosing wherever the map happened to be.
   */
  var touched = false;
  map.on('dragstart zoomstart', function () { touched = true; });
  map.on('moveend', function () {
    if (!touched) return;
    var c = map.getCenter();
    post({ lat: c.lat, lng: c.lng, type: 'center' });
  });

  window.__pin = {
    moveTo: function (lat, lng, zoom) {
      map.setView([lat, lng], zoom || map.getZoom(), { animate: true });
    }
  };

  /* Inside a WebView the container has no height on the first frame. */
  setTimeout(function () {
    map.invalidateSize();
    post({ type: 'ready' });
  }, 60);
})();
</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/* On the step                                                                */
/* -------------------------------------------------------------------------- */

/** The pin as it stands, on the application step. Tapping it opens the picker. */
export function HostelPinField({
  error,
  onOpen,
  pin,
}: {
  error?: string;
  onOpen: () => void;
  pin: Coordinates | null;
}) {
  const { colors } = useAppTheme();

  if (!pin) {
    return (
      <View className="gap-2">
        <Pressable
          accessibilityLabel="Put your hostel on the map"
          accessibilityRole="button"
          className={`flex-row items-center gap-4 rounded-2xl border bg-card p-4 active:opacity-80 ${
            error ? "border-destructive" : "border-border"
          }`}
          onPress={onOpen}
        >
          <View className="h-12 w-12 items-center justify-center rounded-xl bg-brand-soft">
            <Ionicons color={colors.primary} name="map-outline" size={24} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-semibold">Put your hostel on the map</Text>
            <Text variant="caption">Search, paste a Maps link, or use your location</Text>
          </View>
          <Ionicons color={colors.mutedForeground} name="chevron-forward" size={20} />
        </Pressable>
        {error ? (
          <Text className="text-sm text-destructive" variant={null}>
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="h-44 overflow-hidden rounded-2xl border border-border">
        {/* Keyed on the pin: the still map is built once per mount, so a moved pin remounts it. */}
        <PinMap center={pin} interactive={false} key={placeKey(pin)} />
        <Pressable
          accessibilityLabel="Move the pin"
          accessibilityRole="button"
          onPress={onOpen}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View className="flex-row items-center gap-3">
        <Text className="flex-1" variant="caption">
          {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
        </Text>
        <Button label="Move pin" onPress={onOpen} size="sm" variant="outline" />
      </View>
    </View>
  );
}

/**
 * The optional Google Maps link, kept as pasted. A pasted link also places the
 * pin — it is the most exact thing an owner can hand us, and making them find
 * the same spot again by hand would be asking twice.
 */
export function MapLinkField({
  near,
  onChange,
  onPinned,
  value,
}: {
  near: string;
  onChange: (value: string) => void;
  onPinned: (match: LocationMatch) => void;
  value: string;
}) {
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  /** The link last read, so a blur after a paste does not read it twice. */
  const readFor = useRef("");

  const read = useCallback(
    async (link: string) => {
      const trimmed = link.trim();

      if (!looksLikeMapLink(trimmed) || readFor.current === trimmed) {
        return;
      }

      readFor.current = trimmed;
      setStatus({ error: false, text: "Reading the link…" });

      try {
        const [best] = await lookupRegistrationLocation({ near, q: trimmed });

        if (readFor.current !== trimmed) {
          return;
        }

        if (!best) {
          setStatus({
            error: true,
            text: "No location in that link. In Google Maps tap Share → Copy link, or place the pin by hand.",
          });
          return;
        }

        onPinned(best);
        setStatus({ error: false, text: "Pin placed from your link." });
      } catch (error) {
        if (readFor.current === trimmed) {
          readFor.current = "";
          setStatus({ error: true, text: readApiError(error, "Could not read that link.") });
        }
      }
    },
    [near, onPinned],
  );

  return (
    <Input
      autoCapitalize="none"
      autoCorrect={false}
      error={status?.error ? status.text : undefined}
      hint={status && !status.error ? status.text : "Optional. Shown on your listing."}
      keyboardType="url"
      label="Google Maps link"
      onChangeText={(next) => {
        onChange(next);

        if (!next.trim()) {
          readFor.current = "";
          setStatus(null);
        } else if (next.length - value.length > 8) {
          // A jump this size is a paste, which has one meaning: read it now.
          void read(next);
        }
      }}
      onEndEditing={() => void read(value)}
      placeholder="https://maps.app.goo.gl/…"
      value={value}
      variant="line"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The picker                                                                 */
/* -------------------------------------------------------------------------- */

export type PinChoice = {
  address?: PinAddress;
  /** The Maps link the pin came from, when it came from one. */
  link?: string;
  pin: Coordinates;
};

export function HostelPinPicker({
  near,
  onClose,
  onConfirm,
  open,
  value,
}: {
  /** The typed address — searched on open when there is no pin yet. */
  near: string;
  onClose: () => void;
  onConfirm: (choice: PinChoice) => void;
  open: boolean;
  value: Coordinates | null;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open}
    >
      {/* Mounted only while open, so every visit starts from the pin as it stands. */}
      {open ? (
        <PickerBody near={near} onClose={onClose} onConfirm={onConfirm} value={value} />
      ) : null}
    </Modal>
  );
}

function PickerBody({
  near,
  onClose,
  onConfirm,
  value,
}: {
  near: string;
  onClose: () => void;
  onConfirm: (choice: PinChoice) => void;
  value: Coordinates | null;
}) {
  const { colors } = useAppTheme();
  const insets = useSystemInsets();
  const map = useRef<PinMapHandle>(null);

  const [query, setQuery] = useState(value ? "" : near);
  const [results, setResults] = useState<LocationMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState("");
  const [center, setCenter] = useState<Coordinates>(value ?? KATHMANDU);
  /** False until something real put the pin somewhere — never confirm Kathmandu's centre by default. */
  const [placed, setPlaced] = useState(Boolean(value));
  const [known, setKnown] = useState<{ key: string; match: LocationMatch } | null>(null);
  const [link, setLink] = useState<string | undefined>(undefined);
  /** Ignore answers to a lookup the owner has already moved past. */
  const requestId = useRef(0);

  const moveTo = useCallback((point: Coordinates) => {
    setCenter(point);
    setPlaced(true);
    map.current?.moveTo(point);
  }, []);

  const search = useCallback(
    async (term: string) => {
      const trimmed = term.trim();

      if (trimmed.length < 2) {
        setNote("Type a place or landmark, or paste a Google Maps link.");
        return;
      }

      const isLink = looksLikeMapLink(trimmed);
      const id = requestId.current + 1;

      requestId.current = id;
      setSearching(true);
      setNote(isLink ? "Reading the link…" : "");

      try {
        const found = await lookupRegistrationLocation(
          isLink || !near ? { q: trimmed } : { near, q: trimmed },
        );

        if (requestId.current !== id) {
          return;
        }

        const [best] = found;

        if (!best) {
          setResults([]);
          setNote(
            isLink
              ? "No location in that link. In Google Maps tap Share → Copy link."
              : "No match. Try a nearby landmark, then move the map.",
          );
          return;
        }

        moveTo(best.coordinates);
        setKnown({ key: placeKey(best.coordinates), match: best });
        setLink(isLink ? trimmed : undefined);
        setResults(!isLink && found.length > 1 ? found.slice(0, 5) : []);
        setNote(
          isLink
            ? "Pinned from your link."
            : "Move the map until the pin sits on your gate.",
        );
      } catch (error) {
        if (requestId.current === id) {
          setNote(readApiError(error, "Search is not working right now. Move the map by hand."));
        }
      } finally {
        if (requestId.current === id) {
          setSearching(false);
        }
      }
    },
    [moveTo, near],
  );

  // A pin-less visit opens on the typed address rather than on Kathmandu's centre.
  // `near`, `search` and `value` hold still while the picker is open, so this runs once per visit.
  useEffect(() => {
    if (value || near.trim().length < 2) {
      return;
    }

    const timer = setTimeout(() => void search(near), 0);

    return () => clearTimeout(timer);
  }, [near, search, value]);

  const locate = useCallback(async () => {
    setLocating(true);
    setNote("Finding where you are…");

    const outcome = await requestDeviceLocation({ precise: true });

    setLocating(false);

    if (outcome.kind === "granted") {
      requestId.current += 1;
      setResults([]);
      setLink(undefined);
      moveTo(outcome.coordinates);
      setNote("Pinned where you are standing. Move the map to fine-tune.");
    } else if (outcome.kind === "denied") {
      setNote(
        outcome.canAskAgain
          ? "Location was not allowed. Search or move the map instead."
          : "Location is off for this app in Settings. Search or move the map instead.",
      );
    } else {
      setNote("No location fix. Turn on location, or search or move the map.");
    }
  }, [moveTo]);

  // The address under the pin, once the map has stopped moving.
  const settled = useDebouncedValue(center, 700);

  useEffect(() => {
    if (!placed || known?.key === placeKey(settled)) {
      return;
    }

    let live = true;

    lookupRegistrationLocation(settled)
      .then(([match]) => {
        if (live && match) {
          setKnown({ key: placeKey(settled), match: { ...match, coordinates: settled } });
        }
      })
      .catch(() => {
        // The pin is valid without its address text.
      });

    return () => {
      live = false;
    };
  }, [known?.key, placed, settled]);

  const addressLine =
    known && known.key === placeKey(center) ? describeAddress(known.match) : "";

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-2">
        <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={onClose}>
          <Ionicons color={colors.foreground} name="close" size={24} />
        </Pressable>
        <Text className="flex-1" variant="subtitle">
          Pin your hostel
        </Text>
      </View>

      <View className="gap-2 px-5 pb-3">
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(next) => {
                const pasted = next.length - query.length > 8 && looksLikeMapLink(next);

                setQuery(next);

                if (pasted) {
                  void search(next);
                }
              }}
              onSubmitEditing={() => void search(query)}
              placeholder="Search a place, or paste a Maps link"
              returnKeyType="search"
              value={query}
            />
          </View>
          <Button
            label="Search"
            loading={searching}
            onPress={() => void search(query)}
            variant="outline"
          />
        </View>

        {note ? <Text variant="caption">{note}</Text> : null}

        {results.length > 0 ? (
          <View className="overflow-hidden rounded-2xl border border-border bg-card">
            {results.map((result, position) => (
              <Pressable
                accessibilityRole="button"
                className={`flex-row items-center gap-3 px-4 py-3 active:bg-muted ${
                  position > 0 ? "border-t border-border" : ""
                }`}
                key={placeKey(result.coordinates) + position}
                onPress={() => {
                  requestId.current += 1;
                  moveTo(result.coordinates);
                  setKnown({ key: placeKey(result.coordinates), match: result });
                  setResults([]);
                  setNote("Move the map until the pin sits on your gate.");
                }}
              >
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-soft">
                  <Ionicons color={colors.primary} name="location-outline" size={16} />
                </View>
                <Text className="flex-1" numberOfLines={2}>
                  {result.label || describeAddress(result) || "Unnamed place"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View className="flex-1">
        <PinMap
          center={center}
          interactive
          onCenter={(point) => {
            setCenter(point);
            setPlaced(true);
          }}
          ref={map}
        />

        <Pressable
          accessibilityLabel="Use my location"
          accessibilityRole="button"
          className="absolute bottom-4 right-4 h-12 w-12 items-center justify-center rounded-full border border-border bg-card active:opacity-80"
          disabled={locating}
          onPress={() => void locate()}
          style={{ elevation: 3 }}
        >
          <Ionicons
            color={locating ? colors.mutedForeground : colors.primary}
            name="locate"
            size={22}
          />
        </Pressable>
      </View>

      <View
        className="gap-3 border-t border-border px-5 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="flex-row items-center gap-3">
          <Ionicons color={colors.primary} name="location" size={18} />
          <Text className="flex-1" numberOfLines={2} variant={addressLine ? "body" : "muted"}>
            {placed
              ? addressLine || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`
              : "Search, or move the map onto your building"}
          </Text>
        </View>
        <Button
          disabled={!placed}
          label="Use this spot"
          onPress={() =>
            onConfirm({
              address: known?.key === placeKey(center) ? known.match.address : undefined,
              link,
              pin: center,
            })
          }
        />
      </View>
    </View>
  );
}
