"use client";

import L from "leaflet";
import type * as Leaflet from "leaflet";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { MAP_LAYERS, mapLayer, type MapLayerId } from "@/lib/maps/layers";
import { headingDifference } from "@/lib/maps/navigation";
import type { Coordinates } from "@/lib/maps/types";

import "leaflet/dist/leaflet.css";

/**
 * One Leaflet map, owned by one component, driven by effects.
 *
 * ## This must be loaded through `next/dynamic` with `ssr: false`
 *
 * `import L from "leaflet"` runs code that reads `window` and `document` at
 * module scope, so evaluating this file on the server throws. The import is
 * static rather than the `await import("leaflet")` dance in `leaflet-map.tsx`
 * because a static one gives real types and lets every effect below use `L`
 * directly — the `ssr: false` on the caller is what makes that safe, and
 * `npm run web:build` is what catches a caller that forgets.
 *
 * ## What the phone does and this does not
 *
 * The mobile twin (`apps/mobile/src/components/map-explorer.tsx`) draws Leaflet
 * inside a `WebView` and drives it with `injectJavaScript`, because a React
 * Native tree cannot hold a Leaflet object. **Here Leaflet is an object in the
 * same JavaScript as the React tree**, so `window.__map`, the `ready` gate, the
 * message handler and the JSON-escaped marker payload are all dead weight and
 * none of it is ported (`WEB_MAP_PLAN.md` §4.1).
 *
 * What *is* ported is every rule that is about the map rather than the bridge:
 * the takeover guard, fitting a route once per route, following without
 * stealing the zoom, the rotation stage, and attribution drawn outside the
 * rotating element.
 *
 * ## The map is created once and then *mutated*
 *
 * Leaflet holds the state; React holds the decisions. The map is built in a
 * mount effect with no dependencies and never rebuilt — every prop change is a
 * small imperative update in its own effect, so typing in the search box moves
 * pins instead of re-creating a map, and the reader's pan and zoom survive
 * every re-render the page has for its own reasons.
 */

/**
 * Deliberately four fields: what the *map* needs, and nothing the panel needs.
 *
 * Price, rating, photos and facilities are read from the hostel itself when a
 * pin is chosen. A marker type that grew to the full listing would have sixty
 * hostels' photo arrays recomputed on every keystroke to draw sixty 18px dots.
 */
export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  /** The pin's label, its `title`, and what a screen reader announces. */
  name: string;
};

export type MapHandle = {
  /** Centre on a point — "locate me", or a search result being chosen. */
  center: (point: Coordinates, zoom?: number) => void;
  /** Frame every pin currently on the map. */
  fitAll: () => void;
  /**
   * Navigation mode: put the map here.
   *
   * A `null` zoom keeps whatever zoom the map is on — which is what makes a
   * reader's scroll survive the next fix — so the zoom is worth passing only on
   * the first fix of a session. A `null` bearing leaves the rotation alone.
   */
  follow: (point: Coordinates, zoom: number | null, bearing: number | null) => void;
  /**
   * A compass sample with no new fix.
   *
   * Both this and `follow` drop a bearing that has moved less than two degrees
   * from the last one applied: a magnetometer at rest jitters by about that
   * much, and repainting for it turns the map by nothing the reader can see.
   */
  setBearing: (bearing: number) => void;
  /** The zoom buttons a desktop reader expects. See §D.6 of the plan. */
  zoomBy: (delta: number) => void;
};

