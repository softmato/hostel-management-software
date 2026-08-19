import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, TextInput, View } from "react-native";

import { facilityIcon, SaveButton } from "@/components/hostel-card";
import { MapExplorer, type MapHandle, type MapMarker } from "@/components/map-explorer";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useGuidance,
  type Guidance,
  type GuidanceStatus,
} from "@/hooks/use-guidance";
import { useNearby } from "@/hooks/use-nearby";
import { useResource } from "@/hooks/use-resource";
import { useSavedHostels } from "@/hooks/use-saved";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { API_BASE_URL } from "@/lib/api";
import { type Coordinates, haversineMeters, hostelCoordinates } from "@/lib/geo";
import { searchHostels } from "@/lib/hostel-search";
import { type MapLayerId, MAP_LAYERS } from "@/lib/leaflet";
import { cardinalFor, formatManeuverDistance, instructionFor } from "@/lib/navigation";
import { formatDistance, locationLabel, priceRange, ratingDisplay } from "@/lib/hostel-display";
import { absoluteMediaUrl } from "@/lib/media";
import {
  HOSTEL_TYPE_LABELS,
  listPublicHostels,
  type PublicHostel,
} from "@/lib/public-api";
import {
  fetchRoadRoute,
  type RoadRoute,
  type RouteMode,
  type RouteStep,
} from "@/lib/routing";

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

/**
 * How long the reader has to stop typing before the map answers.
 *
 * Under about 150ms is indistinguishable from no debounce at all — the work
 * still happens per keystroke for anyone typing at a normal speed. Over about
 * 400ms and the reader has finished the word, looked up, and started wondering.
 * 250 is the usual landing spot for a search-as-you-type field, and it is what
 * turns "Kritika" from seven passes over the catalogue into one.
 */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Rows in the result list before it stops and says how many are left.
 *
 * The list floats over the map, and the map is the thing the search just
 * changed: sixty rows would cover every pin they refer to. Eight is about a
 * third of the screen — enough that a real answer is usually visible without
 * scrolling, little enough that the map is still a map.
 */
const MAX_RESULTS = 8;

/**
 * How far down the screen the list may reach before it scrolls inside itself.
 *
 * Eight rows do not all fit on a small phone, and a list that grows to whatever
 * its contents need would push past the map controls on the right and, on a
 * short screen, past the card at the bottom. Measured rather than written as a
 * class, like every other dimension in this app: NativeWind compiles class names
 * at bundle time and an arbitrary value used nowhere else can resolve to nothing.
 */
const RESULTS_MAX_HEIGHT = 300;

/**
 * How close the map sits while navigating.
 *
 * Close enough to tell one junction from the next, which is the only question
 * the map is being asked at this point. Wider and the turn you are about to
 * make is indistinguishable from the two after it; closer and there is no
 * warning of what is coming.
 */
const NAVIGATION_ZOOM = 17;

/**
 * The lock this screen takes on the display while it is guiding.
 *
 * A tag rather than the default, so this can only ever release its own lock:
 * `deactivateKeepAwake` with no tag would also release one taken by something
 * else, and a video player that stopped keeping the screen on because somebody
 * finished walking to a hostel is a bug nobody would find.
 */
