import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { formatRelativeDay, humanizeEnum } from "@/lib/format";
import {
  getResidentNotices,
  markNoticeRead,
  type ResidentNotice,
  type ResidentNoticeList,
} from "@/lib/resident-api";

/**
 * Notices from the hostel.
 *
 * ## Read is marked on expand, not on scroll-past
 *
 * A notice counts as read when the resident opens it, because that is the only
 * moment we know they saw the *content* rather than the headline. Marking on
 * render would clear the unread badge for a list somebody scrolled past on the
 * way to Payments, and the one notice that matters — a water cut tomorrow — is
 * exactly the one that gets scrolled past.
 *
 * The flip is **optimistic**: the row un-bolds immediately and the PATCH runs
 * behind it. The server upserts with `$setOnInsert`, so a replay is a no-op
 * rather than a second timestamp, and a failed call leaves a notice marked read
 * locally that the next fetch will correct. Both failure modes are cheaper than
 * a tap that appears to do nothing.
 *
 * ## Against `resident-notices-page.tsx` (§5.1)
 *
 * The web filters by **status** — All / Unread / Urgent, with counts — and this
 * screen filtered by **category**. Both are worth having and two chip rows is
 * one too many on a phone, so they share a single scroller: the three status
 * filters first, then whatever categories the hostel actually uses.
 *
 * Also fixed here rather than ported: the screen fetched page 1 and dropped
 * `pagination.hasMore` on the floor, so a hostel that posts often had older
 * notices that no resident could reach on the phone at all.
 */

const ALL = "ALL";
const UNREAD = "UNREAD";
const URGENT = "URGENT";