export type MapCanvasProps = {
  /** Which tile source to draw. The attribution chip follows it. */
  layer?: MapLayerId;
  markers: MapMarker[];
  /** The reader, when there is a fix. Drawn as a dot or an arrow, never a pin. */
  me: Coordinates | null;
  /**
   * Radial uncertainty of that fix, in metres, drawn as a circle around it.
   *
   * Navigation only. The coarse reading the rest of the page takes is accurate
   * to a suburb, and a circle that size is a blue wash over the whole screen.
   */
  meAccuracyMeters?: number | null;
  /** Which way the reader is facing. Turns the dot into an arrow. */
  meHeading?: number | null;
  onSelect: (id: string | null) => void;
  /**
   * The line to draw, in order. `null` clears it.
   *
   * `dashed` says the line is the straight one between two points rather than a
   * road, and the map draws it differently for a reason: a straight line
   * through a riverbank rendered as a solid route is a direction to walk into a
   * river. The panel says so too, but the map itself should not lie.
   */
  route: { dashed: boolean; points: Coordinates[] } | null;
  selectedId: string | null;
};

/**
 * Degrees of compass movement worth a repaint. Below this the map turns by less
 * than the reader can see, and a magnetometer at rest jitters by about this
 * much all on its own.
 */
const BEARING_EPSILON_DEGREES = 2;

/** Where the map opens before it has anything to frame. */
const KATHMANDU: [number, number] = [27.7172, 85.324];

/** The blue every mapping application uses for "you". Not the brand accent. */
const DEVICE_BLUE = "#1d7fe0";

/**
 * The pin and rotation CSS.
 *
 * It is a `<style>` element rather than Tailwind classes because these classes
 * are put on DOM that **Leaflet** creates, from `divIcon`, outside React's
 * tree — Tailwind's compiler never sees those strings, and a class it has not
 * seen is a class it has not emitted. The names are prefixed so two of them on
 * one page cannot collide, and re-rendering the same rules twice is harmless.
 */
