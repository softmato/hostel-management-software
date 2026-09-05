import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { humanizeEnum } from "@/lib/format";
import {
  type AppNotification,
  type NotificationFeed,
  type NotificationFilter,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications-api";
import { setBadgeCount } from "@/lib/push-notifications";
import { toastError } from "@/lib/toast";

/**
 * What the bell opens.
 *
 * ## One screen for every role
 *
 * `GET /notifications` is scoped to `principal.userId` with no role branch, so
 * this lives at the root of the stack rather than inside a role's tab group —
 * the same file serves a resident's payment reminder and an admin's approval
 * queue, and a folder nested under a `<Tabs>` layout would become another tab.
 *
 * ## Read is marked on tap, and optimistically
 *
 * Same rule as `(resident)/notices.tsx`: the row un-bolds immediately and the
 * PATCH runs behind it. Marking on render would clear the badge for a list
 * somebody opened and closed, and the one notification that mattered is exactly
 * the one that gets scrolled past. A failed PATCH leaves a row locally read that
 * the next fetch corrects — cheaper than a tap that appears to do nothing.
 *
 * ## `actionUrl` is not a link
 *
 * The field holds a **web** path (`/<slug>/admin/finance/…`). Pushing it into
 * `router.push` would hit expo-router's not-found screen, and opening a browser
 * would ask someone to sign in again on a surface this app does not own. So rows
 * that need a decision say so and stop there — see `lib/notifications-api.ts`.
 */

const FILTERS: { label: string; value: NotificationFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Needs you", value: "action" },
];

export default function NotificationsScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [marking, setMarking] = useState(false);

  /*
   * `topics` is what makes the bell live: the socket publishes `notifications`
   * on every `notification:new` and `notification:updated`, so a notice
   * published on the web updates this list with no push involved and no
   * polling. The refetch is silent — the list stays on screen while it runs.
   */
  const feed = useResource<NotificationFeed>(
    useCallback(() => listNotifications(filter), [filter]),
    { topics: ["notifications"] },
  );

  const rows = useMemo(() => feed.data?.notifications ?? [], [feed.data]);
  const unread = feed.data?.unreadCount ?? 0;

  /*
   * The app-icon badge, written from the server's count.
   *
   * This screen is the only place that sets it authoritatively, and that is
   * what "cleared on read" means in practice: marking a row read moves
   * `unreadCount` locally, marking all read refetches it, and either way the
   * icon follows the same number the bell is showing. `use-push.ts` only
   * increments between visits, to keep the icon from lying while the app is
   * open — a second counter would drift from this one within a day.
   */
  useEffect(() => {
    if (feed.data) {
      void setBadgeCount(unread);
    }
  }, [feed.data, unread]);

  const markRead = useCallback(
    (notification: AppNotification) => {
      if (notification.isRead) {
        return;
      }

      feed.setData((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((row) =>
                row.id === notification.id ? { ...row, isRead: true } : row,
              ),
              // The badge on the bell reads this, so it has to move with the row.
              unreadCount: Math.max(0, current.unreadCount - 1),
            }
          : current,
      );

      void markNotificationRead(notification.id).catch(() => undefined);
    },
    [feed],
  );

  const markAll = useCallback(async () => {
    setMarking(true);

    try {
      await markAllNotificationsRead();
      // Refetched rather than patched locally: "mark all" touches rows this
      // screen may not be holding, and the unread filter's contents change
      // wholesale.
      feed.refresh();
    } catch {
      toastError("Couldn't mark them read", "Check your connection and try again.");
    } finally {
      setMarking(false);
    }
  }, [feed]);

  const header = (
    <AppBar
      actions={
        unread > 0 ? (
          <Pressable
            accessibilityLabel="Mark all as read"
            accessibilityRole="button"
            disabled={marking}
            hitSlop={8}
            onPress={() => {
              void markAll();
            }}
          >
            <Text className={`text-primary ${marking ? "opacity-50" : ""}`} variant="label">
              Mark all read
            </Text>
          </Pressable>
        ) : undefined
      }
      onBack={() => router.back()}
      showBack
      subtitle={unread > 0 ? `${unread} unread` : "You're up to date"}
      title="Notifications"
    />
  );

  /*
   * The bell is only drawn for a signed-in account, so this is a deep link or a
   * session that ended while the screen was open — not a state reachable by
   * tapping. It still has to say something other than a failed request.
   */
  if (!account) {
    return (
      <Screen header={header}>
        <EmptyState
          description="Notifications belong to an account. Sign in to see yours."
          title="Not signed in"
        />
      </Screen>
    );
  }

  if (feed.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading notifications" />
      </Screen>
    );
  }

  if (feed.error || !feed.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={feed.error ?? "Notifications could not be loaded."}
          onRetry={feed.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} onRefresh={feed.refresh} refreshing={feed.refreshing} scroll>
      <View className="gap-4 pt-1">
        <ScrollView
          contentContainerClassName="gap-2"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {FILTERS.map((option) => {
            const active = option.value === filter;

            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                  active ? "border-primary bg-primary" : "border-border"
                }`}
                key={option.value}
                onPress={() => setFilter(option.value)}
              >
                <Text
                  className={`text-sm font-medium ${
                    active ? "text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {option.value === "action" && feed.data
                    ? `${option.label}${feed.data.actionCount > 0 ? ` (${feed.data.actionCount})` : ""}`
                    : option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {rows.length === 0 ? (
          <EmptyState
            description={
              filter === "unread"
                ? "Everything here has been read."
                : filter === "action"
                  ? "Nothing is waiting on a decision from you."
                  : "Rent reminders, notices and alerts will show up here."
            }
            title="Nothing to read"
          />
        ) : (
          <View className="gap-3">
            {rows.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onOpen={markRead}
              />
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

function NotificationCard({
  notification,
  onOpen,
}: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
}) {
  const dates = useDates();

  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);

  const urgent = notification.priority === "URGENT" || notification.priority === "HIGH";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        setExpanded((value) => !value);
        onOpen(notification);
      }}
    >
      {/*
        A left border for urgency, never a red card — the same rule the notices
        list follows. Two red cards on one screen and neither reads as urgent.
      */}
      <Card
        className={`gap-2 active:opacity-80 ${
          urgent ? "border-l-4 border-l-destructive" : ""
        }`}
      >
        <View className="flex-row items-start gap-2">
          {notification.isRead ? null : (
            <View
              accessibilityLabel="Unread"
              className="mt-1.5 h-2 w-2 rounded-full"
              style={{ backgroundColor: colors.primary }}
            />
          )}

          <Text
            className={`flex-1 ${notification.isRead ? "" : "font-semibold"}`}
            variant="subtitle"
          >
            {notification.title}
          </Text>

          <Ionicons
            color={colors.mutedForeground}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
          />
        </View>

        <Text numberOfLines={expanded ? undefined : 2} variant="muted">
          {notification.body}
        </Text>

        <View className="flex-row flex-wrap items-center gap-2">
          {notification.needsAction ? <Badge label="Needs you" tone="warning" /> : null}
          {notification.category ? (
            <Badge label={humanizeEnum(notification.category)} />
          ) : null}
          <Text variant="caption">{dates.relativeDay(notification.createdAt)}</Text>
        </View>

        {/*
          Only once the row is open, and only as a sentence. The action itself is
          a web endpoint this app deliberately does not fire — saying where it
          can be done beats a button that posts blind.
        */}
        {expanded && notification.needsAction ? (
          <Text variant="caption">
            This one is waiting on a decision. It can be actioned from the web portal.
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}
