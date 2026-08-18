import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { facilityIcon, SaveButton } from "@/components/hostel-card";
import { MapExplorer, type MapHandle, type MapMarker } from "@/components/map-explorer";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useNearby } from "@/hooks/use-nearby";
import { useResource } from "@/hooks/use-resource";
import { useSavedHostels } from "@/hooks/use-saved";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { API_BASE_URL } from "@/lib/api";
import { type Coordinates, haversineMeters, hostelCoordinates } from "@/lib/geo";
import { searchHostels } from "@/lib/hostel-search";
import { formatDistance, locationLabel, priceRange, ratingDisplay } from "@/lib/hostel-display";
import { absoluteMediaUrl } from "@/lib/media";
import {
  HOSTEL_TYPE_LABELS,
  listPublicHostels,
  type PublicHostel,
} from "@/lib/public-api";
import { fetchRoadRoute, type RoadRoute, type RouteMode } from "@/lib/routing";

/**
 * The map, as a screen rather than a panel: search, pick, and find the way.
 *
 * ## What it replaced, and what it did not
 *
 * The per-hostel directions screen is gone — it drew one route and could do
 * nothing else — and `/directions/[slug]` redirects here, so anything already
 * linking to it lands on the same hostel with directions running.
 *
 * The browse screen's map view **stays**, and the difference is worth keeping
 * straight: that one plots the rows a set of filters produced (type, facility,
 * budget, city) and is a view onto a result set. This one is the whole
 * catalogue, searched by name and place, and it is the only one that routes.
 * Merging them would mean one screen whose pins mean different things depending
 * on how it was opened.
 *
 * Reached from the distance badge on any card that has one, and from
 * `/map?slug=…&route=1` anywhere else.
 *
 * ## Everything on it is the platform's own catalogue
 *
 * Pins, search results and the card below are `listPublicHostels()` — the same
 * 60-row payload the browse screen renders. There is no place search, no
 * geocoder and no third-party POI layer: a map that finds "hostels near
 * Baneshwor" and offers you one that is not on the platform is a map that sends
 * people somewhere the app cannot help them. Searching narrows what is already
 * here, by name, area and city.
 *
 * ## Smoothness is an architectural choice, not a setting
 *
 * The map page is built once and driven by `injectJavaScript` — see
 * `components/map-explorer.tsx`. That is what makes typing in the search field
 * move pins instead of reloading a browser. Everything the reader interacts with
 * *around* the map — the field, the card, the mode toggle — is native, so none
 * of it waits on the WebView, and the photo strip is `expo-image` with its own
 * cache rather than `<img>` tags inside the page.
 *
 * ## Two profiles, and they are genuinely different graphs
 *
 * Car and foot go to separate OSRM deployments (`lib/routing.ts`). Between the
 * two hostels in the live catalogue that is 4.9 km / 7 min against 5.3 km /
 * 70 min — the toggle changes the answer, which is the only reason to offer it.
 */

/** Tall enough to see a room in, short enough to leave the map most of the screen. */
const PHOTO_STRIP_HEIGHT = 104;

/** What is open on the map: a hostel, and whether its route is being drawn. */
type Choice = {
  directions: boolean;
  id: string | null;
};

/** The state before anybody has tapped anything, and after they close the card. */
const NOTHING_CHOSEN: Choice = { directions: false, id: null };