const CANVAS_CSS = `
/*
 * Rotation, without a rotation plugin.
 *
 * Leaflet 1.9 cannot turn its own canvas, so the whole map is turned in CSS
 * instead: the stage is the window the reader looks through, and the canvas is
 * a larger square spun inside it. The square's side is the diagonal of the
 * window (set in JS below), because a rectangle rotated inside its own bounds
 * shows bare background at the corners — at 45 degrees, a lot of it.
 *
 * --bearing is the rotation applied to the map, which is the *negative* of the
 * reader's heading: facing east (90) turns the world 90 anticlockwise so that
 * east is up. Getting that sign wrong gives a map that turns the wrong way,
 * which reads as a broken compass rather than a broken stylesheet.
 */
.hh-stage { position: absolute; inset: 0; overflow: hidden; }
.hh-canvas {
  left: 50%;
  position: absolute;
  top: 50%;
  /* Linear, not eased: the bearing arrives as a steady stream of samples, and
     an ease-out on each one makes a continuous turn stutter. */
  transition: transform 300ms linear;
  transform: translate(-50%, -50%) rotate(var(--bearing, 0deg));
  transform-origin: 50% 50%;
}
/*
 * Two elements, one pin. The stage above turns everything inside it, markers
 * included, so a pin left as one element hangs upside down whenever the reader
 * faces south. The wrapper undoes the stage's rotation — it is the exact
 * opposite of --bearing — and the pin inside keeps its own -45deg, which is
 * what makes a circle with one square corner look like a teardrop.
 */
.hh-pin-wrap {
  height: 100%;
  position: relative;
  transform: rotate(calc(-1 * var(--bearing, 0deg)));
  transition: transform 300ms linear;
  width: 100%;
}
.hh-pin {
  background: var(--brand-teal);
  border: 2px solid #ffffff;
  border-radius: 50% 50% 50% 0;
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  height: 18px;
  transform: rotate(-45deg);
  transition: height .12s ease, width .12s ease;
  width: 18px;
}
/* The chosen pin grows rather than changing colour: the palette has one accent,
   and a second colour here would read as a second kind of thing. */
.hh-pin.hh-on { height: 26px; width: 26px; }
/*
 * Every pin's name, drawn as part of the pin itself.
 *
 * Not a Leaflet tooltip, which was the first attempt on the phone: a tooltip is
 * positioned by writing a transform on its own element, so the counter-rotation
 * cannot live there, and unbinding one left its node in the pane — three
 * selections, three labels on screen. Inside the icon the label has neither
 * problem. It is created and destroyed with the marker, and it sits inside the
 * wrapper, which is already counter-rotated, so it stays upright at every
 * bearing without knowing that rotation exists.
 */
.hh-pin-label {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  bottom: 22px;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
  color: var(--foreground);
  font: 600 10px/1.3 system-ui, -apple-system, sans-serif;
  left: 50%;
  /* Sixty of these share one screen, so an unselected name stays on a single
     line and clips: the labels are there to tell the dots apart, and a wall of
     wrapped text would hide the map they sit on. */
  max-width: 104px;
  overflow: hidden;
  padding: 2px 6px;
  /* The pin under it is the click target; this is only ever read. */
  pointer-events: none;
  position: absolute;
  text-align: center;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
  width: max-content;
}
/* The chosen one is the only label allowed to take room: it clears the bigger
   pin, shows the whole name, and is ringed in the accent. */
.hh-pin-label.hh-on {
  border-color: var(--brand-teal);
  bottom: 30px;
  font-size: 11px;
  line-height: 1.35;
  max-width: 180px;
  overflow: visible;
  padding: 3px 7px;
  white-space: normal;
}
.hh-pin-label-sub {
  color: var(--muted-foreground);
  font: 600 8px/1.5 system-ui, -apple-system, sans-serif;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.hh-me {
  background: ${DEVICE_BLUE};
  border: 3px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  height: 16px;
  width: 16px;
}
/*
 * The same dot, once it knows which way it is pointing. Drawn pointing north
 * and rotated by the heading, so in north-up mode it points where the reader is
 * facing, and in navigation mode — where the stage is turned by the negative of
 * that same heading — the two cancel and it points up the screen. One element
 * that is right in both modes, rather than two markers.
 */
.hh-me-arrow {
  border-bottom: 20px solid ${DEVICE_BLUE};
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  filter: drop-shadow(0 0 1.5px #ffffff) drop-shadow(0 1px 2px rgba(0,0,0,.45));
  height: 0;
  transition: transform 300ms linear;
  transform-origin: 50% 60%;
  width: 0;
}
/* Leaflet paints its own panes white by default under some resets. */
.hh-canvas .leaflet-container { background: var(--muted); }
/*
 * The route's colour is set here rather than through Leaflet's \`color\` option
 * because that option becomes an SVG *attribute*, and an attribute cannot read
 * a custom property — \`stroke="var(--brand-teal)"\` is simply an invalid colour
 * and the line comes out unpainted. A CSS rule can, and it also outranks the
 * attribute, so the accent stays a token instead of a hex copied into JS.
 */
.hh-route { stroke: var(--brand-teal); }
.hh-route.hh-dashed { stroke: ${DEVICE_BLUE}; }
`;

