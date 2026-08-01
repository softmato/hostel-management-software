"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { browserApi } from "@/lib/browser-api";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";

const NOTIFICATIONS_ENDPOINT = "/api/v1/notifications";

type Notification = {
  body: string;
  category: string;
  createdAt?: string;
  id: string;
  isRead: boolean;
  title: string;
};

function relativeTime(value?: string) {
  if (!value) {
    return "";
  }

  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;

  return `${Math.round(minutes / 1440)}d ago`;
}

/**
 * Header bell for every authenticated portal (PHASES.md §4.1). Unread count,
 * recent list, mark-as-read. The notifications page stays the full archive —
 * this is the glance.
 */
export function NotificationBell({ href }: { href: string }) {
  const invalidate = useInvalidateResources();
  const resource = usePortalResource<{ notifications: Notification[] }>(
    NOTIFICATIONS_ENDPOINT,
    { errorMessage: "Could not load notifications." },
  );

  const notifications = useMemo(
    () => resource.data?.notifications ?? [],
    [resource.data],
  );
  const unread = notifications.filter((notification) => !notification.isRead);

  const markRead = useCallback(
    async (notificationId: string) => {
      try {
        await browserApi(`${NOTIFICATIONS_ENDPOINT}/${notificationId}/read`, {
          method: "PATCH",
        });
        invalidate(NOTIFICATIONS_ENDPOINT);
      } catch {
        // A failed read-receipt is not worth interrupting the user over.
      }
    },
    [invalidate],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={
            unread.length > 0
              ? `Notifications, ${unread.length} unread`
              : "Notifications"
          }
          className="relative size-8 rounded-full border-slate-200 bg-white text-slate-600 shadow-sm dark:border-border dark:bg-card dark:text-foreground"
          size="icon"
          type="button"
          variant="outline"
        >
          <Bell className="size-4" />
          {unread.length > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-card">
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unread.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">
              {unread.length} unread
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {resource.state === "loading" ? "Loading…" : "Nothing new."}
          </p>
        ) : null}

        {notifications.slice(0, 8).map((notification) => (
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            key={notification.id}
            onSelect={(event) => {
              event.preventDefault();

              if (!notification.isRead) {
                void markRead(notification.id);
              }
            }}
          >
            <span className="flex w-full items-center gap-2">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  notification.isRead ? "bg-transparent" : "bg-rose-500",
                )}
              />
              <span className="truncate text-sm font-semibold text-foreground">
                {notification.title}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {relativeTime(notification.createdAt)}
              </span>
            </span>
            <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">
              {notification.body}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link className="w-full justify-center text-sm font-semibold" href={href}>
            View all notifications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