export default function MapScreen() {
  const { route: routeParam, slug } = useLocalSearchParams<{
    route?: string;
    slug?: string;
  }>();
  const { colors } = useAppTheme();
  const insets = useSystemInsets();
  const map = useRef<MapHandle>(null);
  const saved = useSavedHostels();

  const hostels = useResource<PublicHostel[]>(
    useCallback(() => listPublicHostels(), []),
  );

  const nearby = useNearby({ auto: true });
  const me = nearby.coordinates;

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RouteMode>("car");
  /*
   * `null` means "the reader has not chosen anything yet", which is different
   * from having chosen nothing — the first falls back to the hostel in the URL,
   * the second is an empty map after they closed the card. Derived rather than
   * synced in an effect: a `setState` in an effect that watches the deep-link
   * hostel re-opens the card every time the payload refreshes, and fights the
   * reader for the selection.
   */
  const [choice, setChoice] = useState<Choice | null>(null);

  const all = useMemo(() => hostels.data ?? [], [hostels.data]);

  /*
   * Only hostels with coordinates get a pin — an un-geocoded listing has no
   * place on a map, and putting it at 0,0 would drag the whole view into the
   * Gulf of Guinea. It is still reachable everywhere else in the app.
   */
  const placed = useMemo(
    () => all.filter((hostel) => hostelCoordinates(hostel) !== null),
    [all],
  );

  const matches = useMemo(() => searchHostels(placed, query), [placed, query]);

  const markers = useMemo<MapMarker[]>(
    () =>
      matches.flatMap((hostel) => {
        const point = hostelCoordinates(hostel);

        return point
          ? [{ id: hostel.id, lat: point.lat, lng: point.lng, name: hostel.name }]
          : [];
      }),
    [matches],
  );

  /*
   * Opened from a card's distance badge: `?slug=…&route=1` opens on that hostel
   * with directions already running. It is the *initial* choice, not an
   * override — one tap on any pin and the reader's own choice wins from then on.
   */
  const wanted = useMemo(
    () => (slug ? (all.find((hostel) => hostel.slug === slug) ?? null) : null),
    [all, slug],
  );

  const linked = useMemo<Choice | null>(
    () => (wanted ? { directions: routeParam === "1", id: wanted.id } : null),
    [routeParam, wanted],
  );

  const { directions, id: selectedId } = choice ?? linked ?? NOTHING_CHOSEN;

  const selected = useMemo(
    () => all.find((hostel) => hostel.id === selectedId) ?? null,
    [all, selectedId],
  );

  const destination = useMemo(
    () => (selected ? hostelCoordinates(selected) : null),
    [selected],
  );


  // Centring is a message to the map, not React state — which is what an effect
  // is actually for. It fires when the linked hostel arrives with the payload.
  useEffect(() => {
    const point = wanted ? hostelCoordinates(wanted) : null;

    if (point) {
      map.current?.center(point, 15);
    }
  }, [wanted]);

  /*
   * The route itself. `null` from the router is a real answer — no road between
   * these two points — and the map falls back to the dashed straight line, which
   * is what `dashed` on the payload below says.
   */
  const road = useResource<RoadRoute | null>(
    useCallback(
      async () =>
        directions && me && destination ? await fetchRoadRoute(me, destination, mode) : null,
      [destination, directions, me, mode],
    ),
    { refetchOnFocus: false },
  );

  const straightLine = me && destination ? haversineMeters(me, destination) : null;

  const line = useMemo(() => {
    if (!directions || !me || !destination) {
      return null;
    }

    return road.data
      ? { dashed: false, points: [me, ...road.data.points, destination] }
      : { dashed: true, points: [me, destination] };
  }, [destination, directions, me, road.data]);

  const close = useCallback(() => setChoice(NOTHING_CHOSEN), []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <MapExplorer
        markers={markers}
        me={me}
        onSelect={(id) =>
          // Changing hostel drops the old route rather than leaving a line to
          // somewhere the card no longer describes.
          setChoice({ directions: false, id })
        }
        ref={map}
        route={line}
        selectedId={selectedId}
      />

      {/* ---- the search field, floating over the map ---- */}
      <View className="absolute left-0 right-0 px-4" style={{ top: insets.top + 8 }}>
        <View
          className="flex-row items-center gap-2 rounded-2xl border border-border px-3"
          style={{ backgroundColor: colors.card, height: 48 }}
        >
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
          >
            <Ionicons color={colors.foreground} name="arrow-back" size={20} />
          </Pressable>

          <TextInput
            className="h-full flex-1 text-sm text-foreground"
            onChangeText={setQuery}
            placeholder="Search hostels on the map"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            value={query}
          />

          {query ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setQuery("")}
            >
              <Ionicons color={colors.mutedForeground} name="close-circle" size={18} />
            </Pressable>
          ) : (
            <Ionicons color={colors.mutedForeground} name="search" size={18} />
          )}
        </View>

        {/*
          The count, not a dropdown of results. The pins *are* the results — a
          list over the map would cover the thing the search just changed.
        */}
        {query ? (
          <View className="mt-2 self-start rounded-full border border-border px-3 py-1"
            style={{ backgroundColor: colors.card }}>
            <Text className="text-xs font-semibold text-foreground">
              {matches.length === 0
                ? "No hostels match"
                : `${matches.length} ${matches.length === 1 ? "hostel" : "hostels"}`}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ---- map controls ---- */}
      <View className="absolute right-4 gap-2" style={{ top: insets.top + 72 }}>
        <MapButton
          disabled={nearby.isBusy}
          label="Centre on me"
          name="locate"
          onPress={() => {
            if (me) {
              map.current?.center(me, 15);
              return;
            }

            void nearby.enable();
          }}
        />
        <MapButton label="Show every hostel" name="scan-outline" onPress={() => map.current?.fitAll()} />
      </View>

      {/* ---- the selected hostel ---- */}
      {selected ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {directions ? (
            <RouteCard
              distance={road.data?.distanceMeters ?? straightLine}
              exact={Boolean(road.data)}
              hostel={selected}
              loading={road.loading || road.refreshing}
              me={me}
              mode={mode}
              nearby={nearby}
              onBack={() => setChoice({ directions: false, id: selectedId })}
              onClose={close}
              onMode={setMode}
              seconds={road.data?.durationSeconds ?? 0}
            />
          ) : (
            <PreviewCard
              distance={
                me && destination ? haversineMeters(me, destination) : null
              }
              hostel={selected}
              onClose={close}
              onDirections={() => setChoice({ directions: true, id: selectedId })}
              saved={saved.ids.has(selected.id)}
              onToggleSave={saved.toggle}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

function MapButton({
  disabled = false,
  label,
  name,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="h-11 w-11 items-center justify-center rounded-full border border-border active:opacity-70"
      disabled={disabled}
      onPress={onPress}
      style={{ backgroundColor: colors.card, opacity: disabled ? 0.6 : 1 }}
    >
      <Ionicons color={colors.foreground} name={name} size={19} />
    </Pressable>
  );
}

/**
 * The card a pin opens: enough to decide, and two ways onward.
 *
 * The photo strip is the part worth explaining. It is `expo-image` in a native
 * `ScrollView`, not `<img>` inside the map page — so it scrolls at native speed,
 * shares the cache with every other card in the app, and cannot block the map's
 * own gestures. A hostel with no photographs gets a single placeholder tile
 * rather than a collapsed row, because a card that changes height depending on
 * the listing is a card that jumps as you tap between pins.
 */
function PreviewCard({
  distance,
  hostel,
  onClose,
  onDirections,
  onToggleSave,
  saved,
}: {
  distance: number | null;
  hostel: PublicHostel;
  onClose: () => void;
  onDirections: () => void;
  onToggleSave: (hostel: PublicHostel) => void;
  saved: boolean;
}) {
  const { colors } = useAppTheme();

  const rating = ratingDisplay(hostel.ratingSummary);
  const photos = hostel.photos
    .map((photo) => absoluteMediaUrl(photo.url, API_BASE_URL))
    .filter((uri): uri is string => Boolean(uri))
    .slice(0, 8);

  return (
    <View
      className="gap-3 rounded-3xl border border-border p-3"
      style={{ backgroundColor: colors.card }}
    >
      <ScrollView
        contentContainerStyle={{ gap: 8 }}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ height: PHOTO_STRIP_HEIGHT }}
      >
        {photos.length > 0 ? (
          photos.map((uri) => (
            <Image
              contentFit="cover"
              key={uri}
              source={{ uri }}
              style={{
                backgroundColor: colors.muted,
                borderRadius: 14,
                height: PHOTO_STRIP_HEIGHT,
                width: 148,
              }}
              transition={120}
            />
          ))
        ) : (
          <View
            className="items-center justify-center rounded-2xl"
            style={{
              backgroundColor: colors.muted,
              height: PHOTO_STRIP_HEIGHT,
              width: 148,
            }}
          >
            <Ionicons color={colors.mutedForeground} name="image-outline" size={22} />
          </View>
        )}
      </ScrollView>

      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Text className="font-bold" numberOfLines={1} variant="subtitle">
            {hostel.name}
          </Text>

          <View className="flex-row items-center gap-1">
            <Ionicons color={colors.mutedForeground} name="location-outline" size={12} />
            <Text className="flex-1" numberOfLines={1} variant="caption">
              {locationLabel(hostel.location) || "Location not published"}
            </Text>
          </View>
        </View>

        <SaveButton hostel={hostel} onToggle={onToggleSave} saved={saved} />

        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          hitSlop={6}
          onPress={onClose}
          style={{ backgroundColor: colors.muted }}
        >
          <Ionicons color={colors.foreground} name="close" size={16} />
        </Pressable>
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <View
          className="flex-row items-center gap-1 rounded-lg px-2 py-0.5"
          style={{ backgroundColor: colors.brandSoft }}
        >
          {rating.kind === "rated" ? (
            <>
              <Ionicons color={colors.primary} name="star" size={11} />
              <Text className="text-xs font-bold">{rating.value}</Text>
              <Text variant="caption">{`(${rating.count})`}</Text>
            </>
          ) : (
            <Text className="text-xs font-semibold">New</Text>
          )}
        </View>

        <Text className="text-xs font-semibold text-foreground">
          {HOSTEL_TYPE_LABELS[hostel.hostelType]}
        </Text>

        {distance !== null ? (
          <Text variant="caption">{`${formatDistance(distance)} from you`}</Text>
        ) : null}
      </View>

      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <Text className="text-sm font-bold text-primary">{priceRange(hostel.pricing)}</Text>
        <Text variant="caption">/month</Text>

        {hostel.facilities.slice(0, 3).map((facility) => (
          <View className="flex-row items-center gap-1" key={facility}>
            <Ionicons
              color={colors.mutedForeground}
              name={facilityIcon(facility)}
              size={11}
            />
            <Text className="text-[10px] text-muted-foreground">{facility}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label="Directions" onPress={onDirections} />
        </View>
        <View className="flex-1">
          <Button
            label="View details"
            onPress={() => router.push(`/hostel/${hostel.slug}`)}
            variant="outline"
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Directions, once a hostel is chosen: how far, how long, and by what.
 *
 * The distance shown is the routed one when there is a route and the
 * straight-line one when there is not — and the wording changes with it, because
 * "5.3 km on foot" and "2.6 km in a straight line" are different claims and the
 * dashed line on the map is already saying which one is on screen.
 */
function RouteCard({
  distance,
  exact,
  hostel,
  loading,
  me,
  mode,
  nearby,
  onBack,
  onClose,
  onMode,
  seconds,
}: {
  distance: number | null;
  /** True when the number came from the router rather than from haversine. */
  exact: boolean;
  hostel: PublicHostel;
  loading: boolean;
  /** The device. Its absence is the whole difference between this card's two states. */
  me: Coordinates | null;
  mode: RouteMode;
  nearby: ReturnType<typeof useNearby>;
  onBack: () => void;
  onClose: () => void;
  onMode: (mode: RouteMode) => void;
  seconds: number;
}) {
  const { colors } = useAppTheme();

  const minutes = Math.max(1, Math.round(seconds / 60));

  return (
    <View
      className="gap-3 rounded-3xl border border-border p-3"
      style={{ backgroundColor: colors.card }}
    >
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityLabel="Back to the hostel"
          accessibilityRole="button"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          hitSlop={6}
          onPress={onBack}
          style={{ backgroundColor: colors.muted }}
        >
          <Ionicons color={colors.foreground} name="arrow-back" size={16} />
        </Pressable>

        <Text className="flex-1 font-bold" numberOfLines={1} variant="label">
          {hostel.name}
        </Text>

        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          hitSlop={6}
          onPress={onClose}
          style={{ backgroundColor: colors.muted }}
        >
          <Ionicons color={colors.foreground} name="close" size={16} />
        </Pressable>
      </View>

      {/* The toggle. Two graphs, two genuinely different answers — see routing.ts. */}
      <View
        className="flex-row gap-1 rounded-2xl p-1"
        style={{ backgroundColor: colors.muted }}
      >
        <ModeTab active={mode === "car"} icon="car-outline" label="Vehicle" onPress={() => onMode("car")} />
        <ModeTab active={mode === "foot"} icon="walk-outline" label="Walk" onPress={() => onMode("foot")} />
      </View>

      {me ? (
        <View className="gap-0.5">
          <View className="flex-row items-center gap-2">
            <Ionicons color={colors.primary} name="navigate" size={15} />
            <Text className="text-lg font-bold text-foreground">
              {distance === null
                ? "—"
                : exact
                  ? `${formatDistance(distance)} ${mode === "foot" ? "on foot" : "by road"}`
                  : `${formatDistance(distance)} in a straight line`}
            </Text>
          </View>

          <Text variant="caption">
            {loading
              ? "Tracing the route…"
              : exact
                ? `About ${minutes} min ${mode === "foot" ? "walking" : "driving"}`
                : "No route came back, so this is the direct distance — the dashed line above."}
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          <Text variant="muted">
            {nearby.status === "blocked"
              ? "Location is switched off for this app, so there is nothing to measure from."
              : "Turn on location to draw the way there. Your position is used on this screen and never saved."}
          </Text>

          <Button
            label={nearby.status === "blocked" ? "Open settings" : "Use my location"}
            loading={nearby.isBusy}
            onPress={() => {
              if (nearby.status === "blocked") {
                nearby.openSettings();
                return;
              }

              void nearby.enable();
            }}
            variant="outline"
          />
        </View>
      )}
    </View>
  );
}

function ModeTab({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl active:opacity-80"
      onPress={onPress}
      style={{ backgroundColor: active ? colors.card : "transparent" }}
    >
      <Ionicons
        color={active ? colors.primary : colors.mutedForeground}
        name={icon}
        size={15}
      />
      <Text
        className={`text-xs font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