const NAVIGATION_WAKE_TAG = "map.navigation";

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
  /*
   * Whether the field has the caret. The result list hangs off this as well as
   * off the query, so that tapping a result — or the map — puts the map back on
   * screen whole, rather than leaving a list of eight hostels floating over the
   * one the reader just chose.
   */
  const [searching, setSearching] = useState(false);
  const field = useRef<TextInput>(null);
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

  /*
   * Two values, and the difference between them is the whole fix.
   *
   * `query` is the field: it must never lag, because a `TextInput` bound to
   * debounced state drops characters and jumps the caret. `search` is what the
   * *map* is asked for, and it only moves once the reader has stopped typing —
   * every keystroke used to re-filter the catalogue, rebuild the marker array
   * and inject all sixty pins into the WebView, which is six wasted passes for
   * a six-letter word and pins that twitch while you type.
   *
   * Emptying the box skips the wait. The delay exists to avoid answering a
   * half-typed question; "show me everything again" is not half of anything, and
   * a quarter-second of the old, narrower set after a clear looks stuck.
   */
  const settled = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const search = query.trim() ? settled : query;

  const matches = useMemo(() => searchHostels(placed, search), [placed, search]);

  /** True while the reader is mid-word: the field has moved on, the map has not. */
  const settling = query.trim() !== search.trim();

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

  /*
   * Guidance owns its own position — at navigation accuracy, from its own
   * subscription — so from the moment Start is pressed the map, the arrow and
   * the card all read from it rather than from the coarse `me` the rest of the
   * screen uses. See `hooks/use-guidance.ts` for why that accuracy exists only
   * while this is running.
   */
  const guidance = useGuidance({ destination, mode, route: road.data ?? null });
  const navigating = guidance.isNavigating;
  const arrived = guidance.status === "arrived";
  const here = guidance.position ?? me;

  const straightLine = me && destination ? haversineMeters(me, destination) : null;

  const line = useMemo(() => {
    /*
     * While navigating, the line is whatever guidance is following — the
     * original route or the latest reroute — and it is drawn as it came back
     * from the router, without the two straight hops from the device to the
     * first point and from the last point to the door. Those are honest enough
     * on a planning screen; under a turn-by-turn arrow they look like an
     * instruction to walk through whatever is in the way.
     */
    if (navigating) {
      return guidance.route ? { dashed: false, points: guidance.route.points } : null;
    }

    if (!directions || !me || !destination) {
      return null;
    }

    return road.data
      ? { dashed: false, points: [me, ...road.data.points, destination] }
      : { dashed: true, points: [me, destination] };
  }, [destination, directions, guidance.route, me, navigating, road.data]);

  /*
   * Navigation drives the map rather than rendering it, and it does so in two
   * effects rather than one.
   *
   * The first version had a single effect depending on both the position and
   * the heading, which meant every compass sample — ten or so a second — called
   * `follow`, and `follow` is a `setView`. A pinch was undone within a tenth of
   * a second, and the bridge carried ten scripts a second to do it. Split, a
   * fix moves the map and a compass sample only turns it, and the 2° gate in
   * `MapExplorer` drops most of those before they cross.
   *
   * The zoom is passed **once**, on the first fix of a session. After that the
   * page keeps whatever zoom the map is on, so a reader who pinches out to see
   * the next two junctions stays there instead of being pulled back to 17.
   */
  const zoomed = useRef(false);

  useEffect(() => {
    if (!navigating) {
      zoomed.current = false;
      return;
    }

    if (!guidance.position) {
      return;
    }

    map.current?.follow(
      guidance.position,
      zoomed.current ? null : NAVIGATION_ZOOM,
      null,
    );
    zoomed.current = true;
  }, [guidance.position, navigating]);

  /*
   * Heading-up or north-up, and the compass is the switch.
   *
   * Turning with the reader is right while walking — the turn on screen is the
   * turn in front of you — and wrong the moment they stop to work out where
   * they are, because every label is upside down and the street they can see
   * signposted is not where the map says. Google puts that choice on the
   * compass; so does this. It is cleared by `startGuidance` rather than by an
   * effect watching `navigating` — a `setState` in an effect body is a
   * cascading render and the lint rule that forbids it is right — which also
   * makes it a per-session choice rather than a remembered preference.
   */
  const [northUp, setNorthUp] = useState(false);
  const [layer, setLayer] = useState<MapLayerId>("standard");
  const [layersOpen, setLayersOpen] = useState(false);

  const startGuidance = useCallback(() => {
    setNorthUp(false);
    guidance.start();
  }, [guidance]);

  useEffect(() => {
    if (!navigating) {
      return;
    }

    if (northUp) {
      map.current?.setBearing(0);
      return;
    }

    if (guidance.heading !== null) {
      map.current?.setBearing(guidance.heading);
    }
  }, [guidance.heading, navigating, northUp]);

  /*
   * And back to north-up when it ends, however it ended. A map left rotated
   * after the reader pressed Stop is a map whose compass looks broken.
   */
  useEffect(() => {
    if (!navigating) {
      map.current?.setBearing(0);
    }
  }, [navigating]);

  /*
   * Arrival, acknowledged. Guidance has already stopped itself and dropped both
   * subscriptions by the time this is reachable — this is only the card being
   * dismissed, and it lands on `PreviewCard`: the hostel selected, its photos
   * and its price, which is the state the reader started from and the one they
   * want now they are standing outside it. Stopping *mid-route* deliberately
   * does not do this: it leaves directions open, because somebody who stopped
   * by accident wants Start again, not a photo strip.
   */
  const finishArrival = useCallback(() => {
    guidance.stop();
    // `selectedId`, not the previous choice: a reader who arrived at a
    // deep-linked hostel has never set `choice`, and reading it there would
    // close the card instead of opening the preview.
    setChoice({ directions: false, id: selectedId });
  }, [guidance, selectedId]);

  /*
   * Keep the display on, but only while actually guiding.
   *
   * A phone that sleeps thirty seconds into a walk is a navigation app that
   * does not work, and pressing the power button at every junction is not a
   * workaround. It is an effect keyed on `navigating` rather than a bare
   * `useKeepAwake()`, which would hold the lock for as long as the map screen
   * is open — including while somebody browses hostels from a sofa.
   *
   * `expo-keep-awake` is autolinked through `expo`, so this needs no rebuild;
   * the explicit dependency in `package.json` is there so the import does not
   * break the day that transitive version moves.
   */
  useEffect(() => {
    if (!navigating) {
      return;
    }

    void activateKeepAwakeAsync(NAVIGATION_WAKE_TAG);

    return () => {
      void deactivateKeepAwake(NAVIGATION_WAKE_TAG);
    };
  }, [navigating]);

  const close = useCallback(() => setChoice(NOTHING_CHOSEN), []);

  /**
   * A hostel chosen from the list rather than from its pin.
   *
   * It ends in exactly the state a pin tap ends in — that hostel selected, its
   * card open, no route — reached the other way round: the pin for a hostel you
   * searched for is often off screen, which is what made the old count pill a
   * dead end. So this centres as well as selects, at a zoom close enough to read
   * the street the hostel is on rather than the district it is in.
   *
   * The query is deliberately **not** cleared. Somebody searching "Baneshwor"
   * is usually looking through the answers, not at one of them, and a field that
   * empties itself makes them type it again to see the second.
   */
  const openResult = useCallback((hostel: PublicHostel) => {
    const point = hostelCoordinates(hostel);

    setChoice({ directions: false, id: hostel.id });

    if (point) {
      map.current?.center(point, 16);
    }

    // Blur closes the list (it hangs off `searching`); the dismiss is for
    // Android, where blurring a field does not always take the keyboard with it.
    field.current?.blur();
    Keyboard.dismiss();
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <MapExplorer
        layer={layer}
        markers={markers}
        me={here}
        meAccuracyMeters={navigating ? guidance.accuracyMeters : null}
        meHeading={navigating ? guidance.heading : null}
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
            onBlur={() => setSearching(false)}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            placeholder="Search hostels on the map"
            placeholderTextColor={colors.mutedForeground}
            ref={field}
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
          The results, as a list, once the typing has stopped.
          =================================================

          This was a count — "3 hostels" — on the reasoning that the pins *are*
          the results and a list over the map would cover the thing the search
          just changed. The second half of that is still true, which is why the
          list is capped at `MAX_RESULTS` and closes the moment anything is
          chosen; the first half was not. A pin is only a result you can act on
          if you can *see* it, and the hostel somebody just typed the name of is
          usually the one off the edge of the screen. The count told them it
          existed and gave them no way to reach it.

          It hangs off `searching` as well as the query so it is a thing that
          appears while you are looking for something, rather than a panel that
          sits on the map from the first keystroke until the box is emptied.

          While the first word is still being typed there is nothing worth
          showing — `search` is empty, so `matches` is the whole catalogue, and
          eight arbitrary hostels flashing up before the real answer is noise.
          Once there *is* an answer on screen, later keystrokes leave it there
          and let it change: a quarter-second of slightly stale rows reads as
          fast, and a quarter-second of "Searching…" between every letter reads
          as slow.
        */}
        {searching && query.trim() ? (
          <View
            className="mt-2 overflow-hidden rounded-2xl border border-border"
            style={{ backgroundColor: colors.card, maxHeight: RESULTS_MAX_HEIGHT }}
          >
            {settling && !search.trim() ? (
              <View className="px-3 py-3">
                <Text variant="caption">Searching…</Text>
              </View>
            ) : matches.length === 0 ? (
              <View className="px-3 py-3">
                <Text variant="muted">{`No hostels match "${search.trim()}"`}</Text>
              </View>
            ) : (
              <ScrollView
                /*
                  Without this the first tap is spent dismissing the keyboard and
                  the row never fires — the classic "I had to tap it twice".
                */
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {matches.slice(0, MAX_RESULTS).map((hostel) => (
                  <ResultRow hostel={hostel} key={hostel.id} me={me} onPress={openResult} />
                ))}

                {matches.length > MAX_RESULTS ? (
                  <View className="px-3 py-2">
                    <Text variant="caption">
                      {`${matches.length - MAX_RESULTS} more are on the map — type a little more to narrow it down.`}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>

      {/* ---- map controls ---- */}
      <View className="absolute right-4 gap-2" style={{ top: insets.top + 72 }}>
        <MapButton
          disabled={nearby.isBusy}
          label={navigating ? "Back to my position" : "Centre on me"}
          name="locate"
          onPress={() => {
            /*
             * While navigating this is the way back. The page stops following
             * the moment the reader drags or pinches — otherwise it would fight
             * them for the map — so something has to hand it back, and this is
             * the button that already means "put me on screen". `center` clears
             * that flag, so the next fix follows again.
             *
             * It re-centres at the navigation zoom rather than 15: coming back
             * mid-route to a wider view than the one being navigated is a second
             * surprise on top of the one they were fixing.
             */
            if (here) {
              map.current?.center(here, navigating ? NAVIGATION_ZOOM : 15);
              return;
            }

            void nearby.enable();
          }}
        />
        <MapButton label="Show every hostel" name="scan-outline" onPress={() => map.current?.fitAll()} />

        <MapButton
          active={layersOpen}
          label="Map style"
          name="layers-outline"
          onPress={() => setLayersOpen((open) => !open)}
        />

        {/*
          Only while navigating, because that is the only state where north is
          not up. A compass on a north-up map is a needle that never moves.
        */}
        {navigating ? (
          <Compass
            facing={guidance.heading}
            northUp={northUp}
            onPress={() => setNorthUp((current) => !current)}
          />
        ) : null}

        {/*
          A panel rather than a cycling button: three sources, and a button that
          rotates through them hides what the other two are until you have
          pressed it twice.
        */}
        {layersOpen ? (
          <View
            className="absolute right-0 top-24 w-36 overflow-hidden rounded-2xl border border-border"
            style={{ backgroundColor: colors.card }}
          >
            {MAP_LAYERS.map((option) => (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected: option.id === layer }}
                className="flex-row items-center gap-2 border-b border-border px-3 py-2.5 active:opacity-70"
                key={option.id}
                onPress={() => {
                  setLayer(option.id);
                  setLayersOpen(false);
                }}
              >
                <Ionicons
                  color={option.id === layer ? colors.primary : colors.mutedForeground}
                  name={option.id === layer ? "radio-button-on" : "radio-button-off"}
                  size={15}
                />

                <Text
                  className={option.id === layer ? "font-semibold text-primary" : ""}
                  variant="label"
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* ---- the selected hostel ---- */}
      {selected ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-3"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          {navigating || arrived ? (
            <NavCard
              guidance={guidance}
              hostel={selected}
              onStop={arrived ? finishArrival : guidance.stop}
            />
          ) : directions ? (
            <RouteCard
              canStart={Boolean(me && road.data)}
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
              guidanceStatus={guidance.status}
              onStart={startGuidance}
              seconds={road.data?.durationSeconds ?? 0}
              starting={guidance.status === "starting"}
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

/**
 * Which way is north, and which way the reader is facing.
 *
 * Two readings in one control. The needle points at true north on the screen —
 * so it is upright on a north-up map and turns as the map turns — and the two
 * letters under it say where the *device* is pointing, which is the question
 * "am I walking the right way" actually asks. Eight points only; see
 * `cardinalFor`.
 *
 * Tapping it locks the map north-up and tapping again lets it follow the
 * heading, which is what the same button does in every other map application.
 */
function Compass({
  facing,
  northUp,
  onPress,
}: {
  /** The device's heading, or null before the compass has settled. */
  facing: number | null;
  northUp: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  // The map is rotated by minus the heading, so north on screen is at minus
  // that again — which is the heading itself, unless the map is locked north-up
  // and north is simply up.
  const needle = northUp || facing === null ? 0 : -facing;

  return (
    <Pressable
      accessibilityLabel={northUp ? "Follow the direction I am facing" : "Face north"}
      accessibilityRole="button"
      accessibilityState={{ selected: northUp }}
      className="h-11 w-11 items-center justify-center rounded-full border border-border active:opacity-70"
      onPress={onPress}
      style={{ backgroundColor: colors.card }}
    >
      <Ionicons
        color={colors.primary}
        name="navigate"
        size={15}
        // Ionicons' navigate glyph points up-right; the -45 makes it point up,
        // and the needle rotation is applied on top of that.
        style={{ transform: [{ rotate: `${needle - 45}deg` }] }}
      />

      <Text className="text-[9px] font-bold text-muted-foreground">
        {facing === null ? "—" : cardinalFor(facing)}
      </Text>
    </Pressable>
  );
}

function MapButton({
  active = false,
  disabled = false,
  label,
  name,
  onPress,
}: {
  /** Drawn as pressed while the thing it opens is open. */
  active?: boolean;
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
      accessibilityState={{ disabled, expanded: active }}
      className="h-11 w-11 items-center justify-center rounded-full border border-border active:opacity-70"
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: active ? colors.brandSoft : colors.card,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Ionicons color={active ? colors.primary : colors.foreground} name={name} size={19} />
    </Pressable>
  );
}

/**
 * One search result: enough to tell two hostels apart, and nothing more.
 *
 * Name, place, distance, price — the four things somebody scanning a list of
 * hostels with similar names is actually choosing between. Not a photograph:
 * this list is a step on the way to the card that has eight of them, and a row
 * tall enough for a thumbnail is a list that fits three answers instead of eight.
 *
 * The distance is only drawn when there is a fix, and it is the straight-line
 * one — the same number the cards elsewhere in the app show, computed the same
 * way (`haversineMeters`), so a hostel does not change how far away it is
 * depending on which screen is asking. The routed distance costs a network
 * request per row and belongs on the one hostel that gets chosen.
 */
function ResultRow({
  hostel,
  me,
  onPress,
}: {
  hostel: PublicHostel;
  /** The device, when it has a fix. Its absence simply drops the distance. */
  me: Coordinates | null;
  onPress: (hostel: PublicHostel) => void;
}) {
  const { colors } = useAppTheme();

  const point = hostelCoordinates(hostel);
  const distance = me && point ? haversineMeters(me, point) : null;

  return (
    <Pressable
      accessibilityLabel={hostel.name}
      accessibilityRole="button"
      className="flex-row items-center gap-3 border-b border-border px-3 py-2.5 active:opacity-70"
      onPress={() => onPress(hostel)}
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-full"
        style={{ backgroundColor: colors.brandSoft }}
      >
        <Ionicons color={colors.primary} name="location" size={15} />
      </View>

      <View className="flex-1 gap-0.5">
        <Text className="font-semibold" numberOfLines={1} variant="label">
          {hostel.name}
        </Text>

        <Text numberOfLines={1} variant="caption">
          {[
            locationLabel(hostel.location) || "Location not published",
            distance === null ? null : formatDistance(distance),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      <Text className="text-xs font-bold text-primary">{priceRange(hostel.pricing)}</Text>
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
  canStart,
  distance,
  exact,
  guidanceStatus,
  hostel,
  loading,
  me,
  mode,
  nearby,
  onBack,
  onClose,
  onMode,
  onStart,
  seconds,
  starting,
}: {
  /** A fix **and** a road route. Neither alone is something to navigate along. */
  canStart: boolean;
  distance: number | null;
  /** True when the number came from the router rather than from haversine. */
  exact: boolean;
  /** How the last attempt to start guidance ended, if there was one. */
  guidanceStatus: GuidanceStatus;
  hostel: PublicHostel;
  loading: boolean;
  /** The device. Its absence is the whole difference between this card's two states. */
  me: Coordinates | null;
  mode: RouteMode;
  nearby: ReturnType<typeof useNearby>;
  onBack: () => void;
  onClose: () => void;
  onMode: (mode: RouteMode) => void;
  onStart: () => void;
  seconds: number;
  /** Permission asked, or waiting on the first fix. */
  starting: boolean;
}) {
  const { colors } = useAppTheme();

  const minutes = Math.max(1, Math.round(seconds / 60));
  const blocked = nearby.status === "blocked" || guidanceStatus === "blocked";

  /*
   * Why Start is not going to work, when it is not.
   *
   * Four ways this screen can fail to navigate — refused, blocked, no fix, no
   * route — and each gets its own sentence, because "it didn't work" leaves the
   * reader tapping a grey button. The `me === null` branch below already covers
   * the case where there is no position at all, along with the action that
   * fixes it; this line is for everything that is only discovered once Start
   * has been pressed, plus the one case where there is a fix but no road.
   */
  const trouble =
    guidanceStatus === "denied"
      ? "Navigation needs your location and the request was refused. Press Start to ask again."
      : guidanceStatus === "blocked"
        ? "Location is blocked for this app, so navigation cannot follow you. Open settings to allow it."
        : guidanceStatus === "unavailable"
          ? "No position came back — check that location is switched on, then press Start again."
          : me && !exact && !loading
            ? "There is no road route to this hostel, so there is nothing to navigate along."
            : null;

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

      {/*
        The toggle, and the way in. Two graphs, two genuinely different answers
        — see routing.ts — and Start beside them rather than under the numbers,
        because the profile is the thing you choose *before* setting off and
        this keeps the pair in one row.

        Start is disabled until there is both a fix and a route: without a
        position there is nothing to follow, and without a route there is
        nothing to follow it along. A Start button that spins forever is the one
        outcome worth designing out.
      */}
      <View className="flex-row items-center gap-2">
        <View
          className="flex-1 flex-row gap-1 rounded-2xl p-1"
          style={{ backgroundColor: colors.muted }}
        >
          <ModeTab active={mode === "car"} icon="car-outline" label="Vehicle" onPress={() => onMode("car")} />
          <ModeTab active={mode === "foot"} icon="walk-outline" label="Walk" onPress={() => onMode("foot")} />
        </View>

        <Button
          disabled={!canStart}
          label="Start"
          loading={starting}
          onPress={onStart}
          size="sm"
        />
      </View>

      {trouble ? (
        <View className="flex-row items-start gap-2">
          <Ionicons
            color={colors.mutedForeground}
            name="alert-circle-outline"
            size={14}
            style={{ marginTop: 2 }}
          />

          <Text className="flex-1" variant="caption">
            {trouble}
          </Text>
        </View>
      ) : null}

      {/*
        Blocked *with* a fix already in hand — permission revoked after this
        screen read a position. The branch below only offers Settings when there
        is no position at all, so without this the message names an action the
        reader has no way to take.
      */}
      {blocked && me ? (
        <Button label="Open settings" onPress={nearby.openSettings} size="sm" variant="outline" />
      ) : null}

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
            {blocked
              ? "Location is switched off for this app, so there is nothing to measure from."
              : "Turn on location to draw the way there. Your position is used on this screen and never saved."}
          </Text>

          <Button
            label={blocked ? "Open settings" : "Use my location"}
            loading={nearby.isBusy}
            onPress={() => {
              if (blocked) {
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

/**
 * The card while it is actually guiding: one instruction, and a way out.
 *
 * Everything on it is sized by how long the reader can look at it, which on a
 * pavement is about a second. So the maneuver is the only large thing — an
 * arrow, the distance to it, and the instruction under it — and the trip totals
 * sit small underneath, because "how far is left" is a question you ask when
 * you have stopped walking.
 *
 * Stop is full width and always in the same place. Leaving must be one tap, and
 * one that cannot be missed while moving.
 */
function NavCard({
  guidance,
  hostel,
  onStop,
}: {
  guidance: Guidance;
  hostel: PublicHostel;
  onStop: () => void;
}) {
  const { colors } = useAppTheme();

  const { remainingMeters, remainingSeconds, rerouting, stale, status, step } = guidance;
  const minutes = remainingSeconds === null ? null : Math.max(1, Math.round(remainingSeconds / 60));

  /*
   * Arrived. The hook has already taken both subscriptions down and the map has
   * turned back to north-up, so all that is left is to say so and get out of
   * the way — one button, which lands on the hostel's own card.
   */
  if (status === "arrived") {
    return (
      <View
        className="gap-3 rounded-3xl border border-border p-3"
        style={{ backgroundColor: colors.card }}
      >
        <View className="flex-row items-center gap-3">
          <View
            className="h-12 w-12 items-center justify-center rounded-2xl"
            style={{ backgroundColor: colors.brandSoft }}
          >
            <Ionicons color={colors.primary} name="flag" size={26} />
          </View>

          <View className="flex-1 gap-0.5">
            <Text className="text-xl font-bold text-foreground">You have arrived</Text>

            <Text numberOfLines={2} variant="muted">
              {hostel.name}
            </Text>
          </View>
        </View>

        <Button label="Done" onPress={onStop} />
      </View>
    );
  }

  return (
    <View
      className="gap-3 rounded-3xl border border-border p-3"
      style={{ backgroundColor: colors.card }}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-12 w-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: colors.brandSoft }}
        >
          <Ionicons color={colors.primary} name={maneuverIcon(step?.step)} size={26} />
        </View>

        <View className="flex-1 gap-0.5">
          <Text className="text-xl font-bold text-foreground">
            {step ? formatManeuverDistance(step.distanceMeters) : "On the way"}
          </Text>

          <Text numberOfLines={2} variant="muted">
            {step
              ? instructionFor(step.step)
              : `Follow the route on the map to ${hostel.name}`}
          </Text>
        </View>
      </View>

      {/*
        The one line that is not the maneuver. `stale` means the reader is off
        the route and no replacement came back, so what is drawn is a route from
        where they were — saying that plainly is the whole point, because the
        alternative is a line that quietly stops being guidance.
      */}
      <View className="flex-row items-center gap-2">
        <Ionicons
          color={stale ? colors.mutedForeground : colors.primary}
          name={stale ? "alert-circle-outline" : "navigate"}
          size={14}
        />

        <Text className="flex-1" numberOfLines={1} variant="caption">
          {rerouting
            ? "Off the route — finding a new one…"
            : stale
              ? "Off the route, and no new one came back. The line is from where you were."
              : [
                  remainingMeters === null ? null : formatDistance(remainingMeters),
                  minutes === null ? null : `${minutes} min left`,
                ]
                  .filter(Boolean)
                  .join(" · ") || `Heading to ${hostel.name}`}
        </Text>
      </View>

      <Button label="Stop" onPress={onStop} variant="outline" />
    </View>
  );
}

/**
 * An Ionicon for the maneuver.
 *
 * Deliberately coarse: left, right, straight, back, and the two that are their
 * own shape (a roundabout and the flag at the end). A glanceable arrow that says
 * "left" is worth more than a precise one that has to be studied to tell a slight
 * left from a sharp one — the words underneath carry that distinction.
 */
function maneuverIcon(step: RouteStep | undefined): keyof typeof Ionicons.glyphMap {
  if (!step) {
    return "navigate";
  }

  const { modifier, type } = step.maneuver;

  if (type === "arrive") {
    return "flag";
  }

  if (type === "roundabout" || type === "rotary") {
    return "sync";
  }

  if (modifier === "uturn") {
    return "arrow-undo";
  }

  if (modifier?.includes("left")) {
    return "arrow-back";
  }

  if (modifier?.includes("right")) {
    return "arrow-forward";
  }

  return "arrow-up";
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
