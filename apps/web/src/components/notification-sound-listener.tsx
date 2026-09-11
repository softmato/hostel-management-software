"use client";

import { useEffect } from "react";

import {
  listenForNotificationSoundRequests,
  primeNotificationSound,
} from "@/lib/notification-sound";

/**
 * Lets any open page play the tone for a push the service worker is about to
 * show — see `lib/notification-sound.ts`.
 *
 * In the root layout rather than beside the socket in `PortalShell`: a browser
 * subscribed from the public site receives pushes too, and the tab someone has
 * open when one arrives may not be a portal.
 *
 * Priming — which fetches the file — happens here only once this browser has
 * granted notifications. A visitor who has not has no push to play a tone for,
 * and should not download one. The portals prime for themselves, because the
 * socket there sounds whether or not push is on.
 */
export function NotificationSoundListener() {
  useEffect(() => {
    const stopListening = listenForNotificationSoundRequests();
    const stopPriming =
      "Notification" in window && Notification.permission === "granted"
        ? primeNotificationSound()
        : () => {};

    return () => {
      stopListening();
      stopPriming();
    };
  }, []);

  return null;
}
