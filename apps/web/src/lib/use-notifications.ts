"use client";

import { useCallback, useMemo } from "react";

import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { toast } from "@/stores/toast-store";

/**
 * Shared notification state for the bell and the full notifications page.
 *
 * Both surfaces read the same endpoint through the same query cache, so the
 * unread badge in the header and the list on the page can never disagree: a
 * mark-as-read on one invalidates the other in the same tick, and a
 * `notification:new` socket event invalidates both at once (see
 * `RealtimeProvider`).
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

export function notificationsEndpoint(filter: NotificationFilter) {
  return filter === "all"
    ? "/api/v1/notifications"
    : `/api/v1/notifications?filter=${filter}`;
}

export function useNotifications(filter: NotificationFilter = "all") {
  const endpoint = notificationsEndpoint(filter);
  const invalidate = useInvalidateResources();
  const resource = usePortalResource<NotificationPayload>(endpoint, {
    errorMessage: "Could not load notifications.",
  });

  // Every filtered view is a projection of the same rows, so any mutation has
  // to drop all three rather than just the one on screen.
  const refreshAll = useCallback(() => {
    invalidate("/api/v1/notifications*");
  }, [invalidate]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        await browserApi(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
        refreshAll();
      } catch {
        // A failed read-receipt is not worth interrupting the user over.
      }
    },
    [refreshAll],
  );

  const markAllRead = useCallback(async () => {
    try {
      await browserApi("/api/v1/notifications/read-all", { method: "PATCH" });
      refreshAll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not mark notifications read.",
      );
    }
  }, [refreshAll]);

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

  const notifications = useMemo(
    () => resource.data?.notifications ?? [],
    [resource.data],
  );

  return {
    actionCount: resource.data?.actionCount ?? 0,
    dismissAction,
    markAllRead,
    markRead,
    message: resource.message,
    notifications,
    refresh: refreshAll,
    runAction,
    state: resource.state,
    unreadCount: resource.data?.unreadCount ?? 0,
  };
}
