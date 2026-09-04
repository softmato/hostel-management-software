"use client";

import { useCallback, useEffect, useState } from "react";

import { requestDeviceLocation } from "@/lib/maps/geolocation";
import type { Coordinates } from "@/lib/maps/types";

/**
 * One coarse reading of where the reader is, for distances and the blue dot.
 *
 * The browser counterpart of `useNearby` on the phone, and it differs from it
 * in one deliberate way: **it never prompts on its own.**
 *
 * The phone asks once per install, because a permission dialogue there is a
 * normal part of opening an app. A website that throws the location prompt up
 * the moment a page loads is the pattern browsers have spent a decade training
 * people to refuse — Chrome and Safari both penalise it, and a refusal is
 * sticky for the origin, so one unprompted ask can cost the feature for good.
 *
 * So the policy here is the honest half of the phone's:
 *
 * - **Already granted for this origin** → read it silently on mount, and the
 *   distances are there before the reader looks for them.
 * - **Not yet granted** → nothing happens until they press something. The map
 *   is perfectly usable without a position; only distances and directions need
 *   one, and both have a control that asks for it.
 *
 * `navigator.permissions` is what makes the first branch possible without
 * asking. Firefox has supported it for geolocation since 2024; where it is
 * missing the hook simply waits for the button, which is the safe direction.
 *
 * The coordinate is state and nothing else — never a store, never storage,
 * never the URL. See the header of `lib/maps/geolocation.ts`.
 */

export type DeviceLocationStatus =
  | "idle"
  | "asking"
  | "granted"
  /** Blocked for this origin. Only the reader's site settings can undo it. */
  | "denied"
  /** The prompt was dismissed rather than answered — pressing again re-asks. */
  | "dismissed"
  /** No geolocation API at all: not a secure context, or an old browser. */
  | "insecure"
  | "unavailable";

export type DeviceLocation = {
  coordinates: Coordinates | null;
  /** Ask for it. Safe to call when it is already known — it just re-reads. */
  enable: () => void;
  isBusy: boolean;
  status: DeviceLocationStatus;
};

export function useDeviceLocation(): DeviceLocation {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<DeviceLocationStatus>("idle");

  const read = useCallback(async () => {
    setStatus("asking");

    const outcome = await requestDeviceLocation();

    if (outcome.kind === "granted") {
      setCoordinates(outcome.coordinates);
      setStatus("granted");
      return;
    }

    if (outcome.kind === "denied") {
      setStatus(outcome.canAskAgain ? "dismissed" : "denied");
      return;
    }

    setStatus(outcome.kind);
  }, []);

  const enable = useCallback(() => {
    void read();
  }, [read]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.permissions?.query) {
        return;
      }

      const state = await navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => result.state)
        .catch(() => "prompt" as PermissionState);

      // "prompt" and "denied" both mean: say nothing, wait to be asked.
      if (!cancelled && state === "granted") {
        void read();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [read]);

  return { coordinates, enable, isBusy: status === "asking", status };
}