export default function ResidentNoticesScreen() {
  const notices = useResource<ResidentNoticeList>(
    useCallback(() => getResidentNotices(), []),
  );
  const [filter, setFilter] = useState<string>(ALL);
  const [loadingMore, setLoadingMore] = useState(false);

  // Memoised because the `?? []` on the next line would otherwise be a new
  // array identity every render, re-deriving the category list each time.
  const rows = useMemo(() => notices.data?.notices ?? [], [notices.data]);

  const categories = useMemo(() => {
    const found = new Set(rows.map((notice) => notice.category).filter(Boolean));

    return [...found].sort();
  }, [rows]);

  const unread = rows.filter((notice) => !notice.isRead).length;
  const urgent = rows.filter((notice) => notice.isUrgent).length;

  const visible =
    filter === ALL
      ? rows
      : filter === UNREAD
        ? rows.filter((notice) => !notice.isRead)
        : filter === URGENT
          ? rows.filter((notice) => notice.isUrgent)
          : rows.filter((notice) => notice.category === filter);

  /*
   * Counts are on the status chips only. A category chip reading "Maintenance
   * 3" would be counting the page in hand rather than the category, because
   * paging is server-side — and a number that shrinks when you scroll is worse
   * than no number.
   */
  const chips = [
    { key: ALL, label: "All" },
    ...(unread > 0 ? [{ key: UNREAD, label: `Unread ${unread}` }] : []),
    ...(urgent > 0 ? [{ key: URGENT, label: `Urgent ${urgent}` }] : []),
    ...categories.map((option) => ({ key: option, label: humanizeEnum(option) })),
  ];

  const pagination = notices.data?.pagination;

  const loadMore = useCallback(async () => {
    if (!pagination?.hasMore || loadingMore) {
      return;
    }

    setLoadingMore(true);

    try {
      const next = await getResidentNotices(pagination.page + 1);

      // Appended, not replaced: the point of the button is to grow the list.
      notices.setData((current) =>
        current
          ? { ...next, notices: [...current.notices, ...next.notices] }
          : next,
      );
    } catch {
      // Silent. The button stays, and the list the resident already has is
      // untouched — a toast about page 2 is noise on a screen being read.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, notices, pagination]);

  const markRead = useCallback(
    (notice: ResidentNotice) => {
      if (notice.isRead) {
        return;
      }

      notices.setData((current) =>
        current
          ? {
              ...current,
              notices: current.notices.map((row) =>
                row.id === notice.id ? { ...row, isRead: true } : row,
              ),
            }
          : current,
      );

      // Fire and forget. The next fetch is the correction, and a toast about a
      // read receipt would be noise on a screen someone is reading.
      void markNoticeRead(notice.id).catch(() => undefined);
    },
    [notices],
  );

  const header = (
    <AppBar
      /*
       * Reached by a push from Home now that Community holds the fifth tab slot,
       * so it needs a way back — and an explicit destination rather than
       * `router.back()`, because this is still a screen *inside* the tab
       * navigator and a bottom-tab navigator's default `backBehavior` is
       * `firstRoute`, not `history`.
       */
      onBack={() => router.navigate("/(resident)")}
      showBack
      subtitle={unread > 0 ? `${unread} unread` : undefined}
      title="Notices"
    />
  );

  if (notices.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading notices" />
      </Screen>
    );
  }

  if (notices.error || !notices.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={notices.error ?? "Notices could not be loaded."}
          onRetry={notices.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={notices.refresh}
      refreshing={notices.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        {/* Only worth showing once there is something to filter. A lone "All"
            chip is a control that does nothing. */}
        {chips.length > 1 ? (
          <ScrollView
            contentContainerClassName="gap-2"
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {chips.map((chip) => {
              const active = chip.key === filter;

              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                    active ? "border-primary bg-primary" : "border-border"
                  }`}
                  key={chip.key}
                  onPress={() => setFilter(chip.key)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      active ? "text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            description={
              filter === ALL
                ? "Your hostel has not posted anything yet."
                : filter === UNREAD
                  ? "You have read everything."
                  : "Nothing in this view."
            }
            title="No notices"
          />
        ) : (
          <View className="gap-3">
            {visible.map((notice) => (
              <NoticeCard key={notice.id} notice={notice} onOpen={markRead} />
            ))}
          </View>
        )}

        {/*
          Older notices were unreachable before this: the screen asked for page
          one and never looked at `hasMore`. Hidden while a filter is applied —
          the filter runs over what has been fetched, so "load more" under an
          empty filtered view would look like it had failed.
        */}
        {pagination?.hasMore && filter === ALL ? (
          <Button
            label={loadingMore ? "Loading…" : "Load older notices"}
            loading={loadingMore}
            onPress={() => void loadMore()}
            variant="outline"
          />
        ) : null}
      </View>
    </Screen>
  );
}

function NoticeCard({
  notice,
  onOpen,
}: {
  notice: ResidentNotice;
  onOpen: (notice: ResidentNotice) => void;
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => {
        setExpanded((value) => !value);
        onOpen(notice);
      }}
    >
      {/*
        Urgent gets a left border rather than a red card. A whole notice in
        alarm colours is unreadable, and once two of them are on screen neither
        reads as urgent any more.
      */}
      <Card
        className={`gap-2 active:opacity-80 ${
          notice.isUrgent ? "border-l-4 border-l-destructive" : ""
        }`}
      >
        <View className="flex-row items-start gap-3">
          {/*
            The web's icon square, ported. It carries the urgency — red for an
            alert, brand for an announcement — which is what makes a list of ten
            notices scannable without reading any of them.
          */}
          <View
            className={`h-9 w-9 items-center justify-center rounded-lg ${
              notice.isUrgent ? "bg-destructive/10" : "bg-brand-soft"
            }`}
          >
            <Ionicons
              color={notice.isUrgent ? colors.destructive : colors.primary}
              name={notice.isUrgent ? "alert-circle-outline" : "megaphone-outline"}
              size={18}
            />
          </View>

          <View className="flex-1 gap-2">
            <View className="flex-row items-start gap-2">
              {!notice.isRead ? (
                <View
                  accessibilityLabel="Unread"
                  className="mt-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: colors.primary }}
                />
              ) : null}

              <Text
                className={`flex-1 ${notice.isRead ? "" : "font-semibold"}`}
                variant="subtitle"
              >
                {notice.title}
              </Text>

              <Ionicons
                color={colors.mutedForeground}
                name={expanded ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </View>

            <Text numberOfLines={expanded ? undefined : 2} variant="muted">
              {notice.content}
            </Text>

            <View className="flex-row flex-wrap items-center gap-2">
              {notice.isUrgent ? <Badge label="Urgent" tone="danger" /> : null}
              {notice.category ? <Badge label={humanizeEnum(notice.category)} /> : null}
              <Text variant="caption">{formatRelativeDay(notice.publishedAt)}</Text>
            </View>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
