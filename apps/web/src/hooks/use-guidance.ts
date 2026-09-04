"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  requestDeviceLocation,
  requestHeadingPermission,
  watchDeviceHeading,
  watchNavigationPosition,
  type NavigationFix,
  type Unsubscribe,
} from "@/lib/maps/geolocation";
import {
  chooseHeading,
  distanceToPath,
  hasArrived,
  isOffRoute,
  nextStep,
  progressAlong,
  smoothHeading,
  type UpcomingStep,
} from "@/lib/maps/navigation";
import { fetchRoadRoute, type RoadRoute, type RouteMode } from "@/lib/maps/routing";
import type { Coordinates } from "@/lib/maps/types";

/**
 * Turn-by-turn, as a piece of screen state.
 *
 * The browser twin of `apps/mobile/src/hooks/use-guidance.ts`, with the same
 * states, the same fused heading, the same off-route rule and the same refusal
 * to present a straight line as guidance. It owns the two subscriptions, the
 * fused heading, where the reader is on the line, and the decision to ask for a
 * new route. The page owns the map and the panels. Everything decided here is
 * computed by the pure functions in `lib/maps/navigation.ts`, which is where
 * the arithmetic is tested — what is left is lifetimes, and lifetimes are the
 * part that leaks.
 *
 * ## The position lives here and dies here
 *
 * `useState`, never a store. Nothing writes it to `localStorage`, to a cookie
 * or into the URL; see the header of `lib/maps/geolocation.ts`. Navigation
 * raises the *accuracy* of what is held in memory; it does not change where it
 * is held or how long it lives.
 *
 * ## Every subscription is removed twice over
 *
 * Once on `stop()` and on arrival, and again in the effect cleanup when the
 * page unmounts. A `watchPosition` left running is a GPS the reader cannot
 * switch off, at the most expensive accuracy the platform has, on a tab they
 * believe they closed.
 *
 * ## Rerouting is rationed
 *
 * OSRM is somebody else's free service, and a fix arrives every second or two.
 * A new route is only asked for after the reader has been off the line for
 * three fixes in a row **and** at least ten seconds have passed since the last
 * one — a single bad fix under a bridge is not a wrong turn, and an app that
 * requests a route per fix is one that gets the whole product's IP banned.
 *
 * ## On a laptop, half of this never engages
 *
 * There is no magnetometer, and course over ground is `null` below walking
 * pace, so `heading` stays `null` and the map stays north-up. That is correct —
 * a laptop does not turn — and it is why nothing here treats a missing heading
 * as an error.
 */

/**
 * How much of each new heading sample to take. Low enough that the compass's
 * jitter does not reach the map, high enough that a real turn arrives within a
 * second or so.
 */
const HEADING_ALPHA = 0.2;

/** Consecutive off-route fixes before the route is questioned. */
const OFF_ROUTE_FIXES = 3;

/** And the shortest gap between two reroutes, however lost the reader is. */
const REROUTE_COOLDOWN_MS = 10_000;

export type GuidanceStatus =
  | "idle"
  /** Permission asked, waiting on the first fix. */
  | "starting"
  /** Running. */
  | "guiding"
  /** Within thirty metres of the hostel. */
  | "arrived"
  /** Blocked for this origin. Only the reader's site settings can undo it. */
  | "denied"
  /** The prompt was dismissed rather than answered — Start can simply re-ask. */
  | "dismissed"
  /** No geolocation API: the page is not on https, or the browser is too old. */
  | "insecure"
  /** Permitted, but the browser gave no position: services off, or no signal. */
  | "unavailable";

export type Guidance = {
  /** Metres of uncertainty in the current fix, for the circle on the map. */
  accuracyMeters: number | null;
  /** Where the device is facing, fused and smoothed. `null` until it knows. */
  heading: number | null;
  /** True from the moment Start is pressed until it stops, arrives or fails. */
  isNavigating: boolean;
  /** The reader's position, at navigation accuracy. Never persisted. */
  position: Coordinates | null;
  /** Metres to the hostel along the road, counting down. */
  remainingMeters: number | null;
  /** And that distance as seconds, at the route's own average pace. */
  remainingSeconds: number | null;
  /** True while a replacement route is in flight. */
  rerouting: boolean;
  /** The line being followed: the original, or the latest reroute. */
  route: RoadRoute | null;
  start: () => void;
  /**
   * True when the reader is off the line and no new route came back. The line
   * on screen is then a route from where they *were*, and the panel says so —
   * navigation must never present a stale or straight line as guidance.
   */
  stale: boolean;
  status: GuidanceStatus;
  /** The maneuver being approached, and how far off it is. */
  step: UpcomingStep | null;
  stop: () => void;
};

