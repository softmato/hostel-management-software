import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Screen } from "@/components/ui/screen";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  type NotificationTone,
  notificationVisual,
} from "@/lib/notification-categories";
import { groupNotifications } from "@/lib/notification-groups";
import { notificationQuery } from "@/lib/notification-queries";
import {
  type AppNotification,
  type NotificationFeed,
  type NotificationFilter,
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
 * ## It opens already drawn
 *
 * The list reads `notificationQuery.feed(filter)`, which is the same key
 * `<NotificationBell>` reads for its badge and the one `role-tabs.tsx` warms on
 * the way into every portal. So the usual path into this screen — tap the bell
 * whose count came from this entry — paints the rows on the first frame and
 * revalidates behind them. `lib/notification-queries.ts` has the reasoning.
 *
 * The skeleton below is therefore for the cold cases only: a deep link from a
 * push, a hard relaunch, or a filter nobody has asked for yet.
 *
 * ## Three shapes of feed, and the grouping is what makes it a list
 *
 * Rows come from everywhere — rent, complaints, the kitchen, an SOS, a store
 * delivery — and arrive as one column sorted by time. Two things from
 * `ui_inspiration_folder/app_recordings/NOTES.md` turn that into something
 * scannable, and both are load-bearing rather than decorative:
 *
 * - **§5, headings outside the cards.** The day is written once on the page
 *   background instead of once per row, which is what lets "what happened since
 *   I last looked" be answered by the shape of the screen. `lib/notification-groups.ts`.
 * - **§5 and §11, a tinted glyph leading the row.** The category *and* what
 *   happened to it, before a word is read. `lib/notification-categories.ts`.
 *
 * ## Read is marked on tap, and optimistically
 *
 * Same rule as `(resident)/notices.tsx`: the row un-bolds immediately and the
 * PATCH runs behind it. Marking on render would clear the badge for a list
 * somebody opened and closed, and the one notification that mattered is exactly
 * the one that gets scrolled past. A failed PATCH leaves a row locally read that
 * the next fetch corrects — cheaper than a tap that appears to do nothing.
 *
 * The optimistic edit is written back to the shared cache entry, so the bell on
 * the screen underneath loses its badge on the same frame as the row loses its
 * tint. That is `use-resource`'s `setData` doing it, not a second update here.
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

/**
 * The tinted square behind the glyph.
 *
 * `bg-destructive-soft` rather than `bg-destructive/10`: NativeWind does not
 * compose an opacity modifier from a CSS variable, so the `/10` form renders no
 * square at all. `global.css` carries that as a comment beside the token, and
 * `<CardRow>` still has the broken form.
 */
const TILE_TONES: Record<NotificationTone, string> = {
  brand: "bg-brand-soft",
  danger: "bg-destructive-soft",
  neutral: "bg-muted",
  success: "bg-success-soft",
  warning: "bg-warning-soft",
};

const TILE_GLYPH: Record<
  NotificationTone,
  "destructive" | "mutedForeground" | "primary" | "success" | "warning"
> = {
  brand: "primary",
  danger: "destructive",
  neutral: "mutedForeground",
  success: "success",
  warning: "warning",
};

export default function NotificationsScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [marking, setMarking] = useState(false);

  /*
   * The descriptor, not an inline loader. `defineQuery` hands back the same
   * object for a key for the life of the process, so `query.load` is a stable
   * identity `useResource` can key its fetch effect off — and changing the chip
   * changes the key, which paints the other filter from cache if it has been
   * looked at and re-asks if it has not.
   *
   * `topics` is what makes the bell live: the socket publishes `notifications`
   * on every `notification:new` and `notification:updated`, so a notice
   * published on the web updates this list with no push involved and no polling.
   * The refetch is silent — the list stays on screen while it runs.
   */
  const query = notificationQuery.feed(filter);

  const feed = useResource<NotificationFeed>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const rows = useMemo(() => feed.data?.notifications ?? [], [feed.data]);
  const unread = feed.data?.unreadCount ?? 0;

  /*
   * Grouped here rather than in the render body so the buckets are recomputed
   * when the rows move and not when the screen re-renders for a chip.
   *
   * `new Date()` is read once per grouping rather than per row: a list crossing
   * midnight Kathmandu time mid-loop would otherwise file its first rows under
   * one heading and its last under another.
   */
  const groups = useMemo(() => groupNotifications(rows), [rows]);

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

  if (feed.error || (!feed.data && !feed.loading)) {
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

        {/*
          Skeleton rows rather than a centred spinner, per NOTES §9: the shape of
          this list is known before its contents are, and matching it is what
          keeps the page from jumping when the rows land. Six because that is
          roughly a screenful at this row height.
        */}
        {feed.loading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
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
          <View className="gap-5">
            {groups.map((group) => (
              <View className="gap-2.5" key={group.bucket}>
                {/*
                  On the page, not in a card — NOTES §5. The day is stated once
                  for the rows under it instead of once on every row.
                */}
                <Text
                  className="px-0.5 font-semibold uppercase tracking-wider"
                  variant="caption"
                >
                  {group.label}
                </Text>

                {group.rows.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={markRead}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * One row: a tinted glyph, the title with its age opposite, two lines of body.
 *
 * ## Not a `<Card>`, and not `<CardRow>`
 *
 * The accent edge has to be flush with the rounded corner, which a component
 * whose padding is a single slot cannot do — `<Card>`'s own doc explains why
 * that slot is not additive. `<CardRow>` is the other near-miss: its value sits
 * vertically centred in the right slot rather than on the title's baseline, and
 * its subtitle is fixed at two lines with nothing to expand. Both differences
 * are the row's whole anatomy, so this is a screen-level composition rather than
 * a fifth variant of a kit primitive.
 *
 * ## Unread inverts the row rather than adding a dot to it
 *
 * Unread rows take a tinted ground and their glyph tile goes white; read rows
 * are a white card with a tinted tile. Two states, one pair of surfaces swapped,
 * and the tone still shows in both because it is the *glyph* that carries the
 * colour — a tinted tile on a tinted ground would simply disappear.
 *
 * The dot that used to say "unread" is gone with it: ground, weight and edge all
 * say it already, and it was the fourth. Screen readers get the word itself.
 */
function NotificationRow({
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
  const unread = !notification.isRead;
  const visual = notificationVisual(notification);

  /*
   * One edge, two meanings, and urgency wins.
   *
   * A left border for urgency, never a red card — the same rule the notices list
   * follows, and two red cards on one screen means neither reads as urgent. An
   * unread row that is *also* urgent keeps the red: it is the more important of
   * the two things to know, and the tinted ground still says unread.
   */
  const edge = urgent ? colors.destructive : unread ? colors.primary : "transparent";

  return (
    <Pressable
      accessibilityLabel={`${unread ? "Unread. " : ""}${visual.label}. ${notification.title}. ${notification.body}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      className="active:opacity-80"
      onPress={() => {
        setExpanded((value) => !value);
        onOpen(notification);
      }}
    >
      <View
        className={`flex-row overflow-hidden rounded-2xl border ${
          unread ? "border-transparent bg-brand-soft" : "border-border bg-card"
        }`}
      >
        {/*
          Always drawn, transparent when there is nothing to say — so a read row
          and an unread one align on the same left edge and the list does not
          shift by four points as rows are opened.
        */}
        <View style={{ backgroundColor: edge, width: 4 }} />

        <View className="flex-1 flex-row gap-3 p-3">
          <View
            className={`h-10 w-10 items-center justify-center rounded-xl ${
              unread ? "bg-card" : TILE_TONES[visual.tone]
            }`}
          >
            <Ionicons
              color={colors[TILE_GLYPH[visual.tone]]}
              name={visual.icon}
              size={19}
            />
          </View>

          <View className="flex-1 gap-1">
            <View className="flex-row items-start gap-2">
              <Text
                className={`flex-1 ${unread ? "font-semibold" : ""}`}
                numberOfLines={2}
                variant="subtitle"
              >
                {notification.title}
              </Text>

              {/*
                The age, on the title's line and hard right — the reference's own
                row anatomy. `dates.ago` falls back to a date past a week, which
                is the point at which "23 days ago" stops being an answer.
              */}
              <Text variant="caption">{dates.ago(notification.createdAt)}</Text>
            </View>

            <Text numberOfLines={expanded ? undefined : 2} variant="muted">
              {notification.body}
            </Text>

            <View className="flex-row flex-wrap items-center gap-2 pt-0.5">
              {notification.needsAction ? <Badge label="Needs you" tone="warning" /> : null}
              <Badge label={visual.label} />
            </View>

            {/*
              Only once the row is open, and only as a sentence. The action itself
              is a web endpoint this app deliberately does not fire — saying where
              it can be done beats a button that posts blind.
            */}
            {expanded && notification.needsAction ? (
              <Text variant="caption">
                This one is waiting on a decision. It can be actioned from the web portal.
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
