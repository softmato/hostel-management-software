/**
 * The socket's lifecycle, tied to the signed-in account.
 *
 * Connects when there is one, disconnects when there is not, and reconnects
 * when the app comes back to the foreground. Everything it receives is routed
 * through `lib/resource-bus`, so no screen subscribes to Pusher directly — a
 * screen names its topics on `useResource` and that is the whole contract.
 */

import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useAppSelector } from "@/hooks/redux";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime";
import { toastInfo, toastUrgent } from "@/lib/toast";

export function useRealtime() {
  const userId = useAppSelector((state) => state.auth.account?.id ?? null);
  const connection = useRef<RealtimeConnection | null>(null);

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;

    async function open() {
      const client = await connectRealtime({
        /*
         * A platform-wide broadcast arrives with no durable row behind it —
         * the dispatch cron writes those later, for people who were offline.
         * So this is shown immediately and left to be de-duplicated by the
         * bell, which reads the row when it eventually exists.
         */
        onAnnouncement: (payload) => {
          const urgent = payload.priority === "URGENT" || payload.priority === "HIGH";
          (urgent ? toastUrgent : toastInfo)(payload.title, payload.body);
        },
        /*
         * Surfaced rather than only badging the bell: the entire reason for
         * the socket is that some of these cannot wait for someone to go
         * looking. A notification that also arrived as a push will not
         * double-toast — a push received in the foreground renders as a system
         * banner, not through this path.
         */
        onNotification: (payload) => {
          const urgent = payload.priority === "URGENT" || payload.kind === "ACTION";
          (urgent ? toastUrgent : toastInfo)(payload.title, payload.body);
        },
      });

      if (cancelled) {
        // Signed out while the config request was in flight. Without this the
        // socket outlives the session it was opened for.
        client?.disconnect();
        return;
      }

      connection.current = client;
    }

    void open();

    return () => {
      cancelled = true;
      connection.current?.disconnect();
      connection.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        connection.current?.reconnect();
      }
    });

    return () => subscription.remove();
  }, [userId]);
}
