/**
 * Push registration, tap routing and the app-icon badge.
 *
 * Mounted once, at the root. Everything is keyed to the signed-in account:
 * registration re-runs when the account changes, because the `DeviceToken` row
 * belongs to a user id and a shared phone must not keep delivering person A's
 * alerts to person B.
 */

import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useAppSelector } from "@/hooks/redux";
import { resolvePushPath } from "@/lib/push-link";
import {
  forgetPushToken,
  registerPushToken,
  setBadgeCount,
} from "@/lib/push-notifications";

export function usePush() {
  const account = useAppSelector((state) => state.auth.account);
  const isReady = useAppSelector((state) => state.auth.isReady);
  const userId = account?.id ?? null;

  /*
   * Identifiers already routed. The cold-start replay below and the live
   * listener can both surface the *same* response, and without this the app
   * pushes the invoice screen twice — leaving a duplicate in the back stack
   * that the user has to dismiss twice.
   */
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) {
      // Signed out: drop the cached token so the next account re-registers
      // rather than being skipped as "already sent".
      forgetPushToken();
      void setBadgeCount(0);
      return;
    }

    // Deliberately not awaited into the render path, and failure is silent —
    // `registerPushToken` never throws, it reports.
    void registerPushToken();
  }, [userId]);

  useEffect(() => {
    /*
     * Wait for the boot gate. Routing a tap before `isReady` races the
     * `<Redirect>` in `app/index.tsx`: the deep-linked screen mounts, the gate
     * then replaces it with the role's home, and the notification silently does
     * nothing. This is the same ordering trap that left the splash stuck over
     * referral deep links.
     */
    if (!isReady) {
      return;
    }

    function open(response: Notifications.NotificationResponse) {
      const id = response.notification.request.identifier;

      if (handled.current.has(id)) {
        return;
      }

      handled.current.add(id);

      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;

      /*
       * `resolvePushPath` guarantees a route that exists in this build — the
       * server's table names several screens that are still M5/M7 work, and an
       * unrouted push lands on `+not-found`, which reads as the app being
       * broken at the exact moment it just buzzed. See `lib/push-link.ts`.
       */
      router.push(resolvePushPath(data?.path) as never);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(open);

    /*
     * The tap that cold-started the app.
     *
     * `addNotificationResponseReceivedListener` only sees responses delivered
     * *after* it subscribes, and this effect waits on `isReady` — so a tap that
     * launched the app from killed was already delivered and dropped, landing
     * the user on their home screen instead of the thing they tapped. The
     * reference app (`D:\Jiwan-Mijhar`) hit exactly this and its fix is the
     * same call. Deduped against the listener via `handled`, because both can
     * surface one response.
     */
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          open(response);
        }
      })
      .catch(() => undefined);

    return () => subscription.remove();
  }, [isReady]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    /*
     * Nudge the badge while the app is open.
     *
     * The authoritative number is the server's `unreadCount`, which
     * `notifications.tsx` writes whenever the bell is opened — that is what
     * "cleared on read" actually means here. This only keeps the icon honest
     * between those moments, and it is deliberately an increment rather than a
     * fetch: one GET per arriving notification would turn a burst of alerts
     * into a burst of requests, to correct a number nobody is looking at while
     * the app is in front of them.
     */
    const received = Notifications.addNotificationReceivedListener(() => {
      void Notifications.getBadgeCountAsync()
        .then((count) => setBadgeCount(count + 1))
        .catch(() => undefined);
    });

    return () => received.remove();
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    /*
     * Permission can be revoked from system settings while the app sits in the
     * background, and Android never tells the app. Re-registering on
     * foreground is what keeps the `DeviceToken` row from claiming a device
     * that has gone silent — and it costs one request per return to the app,
     * skipped entirely when the token has not changed.
     */
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void registerPushToken();
      }
    });

    return () => subscription.remove();
  }, [userId]);
}
