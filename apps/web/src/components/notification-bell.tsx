"use client";

import { Bell, CheckCheck, ChevronRight, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useRealtime } from "@/components/realtime-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TONE_CHIP,
  notificationDisplay,
  relativeTime,
} from "@/lib/notification-display";
import {
  useNotifications,
  type NotificationFilter,
  type NotificationItem,
} from "@/lib/use-notifications";
import { cn } from "@/lib/utils";

/**
 * Header bell for every authenticated portal (PHASES.md §4.1).
 *
 * Three tabs over the same feed: everything, unread, and "Needs action" — the
 * queue of requests waiting on this person. That third tab is the reason the
 * bell is more than a glance: a hostel awaiting approval or a service provider
 * application can be approved from here without opening the panel, because the
 * row carries its own endpoint (see `Notification.actions`).
 *
 * Rows arrive over the socket when Pusher is configured and by polling when it
 * is not, so nothing below depends on the connection being up — the lightning
 * badge is the only thing that changes.
 */

const FILTERS: { label: string; value: NotificationFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Needs action", value: "action" },
];

function ActionButtons({
  busy,
  notification,
  onDismiss,
  onRun,
}: {
  busy: string | null;
  notification: NotificationItem;
  onDismiss: (id: string) => void;
  onRun: (notification: NotificationItem, actionKey: string) => void;
}) {
  if (!notification.needsAction) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-9">
      {notification.actions.map((action) => (
        <Button
          className="h-7 px-2.5 text-[11px] font-semibold"
          disabled={busy !== null}
          key={action.key}
          onClick={() => onRun(notification, action.key)}
          size="sm"
          variant={
            action.tone === "danger"
              ? "destructive"
              : action.tone === "primary"
                ? "default"
                : "outline"
          }
        >
          {busy === `${notification.id}:${action.key}` ? (
            <Loader2 className="size-3 animate-spin" />
          ) : null}
          {action.label}
        </Button>
      ))}

      {notification.actionUrl ? (
        <Button asChild className="h-7 px-2.5 text-[11px] font-semibold" size="sm" variant="ghost">
          <Link href={notification.actionUrl}>
            Review
            <ChevronRight className="size-3" />
          </Link>
        </Button>
      ) : null}

      <Button
        className="h-7 px-2 text-[11px] text-muted-foreground"
        disabled={busy !== null}
        onClick={() => onDismiss(notification.id)}
        size="sm"
        variant="ghost"
      >
        Dismiss
      </Button>
    </div>
  );
}

function NotificationRow({
  busy,
  notification,
  onDismiss,
  onOpen,
  onRun,
}: {
  busy: string | null;
  notification: NotificationItem;
  onDismiss: (id: string) => void;
  onOpen: (notification: NotificationItem) => void;
  onRun: (notification: NotificationItem, actionKey: string) => void;
}) {
  const display = notificationDisplay(notification.category);
  const Icon = display.icon;
  // A row with buttons must not navigate when its body is clicked — the whole
  // point of the inline action is deciding without leaving the page.
  const navigable = !notification.needsAction && Boolean(notification.actionUrl);

  const body = (
    <>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-6.5 shrink-0 items-center justify-center rounded-lg",
            TONE_CHIP[display.tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={cn(
                "truncate text-[13px] leading-tight text-foreground",
                notification.isRead ? "font-medium" : "font-semibold",
              )}
            >
              {notification.title}
            </p>
            {notification.needsAction ? (
              <Badge
                className="h-4 shrink-0 rounded px-1 text-[9px] font-bold tracking-wide"
                variant="default"
              >
                ACTION
              </Badge>
            ) : null}
            {!notification.isRead ? (
              <span className="ml-auto size-1.5 shrink-0 rounded-full bg-rose-500" />
            ) : null}
          </div>

          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notification.body}
          </p>

          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium">{display.label}</span>
            <span aria-hidden>·</span>
            <span>{relativeTime(notification.createdAt)}</span>
            {notification.actionState === "COMPLETED" ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  Resolved
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <ActionButtons
        busy={busy}
        notification={notification}
        onDismiss={onDismiss}
        onRun={onRun}
      />
    </>
  );

  return (
    <div
      className={cn(
        "rounded-lg px-2.5 py-2 transition-colors",
        notification.isRead ? "" : "bg-muted/40",
        navigable ? "cursor-pointer hover:bg-muted" : "",
      )}
      onClick={navigable ? () => onOpen(notification) : undefined}
      onKeyDown={
        navigable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(notification);
              }
            }
          : undefined
      }
      role={navigable ? "button" : undefined}
      tabIndex={navigable ? 0 : undefined}
    >
      {body}
    </div>
  );
}

