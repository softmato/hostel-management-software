import { isUsableCoordinate } from "./geo";
import { normaliseHeading } from "./navigation";
import type { Coordinates } from "./types";

/**
 * Where the reader is, and which way they are facing, held nowhere.
 *
 * The browser twin of `apps/mobile/src/lib/location.ts`. The APIs are
 * different — `navigator.geolocation` instead of `expo-location`, DOM events
 * instead of a heading watcher — but the policy is the same one, and it is the
 * part worth carrying across verbatim:
 *
 * ## Nothing is stored
 *
 * The coordinate is handed to the caller and lives in that component's state
 * for exactly as long as the page does. It is never written to a store, never
 * to `localStorage` or a cookie, and never into the URL — a lat/lng in any of
 * those is a location history, and `apps/web` already has a test holding
 * attendance pings to the same line. The one place a position leaves the
 * machine at all is the routing request in `./routing.ts`, which says so.
 *
 * ## What a browser adds that a phone does not
 *
 * - **A secure context is required.** `https://` or `localhost`; a LAN IP is
 *   neither, so testing on a phone over the local network needs a tunnel. The
 *   API is simply absent there, which is worth saying on screen rather than
 *   letting Start fail with "no position".
 * - **A refusal is two different things, and the error does not say which.**
 *   `PERMISSION_DENIED` comes back both when the reader *blocks* the site —
 *   permanent, and only their own site settings can undo it — and when they
 *   simply dismiss the prompt without answering, which leaves the permission at
 *   `prompt` and means the next click will ask again. Telling somebody to go
 *   and edit their site permissions when the truth is "press it again" is a
 *   dead end, so `requestDeviceLocation` reads the permission back after a
 *   refusal and reports `canAskAgain` — the browser's own version of the flag
 *   the phone gets for free.
 * - **Most machines have no compass at all.** A laptop does not turn, so
 *   `watchDeviceHeading` below simply never fires on one. Everything
 *   downstream is written to treat a `null` heading as ordinary.
 */

/** How long to wait for a fix before giving up. Matches the phone's. */
const FIX_TIMEOUT_MS = 8_000;

/** One fix from the navigation watcher. */
export type NavigationFix = {
  /** Radial uncertainty in metres, for the circle around the arrow. */
  accuracyMeters: number | null;
  coordinates: Coordinates;
  /** Course over ground in degrees clockwise from north, or `null`. */
  heading: number | null;
  /** Metres per second, or `null`. */
  speed: number | null;
};

/** Every watcher here hands back the one function that ends it. */
export type Unsubscribe = () => void;

export type LocationOutcome =
  | { coordinates: Coordinates; kind: "granted" }
  /**
   * Refused. `canAskAgain` is false only when the reader actually blocked the
   * site — dismissing the prompt is a refusal the next click can undo.
   */
  | { canAskAgain: boolean; kind: "denied" }
  /** No geolocation API at all: not a secure context, or an old browser. */
  | { kind: "insecure" }
  /** Permitted, but no fix: services off, indoors, or the timeout above. */
  | { kind: "unavailable" };

function hasGeolocation(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "geolocation" in navigator &&
    window.isSecureContext
  );
}

/**
 * One coarse reading, prompting if the browser has not asked yet.
 *
 * Every failure path resolves an outcome rather than rejecting: the caller is a
 * control on a page full of working content, and a rejected promise there turns
 * "we could not find you" into an error state over the whole screen.
 *
 * `enableHighAccuracy` is deliberately **off**. This reading sorts hostels and
 * draws a dot; a suburb-accurate answer does that perfectly well, arrives
 * sooner, and on a phone costs a fraction of the battery. Navigation is the one
 * thing that needs better, and it asks for better itself — see below.
 */
export function requestDeviceLocation(): Promise<LocationOutcome> {
  if (!hasGeolocation()) {
    return Promise.resolve({ kind: "insecure" });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        resolve(
          isUsableCoordinate(coordinates)
            ? { coordinates, kind: "granted" }
            : { kind: "unavailable" },
        );
      },
      (error) => {
        if (error.code !== error.PERMISSION_DENIED) {
          resolve({ kind: "unavailable" });
          return;
        }

        /*
         * Which kind of refusal was that? Only the permission itself knows:
         * `denied` is a real block, anything else means the prompt was
         * dismissed and pressing the button again will bring it back. Where
         * `navigator.permissions` is missing we assume the hopeful answer,
         * because the cost of being wrong is one click that does nothing,
         * against telling somebody their browser is blocking a site it is not.
         */
        void readGeolocationPermission().then((state) => {
          resolve({ canAskAgain: state !== "denied", kind: "denied" });
        });
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1_000, timeout: FIX_TIMEOUT_MS },
    );
  });
}

/**
 * The browser's own record of this origin's geolocation permission, or `null`
 * where the Permissions API is not available.
 */
export function readGeolocationPermission(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return Promise.resolve(null);
  }

  return navigator.permissions
    .query({ name: "geolocation" })
    .then((result) => result.state)
    .catch(() => null);
}