export const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas(
  {
    layer = "standard",
    markers,
    me,
    meAccuracyMeters,
    meHeading,
    onSelect,
    route,
    selectedId,
  },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);

  /*
   * Everything Leaflet is holding, in refs. None of it renders, all of it
   * changes several times a second while navigating, and a `setState` for any
   * of it would re-render the page to move a dot.
   */
  const pinsRef = useRef<Leaflet.LayerGroup | null>(null);
  const byIdRef = useRef<Record<string, Leaflet.Marker>>({});
  const nameByIdRef = useRef<Record<string, string>>({});
  const meMarkerRef = useRef<Leaflet.Marker | null>(null);
  const meKindRef = useRef<"arrow" | "dot" | null>(null);
  const meCircleRef = useRef<Leaflet.Circle | null>(null);
  const lineRef = useRef<Leaflet.Polyline | null>(null);
  const routeShapeRef = useRef<string | null>(null);
  const tilesRef = useRef<Leaflet.TileLayer | null>(null);
  const layerIdRef = useRef<MapLayerId | null>(null);
  const selectedRef = useRef<string | null>(null);
  const fittedRef = useRef(false);
  const bearingRef = useRef(0);
  const sentBearingRef = useRef<number | null>(null);

  /*
   * Whether the reader has taken the map into their own hands.
   *
   * The bug this exists for: every scripted view change — a re-drawn route, a
   * fix while following — used to run unconditionally, so a drag or a scroll
   * was undone by the next one, and on a page that re-renders for its own
   * reasons that is a map which springs back the moment you touch it.
   *
   * So: one gesture and the map belongs to the reader. Nothing automatic moves
   * the view after that. Only an explicit instruction — the locate button, show
   * every hostel, choosing a result, pressing Start — takes it back, and each
   * of those clears the flag itself.
   *
   * The flag is set from the reader's own input rather than from Leaflet's
   * events, and that distinction is the whole reliability of it: `zoomstart`
   * fires for the map's own animations too, so inferring a gesture from it
   * means guarding every scripted move with a timer — and a gesture made inside
   * that timer is then swallowed, which is exactly the fault this is meant to
   * fix, moved somewhere harder to see.
   *
   * A single click is deliberately not in the list: choosing a pin is not
   * taking the map over, and it must not stop the arrow being followed.
   */
  const touchedRef = useRef(false);

  // `onSelect` changes identity on most renders; the marker handlers below are
  // created once per marker set and would otherwise call a stale one.
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  /**
   * Padding for any fit, in a container the reader cannot see all of.
   *
   * Leaflet frames bounds inside *its own* container, and since the rotation
   * stage that container is the diagonal square, not the window. Fitting a
   * route to the square therefore leaves its ends off both edges of the screen.
   * Half the overflow on each axis is exactly the strip that is not visible,
   * and it is added to whatever padding the caller already wanted for the
   * search card and the panel.
   *
   * Exact at north-up, which is the only state that fits anything: navigation
   * follows, it does not fit. At a bearing the visible region is a rotated
   * rectangle and this is merely generous, which is the harmless direction.
   */
  const fitPadding = useCallback(
    (
      topLeft: [number, number],
      bottomRight: [number, number],
    ): Leaflet.FitBoundsOptions => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      const overflowX = Math.max(
        0,
        ((canvas?.clientWidth ?? 0) - (stage?.clientWidth ?? 0)) / 2,
      );
      const overflowY = Math.max(
        0,
        ((canvas?.clientHeight ?? 0) - (stage?.clientHeight ?? 0)) / 2,
      );

      return {
        paddingBottomRight: [bottomRight[0] + overflowX, bottomRight[1] + overflowY],
        paddingTopLeft: [topLeft[0] + overflowX, topLeft[1] + overflowY],
      };
    },
    [],
  );

  /**
   * The pin, its hostel's name, and — when it is the chosen one — a line
   * underneath saying that this is the one being looked at.
   *
   * Built as DOM rather than as an HTML string, because the name is
   * hostel-supplied text and `divIcon` takes an element as readily as markup.
   * A hostel called `<img onerror=…>` stays a name rather than becoming a tag.
   */
  const icon = useCallback((on: boolean, name: string) => {
    const wrap = document.createElement("div");
    const body = document.createElement("div");

    wrap.className = "hh-pin-wrap";
    body.className = on ? "hh-pin hh-on" : "hh-pin";
    wrap.append(body);

    if (name) {
      const chip = document.createElement("div");

      chip.className = on ? "hh-pin-label hh-on" : "hh-pin-label";
      chip.append(document.createTextNode(name));

      if (on) {
        const sub = document.createElement("div");

        sub.className = "hh-pin-label-sub";
        sub.append(document.createTextNode("Viewing now"));
        chip.append(sub);
      }

      wrap.append(chip);
    }

    return L.divIcon({
      className: "",
      html: wrap,
      iconAnchor: on ? [13, 26] : [9, 18],
      iconSize: on ? [26, 26] : [18, 18],
    });
  }, []);

  /** Turn the map so the given heading points up the screen. */
  const applyBearing = useCallback((heading: number) => {
    const map = mapRef.current;
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    bearingRef.current = heading;
    // The negation lives here and nowhere else: one line in the codebase knows
    // that the map turns the opposite way to the reader.
    canvas.style.setProperty("--bearing", `${-heading}deg`);

    /*
     * Leaflet reads the *axis-aligned bounding box* of its container to convert
     * a pointer movement into a map movement, so inside a rotated element a
     * drag moves the map at an angle to the mouse. Noted but never fixed on the
     * phone (`MAP_NAV_PLAN.md` §6); with a mouse it is worse, because the
     * pointer stays visible next to the place it is not going.
     *
     * So dragging is switched off for as long as the map is turned. Nothing is
     * lost: the compass control locks north-up in one click, and that restores
     * it. Scroll and the zoom buttons keep working either way.
     */
    if (map) {
      if (heading === 0) {
        map.dragging.enable();
      } else {
        map.dragging.disable();
      }
    }
  }, []);

  const worthSending = useCallback((bearing: number | null) => {
    if (bearing === null) {
      return false;
    }

    if (
      sentBearingRef.current !== null &&
      headingDifference(sentBearingRef.current, bearing) <= BEARING_EPSILON_DEGREES
    ) {
      return false;
    }

    sentBearingRef.current = bearing;

    return true;
  }, []);

  /**
   * Padding that clears the panel actually on screen.
   *
   * The panel is a column down the left on a wide window and a sheet across the
   * bottom on a narrow one, so a fit that always padded the left would push
   * everything off the top of a phone. `fitPadding` adds the hidden overflow on
   * top of whichever of the two this returns; the pair is `[x, y]`, which is
   * Leaflet's `Point` order and the easiest thing here to write backwards.
   */
  const framePadding = useCallback((): Leaflet.FitBoundsOptions => {
    const wide = (stageRef.current?.clientWidth ?? 0) >= 768;

    return wide ? fitPadding([408, 96], [56, 56]) : fitPadding([40, 96], [40, 320]);
  }, [fitPadding]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    const points = Object.values(byIdRef.current).map((pin) => pin.getLatLng());

    if (!map) {
      return;
    }

    touchedRef.current = false;

    if (points.length === 1) {
      map.setView(points[0], 15, { animate: true });
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), framePadding());
    }
  }, [framePadding]);

  useImperativeHandle(
    ref,
    () => ({
      center: (point, zoom = 15) => {
        // An explicit instruction: it hands the map back, so following resumes.
        touchedRef.current = false;
        mapRef.current?.setView([point.lat, point.lng], zoom, { animate: true });
      },
      fitAll,
      follow: (point, zoom, bearing) => {
        const map = mapRef.current;

        // The bearing still tracks the reader even when the view does not: the
        // map should say which way they are facing wherever they have panned to.
        if (bearing !== null && worthSending(bearing)) {
          applyBearing(bearing);
        }

        if (!map || touchedRef.current) {
          return;
        }

        /*
         * No animation, on purpose. A fix arrives every second or two, and
         * Leaflet's pan animation restarted by each one is a map that never
         * settles — it slides continuously towards a position it never reaches.
         * The smoothness comes from the stage's CSS transition instead, which
         * is animating a rotation nothing else is fighting over.
         */
        map.setView([point.lat, point.lng], zoom ?? map.getZoom(), { animate: false });
      },
      setBearing: (bearing) => {
        // Zero is always applied: straightening the map after Stop must not be
        // dropped as "close enough to the last heading".
        if (bearing === 0) {
          sentBearingRef.current = null;
          applyBearing(0);
          return;
        }

        if (worthSending(bearing)) {
          applyBearing(bearing);
        }
      },
      zoomBy: (delta) => {
        const map = mapRef.current;

        if (!map) {
          return;
        }

        /*
         * A button, not a gesture — so it does *not* set the takeover flag. The
         * reader zooming in on the junction ahead while navigating still wants
         * the map to keep following them.
         */
        map.setZoom(map.getZoom() + delta, { animate: true });
      },
    }),
    [applyBearing, fitAll, worthSending],
  );

  /* ---------------------------------------------------------------- the map */

  useEffect(() => {
    const container = canvasRef.current;
    const stage = stageRef.current;

    if (!container || !stage || mapRef.current) {
      return;
    }

    /*
     * Leaflet's own controls sit in the container's corners, and a rotated
     * container turns its corners off screen. Both are drawn by the page
     * instead: attribution below, zoom buttons in the controls stack.
     */
    const map = L.map(container, {
      attributionControl: false,
      zoomControl: false,
    }).setView(KATHMANDU, 12);

    mapRef.current = map;
    pinsRef.current = L.layerGroup().addTo(map);

    /*
     * The square has to be the diagonal of the window, and it has to be resized
     * whenever the window is. `invalidateSize` runs after every change, or
     * Leaflet keeps loading tiles for the size it last measured, which shows up
     * as grey bands sliding in from the edges as the map turns.
     */
    const fitStage = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const side = Math.ceil(Math.sqrt(width * width + height * height));

      container.style.width = `${side}px`;
      container.style.height = `${side}px`;
      map.invalidateSize();
    };

    fitStage();

    // A ResizeObserver rather than a window listener: the panel below `md` is a
    // sheet that changes the map's height without the window changing at all.
    const observer = new ResizeObserver(fitStage);

    observer.observe(stage);

    const takeOver = () => {
      touchedRef.current = true;
    };
    const surface = map.getContainer();

    // A pinch, not a tap: one finger on a pin is a selection, not a takeover.
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        takeOver();
      }
    };

    map.on("dragstart", takeOver);
    surface.addEventListener("wheel", takeOver, { passive: true });
    surface.addEventListener("dblclick", takeOver);
    surface.addEventListener("touchstart", onTouchStart, { passive: true });

    /*
     * A click on the map itself, not on a pin, closes the panel.
     *
     * The check is not paranoia. Leaflet fires a marker's own `click` and then
     * propagates the same event up to the map, so choosing a pin arrived here
     * as "select this hostel" immediately followed by "select nothing" — which
     * is the panel that sometimes refused to open. Whether it *did* propagate
     * depended on which element under the cursor was hit (the pin body, its
     * label, the icon's padding), which is what made it look intermittent.
     *
     * Reading the DOM target is deterministic where reasoning about Leaflet's
     * propagation is not: if the click landed anywhere inside a marker icon, it
     * was not a click on the empty map.
     */
    map.on("click", (event) => {
      const target = event.originalEvent.target;

      if (target instanceof Element && target.closest(".leaflet-marker-icon")) {
        return;
      }

      onSelectRef.current(null);
    });

    return () => {
      observer.disconnect();
      surface.removeEventListener("wheel", takeOver);
      surface.removeEventListener("dblclick", takeOver);
      surface.removeEventListener("touchstart", onTouchStart);
      map.remove();
      mapRef.current = null;
      pinsRef.current = null;
      byIdRef.current = {};
      nameByIdRef.current = {};
      meMarkerRef.current = null;
      meKindRef.current = null;
      meCircleRef.current = null;
      lineRef.current = null;
      routeShapeRef.current = null;
      tilesRef.current = null;
      layerIdRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  /* ------------------------------------------------------------- the tiles */

  useEffect(() => {
    const map = mapRef.current;
    const next = MAP_LAYERS.find((option) => option.id === layer);

    if (!map || !next || next.id === layerIdRef.current) {
      return;
    }

    layerIdRef.current = next.id;

    /*
     * Come down to the new source's ceiling before swapping. OpenTopoMap stops
     * at 17 where the others reach 19, and a map left at 18 over a layer that
     * has no tile there is a grey screen that reads as a broken switch.
     */
    if (map.getZoom() > next.maxZoom) {
      map.setZoom(next.maxZoom, { animate: false });
    }

    const replacement = L.tileLayer(next.url, {
      maxZoom: next.maxZoom,
      subdomains: next.subdomains,
    }).addTo(map);

    /*
     * The old layer goes only once the new one has drawn something. Removing it
     * first leaves the page's background colour on screen for as long as the
     * network takes, which on a photograph layer is long enough to look broken.
     */
    const previous = tilesRef.current;

    if (previous) {
      replacement.once("load", () => map.removeLayer(previous));
      setTimeout(() => map.removeLayer(previous), 3_000);
    }

    tilesRef.current = replacement;
  }, [layer]);

  /* ------------------------------------------------------------- the pins */

  useEffect(() => {
    const map = mapRef.current;
    const pins = pinsRef.current;

    if (!map || !pins) {
      return;
    }

    pins.clearLayers();
    byIdRef.current = {};
    nameByIdRef.current = {};

    for (const marker of markers) {
      const on = marker.id === selectedRef.current;
      const pin = L.marker([marker.lat, marker.lng], {
        icon: icon(on, marker.name),
        title: marker.name,
        // Now that every pin carries a name, neighbouring labels overlap. The
        // chosen one is lifted out of that pile rather than read through it.
        zIndexOffset: on ? 1_000 : 0,
      });

      pin.on("click", () => onSelectRef.current(marker.id));
      pin.addTo(pins);
      byIdRef.current[marker.id] = pin;
      nameByIdRef.current[marker.id] = marker.name;
    }

    // Frame the catalogue once, on the first set that has anything in it.
    // Refitting on every search would yank the map out from under somebody who
    // had panned somewhere deliberately.
    if (!fittedRef.current && markers.length > 0) {
      fittedRef.current = true;
      fitAll();
    }
  }, [fitAll, icon, markers]);

  /* -------------------------------------------------------- the selection */

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const previous = selectedRef.current;

    for (const key of [previous, selectedId]) {
      const pin = key ? byIdRef.current[key] : null;

      if (key && pin) {
        pin.setIcon(icon(key === selectedId, nameByIdRef.current[key] ?? ""));
        pin.setZIndexOffset(key === selectedId ? 1_000 : 0);
      }
    }

    selectedRef.current = selectedId;

    const chosen = selectedId ? byIdRef.current[selectedId] : null;

    if (chosen) {
      // Enough of a nudge to bring a pin out from behind the panel, without the
      // jump of a re-centre.
      map.panTo(chosen.getLatLng(), { animate: true, duration: 0.25 });
    }
  }, [icon, selectedId]);

  /* ----------------------------------------------------------- the reader */

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (!me) {
      if (meMarkerRef.current) {
        map.removeLayer(meMarkerRef.current);
        meMarkerRef.current = null;
        meKindRef.current = null;
      }

      if (meCircleRef.current) {
        map.removeLayer(meCircleRef.current);
        meCircleRef.current = null;
      }

      return;
    }

    const kind = typeof meHeading === "number" ? "arrow" : "dot";
    const latlng: [number, number] = [me.lat, me.lng];

    /*
     * The marker is moved rather than replaced whenever it can be. Replacing it
     * on every fix throws away the arrow's CSS transition, so a heading that
     * eased round smoothly on paper snaps in ten-degree steps on screen — and
     * it is one more layer add/remove per second for no gain.
     */
    if (meMarkerRef.current && meKindRef.current === kind) {
      meMarkerRef.current.setLatLng(latlng);
    } else {
      if (meMarkerRef.current) {
        map.removeLayer(meMarkerRef.current);
      }

      meMarkerRef.current = L.marker(latlng, {
        icon:
          kind === "arrow"
            ? L.divIcon({
                className: "",
                html: '<div class="hh-me-arrow"></div>',
                iconAnchor: [9, 12],
                iconSize: [18, 20],
              })
            : L.divIcon({
                className: "",
                html: '<div class="hh-me"></div>',
                iconAnchor: [8, 8],
                iconSize: [16, 16],
              }),
        interactive: false,
        // Above the pins: the reader is looking for themselves first, and a
        // hostel marker sitting on top of the arrow is the one pin they cannot
        // move out of the way.
        zIndexOffset: 1_000,
      }).addTo(map);
      meKindRef.current = kind;
    }

    if (kind === "arrow") {
      const arrow = meMarkerRef.current
        .getElement()
        ?.querySelector<HTMLElement>(".hh-me-arrow");

      if (arrow) {
        arrow.style.transform = `rotate(${meHeading}deg)`;
      }
    }

    /*
     * The accuracy circle is the honest picture of the fix, and it is what stops
     * "the arrow is in the wrong place" being a mystery — a 30 m circle says the
     * map knows it could be anywhere in that yard. Drawn only while navigating,
     * because the coarse reading everywhere else is accurate to a suburb and a
     * circle that size is a blue wash over the screen.
     */
    if (typeof meAccuracyMeters === "number" && meAccuracyMeters > 0) {
      if (meCircleRef.current) {
        meCircleRef.current.setLatLng(latlng);
        meCircleRef.current.setRadius(meAccuracyMeters);
      } else {
        meCircleRef.current = L.circle(latlng, {
          color: DEVICE_BLUE,
          fillColor: DEVICE_BLUE,
          fillOpacity: 0.12,
          interactive: false,
          opacity: 0.35,
          radius: meAccuracyMeters,
          weight: 1,
        }).addTo(map);
      }
    } else if (meCircleRef.current) {
      map.removeLayer(meCircleRef.current);
      meCircleRef.current = null;
    }
  }, [me, meAccuracyMeters, meHeading]);

  /* ------------------------------------------------------------ the route */

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (lineRef.current) {
      map.removeLayer(lineRef.current);
      lineRef.current = null;
    }

    if (!route || route.points.length < 2) {
      // Clearing the line forgets the shape too, so choosing the same hostel
      // again frames it rather than deciding it has already been framed.
      routeShapeRef.current = null;
      return;
    }

    const latlngs = route.points.map(
      (point) => [point.lat, point.lng] as [number, number],
    );

    /*
     * Whether this is a different route or the same one arriving again.
     *
     * The page rebuilds its route object on any re-render that recomputes it —
     * the position, the hostel, the profile. Refitting on each of those
     * reframed the map and threw away the reader's zoom, which is the fault
     * this was reported as on the phone. Ends and length are enough to tell two
     * routes apart: no reroute keeps all three.
     */
    const shape = `${latlngs.length}:${latlngs[0].join(",")}:${latlngs[latlngs.length - 1].join(",")}`;
    const changed = shape !== routeShapeRef.current;

    routeShapeRef.current = shape;

    lineRef.current = L.polyline(latlngs, {
      className: route.dashed ? "hh-route hh-dashed" : "hh-route",
      dashArray: route.dashed ? "6 8" : undefined,
      interactive: false,
      opacity: 0.9,
      weight: 5,
    }).addTo(map);

    // A new route frames itself; the same route arriving again does not. And
    // neither happens while the reader is holding the map.
    if (changed && !touchedRef.current) {
      map.fitBounds(L.latLngBounds(latlngs), framePadding());
    }
  }, [framePadding, route]);

  return (
    <div className="absolute inset-0 bg-muted">
      <style dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />

      <div className="hh-stage" ref={stageRef}>
        <div className="hh-canvas" ref={canvasRef} />
      </div>

      {/*
        OpenStreetMap's licence requires this to be visible, so it is drawn
        outside the rotating stage: Leaflet's own control lives in a corner, and
        a rotated map turns its corners off the screen.
      */}
      <div className="pointer-events-none absolute bottom-1 left-1 z-10 rounded bg-card/85 px-1.5 py-0.5 text-[9px] text-muted-foreground">
        {mapLayer(layer).attribution}
      </div>
    </div>
  );
});
