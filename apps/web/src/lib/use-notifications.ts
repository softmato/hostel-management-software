"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { browserApi } from "@/lib/browser-api";
import {
  resourceKey,
  useInvalidateResources,
  usePortalResource,
} from "@/lib/portal-query";
import { useNotificationHoldStore } from "@/stores/notification-hold-store";
import { toast } from "@/stores/toast-store";

/**
 * Shared notification state for the bell and the full notifications page.
 *
 * Both surfaces read the same endpoint through the same query cache, so the
 * unread badge in the header and the list on the page can never disagree: a
 * mark-as-read on one invalidates the other in the same tick, and a
 * `notification:new` socket event invalidates both at once (see
 * `RealtimeProvider`).
 *
 * ## Opening clears the badge; clicking clears the tint
 *
 * With `autoMarkRead` on (the bell while open, the page while mounted) every
 * unread row is receipted on the server straight away, so the badge drops the
 * moment somebody looks. The rows that were unread at that moment are held in
 * `notification-hold-store` and come back from this hook with `isRead: false`
 * until they are clicked or "Mark all read" is pressed — so the rendering code
 * reads one field and the tint follows the hold, not the receipt.
 *
 * "Unread" is therefore filtered here from the `all` page rather than asked of
 * the server: once opening has receipted everything, the server's unread filter
 * is always empty, while what the reader means by unread is the tint.
 *
 * ## Every read mutation is optimistic
 *
 * The cache is patched before the request leaves and refetched after it lands,
 * so a click un-tints the row and drops the badge on the same frame.
 */

export type NotificationAction = {
  endpoint: string;
  key: string;
  label: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  payload?: Record<string, unknown>;
  tone?: "default" | "primary" | "danger";
};

export type NotificationItem = {
  actions: NotificationAction[];
  actionState: "PENDING" | "COMPLETED" | "DISMISSED";
  actionTakenKey?: string;
  actionUrl?: string;
  body: string;
  category: string;
  createdAt?: string;
  id: string;
  isRead: boolean;
  kind: "NORMAL" | "ACTION";
  needsAction: boolean;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  title: string;
};

type NotificationPayload = {
  actionCount: number;
  notifications: NotificationItem[];
  unreadCount: number;
};

export type NotificationFilter = "all" | "unread" | "action";

const ALL_ENDPOINT = "/api/v1/notifications";
const ACTION_ENDPOINT = "/api/v1/notifications?filter=action";
const FEED_ENDPOINTS = [ALL_ENDPOINT, ACTION_ENDPOINT];