/**
 * Stream fine-grained fixes for the length of one navigation session.
 *
 * `enableHighAccuracy` is the most expensive reading the platform offers, so
 * the caller owns its lifetime: the returned function **must** be called when
 * guidance stops, arrives, or the component unmounts. A watcher left running is
 * a GPS the reader cannot switch off, on a page they think they closed.
 *
 * `heading` and `speed` come through as the browser reports them and are `null`
 * when it reports nothing — which is the normal state standing still, and on
 * every desktop. `maximumAge: 0` because a cached fix is not navigation.
 *
 * Fixes with an unusable coordinate are dropped rather than passed on: `0, 0`
 * is in the Gulf of Guinea, and one of those mid-route reads as a reroute
 * across the planet.
 *
 * Permission is the caller's problem. An error is reported through `onError`
 * rather than thrown, because by the time one arrives the caller is a running
 * screen, not a `try` block.
 */
export function watchNavigationPosition(
  onFix: (fix: NavigationFix) => void,
  onError?: () => void,
): Unsubscribe {
  if (!hasGeolocation()) {
    onError?.();

    return () => {};
  }

  const id = navigator.geolocation.watchPosition(
    (position) => {
      const { accuracy, heading, latitude, longitude, speed } = position.coords;
      const coordinates = { lat: latitude, lng: longitude };

      if (!isUsableCoordinate(coordinates)) {
        return;
      }

      onFix({
        accuracyMeters: positiveOrNull(accuracy),
        coordinates,
        heading: positiveOrNull(heading),
        speed: positiveOrNull(speed),
      });
    },
    () => onError?.(),
    { enableHighAccuracy: true, maximumAge: 0, timeout: FIX_TIMEOUT_MS },
  );

  return () => navigator.geolocation.clearWatch(id);
}

type OrientationPermission = {
  requestPermission?: () => Promise<"denied" | "granted">;
};

/**
 * Ask iOS for the compass. **Call this from inside a click handler.**
 *
 * Safari gates device orientation behind a permission that can only be
 * requested during a user gesture, and an `await` before the call ends that
 * gesture — so it must be the first thing the Start handler does, before the
 * location request it then waits on. Asked from an effect it is refused
 * silently, which on screen is indistinguishable from a device with no compass.
 *
 * Everywhere else there is no such gate, so this resolves `true` without
 * asking anything and the subscription below simply works.
 */
export function requestHeadingPermission(): Promise<boolean> {
  const api =
    typeof DeviceOrientationEvent === "undefined"
      ? null
      : (DeviceOrientationEvent as unknown as OrientationPermission);

  if (typeof api?.requestPermission !== "function") {
    return Promise.resolve(true);
  }

  return api
    .requestPermission()
    .then((outcome) => outcome === "granted")
    .catch(() => false);
}

/**
 * Which way the device is pointing, for as long as navigation runs.
 *
 * The compass is the half of the answer GPS cannot give: standing at a junction
 * deciding which way to walk, course over ground is `null` and only the
 * magnetometer knows where the reader is facing.
 *
 * Two events, because no one of them is everywhere.
 * `deviceorientationabsolute` is the one that is actually referenced to north,
 * and where it exists it is the right subscription. Safari does not have it and
 * instead puts a true-north reading on `webkitCompassHeading` of the ordinary
 * `deviceorientation` event.
 *
 * **`alpha` is not a compass bearing.** It is measured *anticlockwise* from
 * north, so a heading is `360 - alpha`; used as-is the arrow turns the wrong
 * way, which reads as broken hardware. And a non-absolute `alpha` is relative
 * to wherever the device happened to be when the page loaded, so it is refused
 * rather than reported as north — a confident wrong bearing is worse than none.
 *
 * On a machine with no compass nothing ever fires, which is not a failure and
 * needs no reporting: `chooseHeading` already treats a missing compass as the
 * ordinary case.
 */
export function watchDeviceHeading(onHeading: (degrees: number) => void): Unsubscribe {
  if (typeof window === "undefined") {
    return () => {};
  }

  const absolute = "ondeviceorientationabsolute" in window;
  const name = absolute ? "deviceorientationabsolute" : "deviceorientation";

  const listener = (event: Event) => {
    const heading = headingFrom(event as DeviceOrientationEvent);

    if (heading !== null) {
      onHeading(heading);
    }
  };

  window.addEventListener(name, listener);

  return () => window.removeEventListener(name, listener);
}

function headingFrom(event: DeviceOrientationEvent): number | null {
  const { webkitCompassHeading } = event as DeviceOrientationEvent & {
    webkitCompassHeading?: number;
  };

  // Safari's, and already clockwise from true north.
  if (typeof webkitCompassHeading === "number" && Number.isFinite(webkitCompassHeading)) {
    return normaliseHeading(webkitCompassHeading);
  }

  if (!event.absolute || typeof event.alpha !== "number" || !Number.isFinite(event.alpha)) {
    return null;
  }

  return normaliseHeading(360 - event.alpha);
}

/**
 * The browser reports `null` for a value it does not have, and some report a
 * negative for the same thing. Zero is kept: it is a real speed (standing
 * still) and a real heading (due north).
 */
function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