export function NotificationBell({ href }: { href: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const { clearLive, connected, liveNotifications } = useRealtime();
  const {
    actionCount,
    dismissAction,
    markAllRead,
    markRead,
    notifications,
    runAction,
    state,
    unreadCount,
  } = useNotifications(filter);

  // The live queue exists to badge notifications that arrived while the bell
  // was shut; once it has been opened they are ordinary rows in the list.
  useEffect(() => {
    if (open && liveNotifications.length > 0) {
      clearLive();
    }
  }, [clearLive, liveNotifications.length, open]);

  const badge = unreadCount;

  async function handleRun(notification: NotificationItem, actionKey: string) {
    const action = notification.actions.find((item) => item.key === actionKey);

    if (!action) {
      return;
    }

    setBusy(`${notification.id}:${actionKey}`);
    await runAction(notification, action);
    setBusy(null);
  }

  async function handleDismiss(id: string) {
    setBusy(`${id}:dismiss`);
    await dismissAction(id);
    setBusy(null);
  }

  function handleOpen(notification: NotificationItem) {
    if (!notification.isRead) {
      void markRead(notification.id);
    }

    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={badge > 0 ? `Notifications, ${badge} unread` : "Notifications"}
          className="relative size-8 rounded-full border-slate-200 bg-white text-slate-600 shadow-sm dark:border-border dark:bg-card dark:text-foreground"
          size="icon"
          type="button"
          variant="outline"
        >
          <Bell className="size-4" />
          {badge > 0 ? (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ring-2 ring-white dark:ring-card",
                // An outstanding request outranks a merely unread row, so the
                // badge turns amber the moment something needs a decision.
                actionCount > 0 ? "bg-amber-500" : "bg-rose-500",
              )}
            >
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0 sm:w-96">
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {connected ? (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-px text-[9px] font-bold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                title="Live updates are connected"
              >
                <Zap className="size-2.5" />
                LIVE
              </span>
            ) : null}
          </div>

          {unreadCount > 0 ? (
            <Button
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => void markAllRead()}
              size="sm"
              variant="ghost"
            >
              <CheckCheck className="size-3" />
              Mark all read
            </Button>
          ) : null}
        </div>

        <div className="px-3 pt-2">
          <Tabs
            onValueChange={(value) => setFilter(value as NotificationFilter)}
            value={filter}
          >
            <TabsList className="w-full">
              {FILTERS.map((item) => (
                <TabsTrigger className="flex-1 text-[11px]" key={item.value} value={item.value}>
                  {item.label}
                  {item.value === "action" && actionCount > 0 ? (
                    <span className="ml-1 rounded bg-amber-500 px-1 text-[9px] font-bold text-white">
                      {actionCount}
                    </span>
                  ) : null}
                  {item.value === "unread" && unreadCount > 0 ? (
                    <span className="ml-1 rounded bg-rose-500 px-1 text-[9px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="mt-1 max-h-[22rem] px-1.5 py-1">
          {notifications.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              {state === "loading"
                ? "Loading…"
                : filter === "action"
                  ? "Nothing needs your attention."
                  : filter === "unread"
                    ? "You're all caught up."
                    : "Nothing new."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {notifications.slice(0, 12).map((notification) => (
                <NotificationRow
                  busy={busy}
                  key={notification.id}
                  notification={notification}
                  onDismiss={(id) => void handleDismiss(id)}
                  onOpen={handleOpen}
                  onRun={(item, key) => void handleRun(item, key)}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-border p-1.5">
          <Button asChild className="w-full text-[13px] font-semibold" size="sm" variant="ghost">
            <Link href={href} onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
