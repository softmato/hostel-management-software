import { useCallback, useState } from "react";
import { Linking } from "react-native";

import type { Coordinates } from "@/lib/geo";
import { requestDeviceLocation } from "@/lib/location";
import { toastError, toastInfo } from "@/lib/toast";

/**
 * "Near me", as a piece of screen state.
 *
 * Owns the permission dance and the one reading, and nothing else — the sorting
 * itself is `sortByDistance` in `lib/geo.ts`, which is pure and tested.
 *
 * ## The coordinate lives here and dies here
 *
 * It is `useState`, not Redux. Redux is persisted by `redux-persist`, so a
 * coordinate dispatched into it would be written to the device's disk and kept
 * across launches — that is a location history, not a sort key. Unmount the
 * screen and the position is gone, which is the correct lifetime for something
 * used to order a list.
 *
 * ## Every failure keeps the screen working
 *
 * Denied, blocked, services off, no fix in eight seconds: all of them turn the
 * toggle back off and leave the list exactly as the server sorted it, with a
 * message saying why. The one thing this must never do is leave a spinner on a
 * list that was already usable.
 */

export type NearbyStatus =
  | "idle"
  /** Asking, or waiting on a fix. */
  | "locating"
  /** Sorted by distance. */
  | "ready"
  /** Refused, but the prompt still works next time. */
  | "denied"
  /** Refused permanently — only the system settings screen can undo it. */
  | "blocked"
  /** Allowed, but no position: services off, or the fix timed out. */
  | "unavailable";

export function useNearby() {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<NearbyStatus>("idle");

  const disable = useCallback(() => {
    setCoordinates(null);
    setStatus("idle");
  }, []);

  const enable = useCallback(async () => {
    // Raised before the first `await`, in the handler, so the spinner is on
    // screen while the system dialogue is up.
    setStatus("locating");

    const outcome = await requestDeviceLocation();

    if (outcome.kind === "granted") {
      setCoordinates(outcome.coordinates);
      setStatus("ready");
      return;
    }

    setCoordinates(null);

    if (outcome.kind === "denied") {
      setStatus(outcome.canAskAgain ? "denied" : "blocked");

      if (outcome.canAskAgain) {
        toastInfo(
          "Location is off",
          "Hostels are still listed cheapest first.",
        );
      } else {
        // Android never shows the prompt again once it has been refused twice,
        // so pointing at settings is the only honest next step.
        toastInfo(
          "Location is blocked",
          "Turn it on in Settings to sort by distance.",
        );
      }

      return;
    }

    setStatus("unavailable");
    toastError(
      "Couldn't find you",
      "Check that location is switched on, then try again.",
    );
  }, []);

  /** For the "Open settings" action a `blocked` state offers. */
  const openSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  return {
    coordinates,
    disable,
    enable,
    /** True while sorting is actually in effect. */
    isActive: status === "ready" && coordinates !== null,
    isBusy: status === "locating",
    openSettings,
    status,
  };
}