export function useNotifications(
  filter: NotificationFilter = "all",
  { autoMarkRead = false }: { autoMarkRead?: boolean } = {},
) {
  const client = useQueryClient();
  const invalidate = useInvalidateResources();
  const all = usePortalResource<NotificationPayload>(ALL_ENDPOINT, {
    errorMessage: "Could not load notifications.",
  });
  const action = usePortalResource<NotificationPayload>(
    filter === "action" ? ACTION_ENDPOINT : null,
    { errorMessage: "Could not load notifications." },
  );
  const active = filter === "action" ? action : all;
  const held = useNotificationHoldStore((store) => store.ids);

  // Every filtered view is a projection of the same rows, so any mutation has
  // to drop all of them rather than just the one on screen.
  const refreshAll = useCallback(() => {
    invalidate("/api/v1/notifications*");
  }, [invalidate]);

  /** Patch both cached feeds in place; `update` returns null for "no change". */
  const patchFeeds = useCallback(
    (update: (current: NotificationPayload) => NotificationPayload | null) => {
      for (const url of FEED_ENDPOINTS) {
        client.setQueryData<NotificationPayload>(resourceKey(url), (current) =>
          current === undefined ? current : (update(current) ?? current),
        );
      }
    },
    [client],
  );

  const writeAllRead = useCallback(() => {
    patchFeeds((current) =>
      current.unreadCount === 0 && current.notifications.every((row) => row.isRead)
        ? null
        : {
            ...current,
            notifications: current.notifications.map((row) =>
              row.isRead ? row : { ...row, isRead: true },
            ),
            unreadCount: 0,
          },
    );
  }, [patchFeeds]);

  /*
   * Opening receipts everything, and holds what was unread.
   *
   * Keyed on the `all` payload, so a notification that arrives while the bell is
   * open is held and receipted exactly like the ones already there.
   *
   * `receipt` stops a revalidate landing mid-request from sending a second
   * read-all, and a failure from being retried on every refetch it causes — it
   * is tried again the next time the bell opens.
   */
  const receipt = useRef<"busy" | "failed" | "idle">("idle");
  const allData = all.data;

  useEffect(() => {
    if (!autoMarkRead) {
      receipt.current = "idle";
      return;
    }

    if (!allData) {
      return;
    }

    useNotificationHoldStore.getState().hold(
      allData.notifications.filter((row) => !row.isRead).map((row) => row.id),
      allData.notifications.map((row) => row.id),
    );

    if (allData.unreadCount === 0 || receipt.current !== "idle") {
      return;
    }

    receipt.current = "busy";
    writeAllRead();

    void browserApi("/api/v1/notifications/read-all", { method: "PATCH" }).then(
      () => {
        receipt.current = "idle";
        refreshAll();
      },
      () => {
        receipt.current = "failed";
        refreshAll();
      },
    );
  }, [allData, autoMarkRead, refreshAll, writeAllRead]);

  const markRead = useCallback(
    async (id: string) => {
      useNotificationHoldStore.getState().acknowledge(id);

      const serverRow = [all.data, action.data]
        .flatMap((payload) => payload?.notifications ?? [])
        .find((row) => row.id === id);

      // Held rows were receipted on open; only one the server still counts
      // needs the request.
      if (serverRow?.isRead !== false) {
        return;
      }

      patchFeeds((current) => {
        const row = current.notifications.find((item) => item.id === id);

        return row && !row.isRead
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                item.id === id ? { ...item, isRead: true } : item,
              ),
              unreadCount: Math.max(0, current.unreadCount - 1),
            }
          : null;
      });

      try {
        await browserApi(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
      } catch {
        // A failed read-receipt is not worth interrupting the user over; the
        // refetch below puts the badge back to what the server has.
      }

      refreshAll();
    },
    [action.data, all.data, patchFeeds, refreshAll],
  );

  const markAllRead = useCallback(async () => {
    useNotificationHoldStore.getState().acknowledgeAll();

    if ((all.data?.unreadCount ?? 0) === 0) {
      return;
    }

    writeAllRead();

    try {
      await browserApi("/api/v1/notifications/read-all", { method: "PATCH" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not mark notifications read.",
      );
    }

    refreshAll();
  }, [all.data, refreshAll, writeAllRead]);

  /**
   * Run an inline action button.
   *
   * Order matters: the domain endpoint runs first and the notification is only
   * resolved if it succeeded. A rejected approval must leave the request
   * sitting in the queue, not silently vanish from it.
   */
  const runAction = useCallback(
    async (notification: NotificationItem, action: NotificationAction) => {
      try {
        await browserApi(action.endpoint, {
          body: action.payload ? JSON.stringify(action.payload) : undefined,
          method: action.method ?? "POST",
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : `Could not ${action.label.toLowerCase()}.`,
        );
        return false;
      }

      try {
        await browserApi(`/api/v1/notifications/${notification.id}/resolve`, {
          body: JSON.stringify({ actionKey: action.key, state: "COMPLETED" }),
          method: "PATCH",
        });
      } catch {
        // The real work landed; a failed bookkeeping call only means the row
        // lingers in the queue until the next resolve or refetch.
      }

      toast.success(`${action.label} — done.`);
      refreshAll();

      return true;
    },
    [refreshAll],
  );

  const dismissAction = useCallback(
    async (id: string) => {
      try {
        await browserApi(`/api/v1/notifications/${id}/resolve`, {
          body: JSON.stringify({ state: "DISMISSED" }),
          method: "PATCH",
        });
        refreshAll();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not dismiss.");
      }
    },
    [refreshAll],
  );

  const activeData = active.data;

  // `isRead` as the reader sees it: the receipt, unless the row is still held.
  const notifications = useMemo(() => {
    const heldIds = new Set(held);
    const shown = (activeData?.notifications ?? []).map((row) =>
      row.isRead && heldIds.has(row.id) ? { ...row, isRead: false } : row,
    );

    return filter === "unread" ? shown.filter((row) => !row.isRead) : shown;
  }, [activeData, filter, held]);

  const serverUnread = all.data?.unreadCount ?? 0;

  return {
    actionCount: all.data?.actionCount ?? 0,
    dismissAction,
    markAllRead,
    markRead,
    message: active.message,
    notifications,
    refresh: refreshAll,
    runAction,
    state: active.state,
    /** Still tinted — what the Unread tab and "Mark all read" speak to. */
    unacknowledgedCount: Math.max(held.length, serverUnread),
    /** What the server still counts — what the bell's badge shows. */
    unreadCount: serverUnread,
  };
}