export function useGuidance({
  destination,
  mode,
  route,
}: {
  destination: Coordinates | null;
  mode: RouteMode;
  /** The route the page already has. Guidance follows it until it reroutes. */
  route: RoadRoute | null;
}): Guidance {
  const [status, setStatus] = useState<GuidanceStatus>("idle");
  const [fix, setFix] = useState<NavigationFix | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [stale, setStale] = useState(false);
  /** A reroute's answer. Null means the page's own route is still the one. */
  const [replacement, setReplacement] = useState<RoadRoute | null>(null);

  const line = replacement ?? route;

  /*
   * Everything below is read from callbacks that outlive the render they were
   * created in — a fix arriving two seconds later must see the destination the
   * reader is actually walking to, not the one that was on screen when the
   * subscription started. Refs, synced in effects rather than written during
   * render.
   */
  const destinationRef = useRef(destination);
  const modeRef = useRef(mode);
  const lineRef = useRef(line);
  const compassRef = useRef<number | null>(null);
  const fixRef = useRef<NavigationFix | null>(null);
  const headingRef = useRef<number | null>(null);
  const offRouteRef = useRef(0);
  const lastRerouteRef = useRef(0);
  const positionSub = useRef<Unsubscribe | null>(null);
  const headingSub = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    lineRef.current = line;
  }, [line]);

  const teardown = useCallback(() => {
    positionSub.current?.();
    positionSub.current = null;
    headingSub.current?.();
    headingSub.current = null;
  }, []);

  /** Fuse whichever of the two sources is worth believing, then ease into it. */
  const applyHeading = useCallback(() => {
    const chosen = chooseHeading({
      compass: compassRef.current,
      gpsHeading: fixRef.current?.heading ?? null,
      speed: fixRef.current?.speed ?? null,
    });

    if (chosen === null) {
      return;
    }

    const smoothed = smoothHeading(headingRef.current, chosen, HEADING_ALPHA);

    headingRef.current = smoothed;
    setHeading(smoothed);
  }, []);

  const reroute = useCallback(async (from: Coordinates) => {
    const to = destinationRef.current;

    if (!to) {
      return;
    }

    setRerouting(true);

    const fresh = await fetchRoadRoute(from, to, modeRef.current);

    setRerouting(false);

    if (fresh) {
      setReplacement(fresh);
      setStale(false);
      return;
    }

    /*
     * No route came back. The line on screen is a route from somewhere the
     * reader no longer is, so it is marked stale and the panel says so. What
     * this must not do is fall back to the dashed straight line the directions
     * panel uses: a straight line through a riverbank is a claim about the
     * world, and presenting it as guidance is the one outcome worth avoiding.
     */
    setStale(true);
  }, []);

  const onFix = useCallback(
    (next: NavigationFix) => {
      fixRef.current = next;
      setFix(next);
      setStatus((current) => (current === "starting" ? "guiding" : current));
      applyHeading();

      const to = destinationRef.current;

      if (to && hasArrived(next.coordinates, to)) {
        teardown();
        setStatus("arrived");
        return;
      }

      const following = lineRef.current;

      if (!following || following.points.length < 2) {
        return;
      }

      const off = isOffRoute(
        distanceToPath(next.coordinates, following.points),
        modeRef.current,
      );

      if (!off) {
        offRouteRef.current = 0;
        return;
      }

      offRouteRef.current += 1;

      if (offRouteRef.current < OFF_ROUTE_FIXES) {
        return;
      }

      const now = Date.now();

      if (now - lastRerouteRef.current < REROUTE_COOLDOWN_MS) {
        return;
      }

      lastRerouteRef.current = now;
      offRouteRef.current = 0;

      void reroute(next.coordinates);
    },
    [applyHeading, reroute, teardown],
  );

  const onCompass = useCallback(
    (degrees: number) => {
      compassRef.current = degrees;
      applyHeading();
    },
    [applyHeading],
  );

  const stop = useCallback(() => {
    teardown();
    compassRef.current = null;
    fixRef.current = null;
    headingRef.current = null;
    offRouteRef.current = 0;
    lastRerouteRef.current = 0;
    setFix(null);
    setHeading(null);
    setReplacement(null);
    setRerouting(false);
    setStale(false);
    setStatus("idle");
  }, [teardown]);

  const start = useCallback(() => {
    /*
     * First, and synchronously.
     *
     * iOS grants the compass only from inside a user gesture, and the gesture
     * ends at the first `await` — so this call has to happen before the
     * location request the rest of this function waits on, not after it. The
     * promise is awaited later; what matters is when it was *called*.
     */
    const compass = requestHeadingPermission();

    void (async () => {
      // Raised before the first await, so the button shows it is working while
      // the browser's own prompt is up.
      setStatus("starting");
      setReplacement(null);
      setStale(false);
      offRouteRef.current = 0;
      lastRerouteRef.current = 0;

      const outcome = await requestDeviceLocation();

      if (outcome.kind === "denied") {
        // Dismissed, not blocked: Start is still the button that fixes it, so
        // the panel must not send the reader off to their browser settings.
        setStatus(outcome.canAskAgain ? "dismissed" : "denied");
        return;
      }

      if (outcome.kind === "insecure") {
        setStatus(outcome.kind);
        return;
      }

      /*
       * The coarse reading seeds the arrow so it appears at once rather than
       * after the first navigation-accuracy fix, which can take a few seconds.
       * `unavailable` from it is not fatal — a cold GPS often has no cached
       * position and then locks perfectly well.
       */
      if (outcome.kind === "granted") {
        const seed: NavigationFix = {
          accuracyMeters: null,
          coordinates: outcome.coordinates,
          heading: null,
          speed: null,
        };

        fixRef.current = seed;
        setFix(seed);
      }

      let failed = false;

      positionSub.current = watchNavigationPosition(onFix, () => {
        // Only the *first* error matters: once fixes are arriving, a single
        // failed one is a moment of no signal, not the end of the session.
        if (!fixRef.current) {
          failed = true;
          teardown();
          setStatus("unavailable");
        }
      });

      if (failed) {
        return;
      }

      if (await compass) {
        headingSub.current = watchDeviceHeading(onCompass);
      }

      setStatus((current) =>
        current === "starting" && fixRef.current ? "guiding" : current,
      );
    })();
  }, [onCompass, onFix, teardown]);

  // The second removal. Leaving the page must switch the GPS off even if
  // nothing called `stop`.
  useEffect(() => teardown, [teardown]);

  const isNavigating = status === "starting" || status === "guiding";

  /*
   * Keep the display awake, but only while actually guiding.
   *
   * A screen that sleeps thirty seconds into a walk is a navigation app that
   * does not work. The lock has to be re-taken on `visibilitychange` because
   * the browser drops it whenever the tab is hidden — including for the moment
   * the screen does turn off — and a lock that is never re-acquired is one that
   * works exactly once per page load.
   *
   * Every part of this is feature-detected and every failure is swallowed:
   * older iOS Safari has no Wake Lock API at all, and a request can be rejected
   * outright (low battery, a policy). None of that is worth a message on
   * screen — the reader can still see the map, it just dims.
   */
  useEffect(() => {
    if (!isNavigating || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = () => {
      if (released || document.visibilityState !== "visible") {
        return;
      }

      void navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (released) {
            void lock.release().catch(() => {});
            return;
          }

          sentinel = lock;
        })
        .catch(() => {});
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [isNavigating]);

  const position = fix?.coordinates ?? null;

  // Pulled out of `line` first: reading `line.steps` inside the memo makes the
  // React Compiler infer `line` as the dependency, which no longer matches the
  // narrower one written here, and it then declines to optimise the hook at all.
  const steps = line?.steps;

  const step = useMemo(
    () => (steps && position ? nextStep(steps, position) : null),
    [position, steps],
  );

  const remainingMeters = useMemo(
    () => (line && position ? progressAlong(line.points, position) : null),
    [line, position],
  );

  /*
   * The ETA is the route's own average pace applied to what is left, rather
   * than the reader's current speed: at a crossing their speed is zero, and an
   * ETA computed from that is either infinite or the last number it happened to
   * hold. OSRM's duration already knows what this route is like to travel.
   */
  const remainingSeconds =
    line && remainingMeters !== null && line.distanceMeters > 0
      ? Math.round(line.durationSeconds * (remainingMeters / line.distanceMeters))
      : null;

  return {
    accuracyMeters: fix?.accuracyMeters ?? null,
    heading,
    isNavigating,
    position,
    remainingMeters,
    remainingSeconds,
    rerouting,
    route: line,
    start,
    stale,
    status,
    step,
    stop,
  };
}
