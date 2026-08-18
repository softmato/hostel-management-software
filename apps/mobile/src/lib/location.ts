import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import type { Coordinates } from "@/lib/geo";
import { isUsableCoordinate } from "@/lib/geo";

/**
 * The device's position, asked for once, held nowhere.
 *
 * ## Asked at most once, then never unprompted again
 *
 * The home screen's Nearby row fills itself, so this *is* reached without a tap
 * — but only under two conditions, and the pair is the whole policy:
 *
 * - **Permission already granted** → read the position silently. No dialogue can
 *   appear, and the row is populated by the time the screen settles.
 * - **Never asked on this install** → ask once, and record that it happened
 *   (`rememberLocationPrompt`). Every later launch takes the branch above or
 *   nothing at all, so a refusal is respected permanently rather than re-asked
 *   at every app start.
 *
 * That flag is the reason this is not just `hasPermission()`: Android's own
 * `canAskAgain` only turns false after the *second* refusal, so relying on it
 * would show the dialogue again on the next launch to somebody who has already
 * said no. What is stored is a boolean about this app's behaviour — never a
 * position; see below.
 *
 * ## Coarse, and only coarse
 *
 * `ACCESS_FINE_LOCATION` is in `blockedPermissions` in `app.json`, and the
 * accuracy asked for here is `Low`. Sorting hostels by rough proximity does not
 * need a street-level fix, and asking for one is both a worse dialogue and more
 * than the feature is owed.
 *
 * ## Nothing is stored
 *
 * The coordinate is returned to the caller and lives in that screen's state.
 * It is never dispatched to Redux — `redux-persist` writes Redux to disk, and a
 * lat/lng on disk is a location history. `apps/web` has a test holding
 * attendance pings to the same line; this is the same line.
 */

/** How long to wait for a fix before giving up and leaving the list unsorted. */
const FIX_TIMEOUT_MS = 8_000;

export type LocationOutcome =
  | { coordinates: Coordinates; kind: "granted" }
  /** Refused. `canAskAgain: false` means the prompt is spent — send them to settings. */
  | { canAskAgain: boolean; kind: "denied" }
  /** Permitted, but no fix: services off, indoors, or the timeout above. */
  | { kind: "unavailable" };

/**
 * Whether this install has ever put the location dialogue on screen.
 *
 * AsyncStorage rather than SecureStore or Redux: it is one boolean about what
 * the app has already done, it is not a secret, and it must survive a sign-out
 * — a permission prompt is not something a second account should get to ask
 * again. A read failure returns `true` (as if asked), because the failure mode
 * of guessing wrong in the other direction is prompting somebody repeatedly.
 */
const PROMPTED_KEY = "location.prompted";

export async function hasPromptedForLocation(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPTED_KEY)) !== null;
  } catch {
    return true;
  }
}

export async function rememberLocationPrompt(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPTED_KEY, "1");
  } catch {
    // A screen that cannot record the prompt still works; it just may ask once
    // more on a later launch. Not worth failing the reading over.
  }
}

/** Reads the current grant **without** prompting. */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();

    return granted;
  } catch {
    return false;
  }
}

/**
 * Ask (if needed), then take one reading.
 *
 * Every failure path returns an outcome rather than throwing: the caller is a
 * chip on a screen full of working content, and a rejected promise there turns
 * "we could not find you" into a red error state over the whole list.
 */
export async function requestDeviceLocation(): Promise<LocationOutcome> {
  let permission: Location.LocationPermissionResponse;

  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch {
    return { kind: "unavailable" };
  }

  if (!permission.granted) {
    return { canAskAgain: permission.canAskAgain, kind: "denied" };
  }

  return readPosition();
}

async function readPosition(): Promise<LocationOutcome> {
  try {
    /*
     * The last known fix first: it is instant, it is usually minutes old at
     * worst, and for sorting hostels by kilometres a slightly stale position is
     * indistinguishable from a fresh one. A cold GPS lock can take 30 seconds
     * indoors, which is 30 seconds of a spinner on a list that was already
     * usable.
     */
    const cached = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });

    if (cached && isUsableCoordinate(toCoordinates(cached))) {
      return { coordinates: toCoordinates(cached), kind: "granted" };
    }

    const fresh = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      FIX_TIMEOUT_MS,
    );

    if (!fresh) {
      return { kind: "unavailable" };
    }

    const coordinates = toCoordinates(fresh);

    return isUsableCoordinate(coordinates)
      ? { coordinates, kind: "granted" }
      : { kind: "unavailable" };
  } catch {
    // Location services switched off at the OS level lands here.
    return { kind: "unavailable" };
  }
}

function toCoordinates(position: Location.LocationObject): Coordinates {
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

/** Resolves `null` on timeout. The underlying request is left to settle alone. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}
