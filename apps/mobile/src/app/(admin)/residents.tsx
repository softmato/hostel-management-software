import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { AdminSearchBar } from "@/components/admin-search-bar";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { CardRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SwipeRow } from "@/components/ui/swipe-row";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { type AdminResident, listAdminResidents } from "@/lib/admin-api";
import {
  type RosterSegment,
  rosterSegmentRows,
  rosterSummary,
  searchResidents,
} from "@/lib/admin-roster";
import { humanizeEnum } from "@/lib/format";

/**
 * Residents — a directory, and shaped like one.
 *
 * ## Its own shape, not the group's banner
 *
 * The admin tabs each had the same painted band under the same painted bar for
 * a while, which made five different jobs look like one screen. This one leads
 * with **search in the bar**, because a directory is something you look *into*,
 * and because pinning the field means it is still there once you have scrolled
 * past the person you were after. No figures band: the counts that mattered are
 * on the segments, where they are also the control.
 *
 * ## Segments, not chips
 *
 * Three mutually exclusive views of one list, switching instantly — the case
 * Material 3 reserves segmented buttons for. Chips would imply two could be on
 * at once, and "living here" and "to move in" have no intersection to offer.
 *
 * **Living here is the default, not Everyone.** The list route is unfiltered, so
 * a hostel with turnover has former residents in the same array; opening on
 * `all` means opening on a list whose rows include people who left months ago.
 *
 * ## People only — the inquiries went back to the queue
 *
 * This screen used to open with a tinted block of new inquiries, on the argument
 * that a lead is the same subject as a roster. It is not: an inquiry is a
 * *decision waiting*, which is what the Action queue is, and putting it here
 * meant the one screen an admin opens to look somebody up began with something
 * else entirely — a second list, in the app's only accent block, above the
 * search results the field was filtering. Leads live on Alerts under their own
 * segment, and follow-up happens there.
 *
 * ## Swipe a row to call
 *
 * A row is already carrying a face, a name, a room, a number and a status. The
 * call button lives under a left pull rather than in a sixth column — see
 * `SwipeRow` — and rows for people with no phone number on file simply do not
 * move.
 *
 * ## The bar counts what is under it
 *
 * The subtitle used to read "40 people living here" no matter what the field or
 * the segments had narrowed the list to, so the one number on the screen
 * disagreed with the rows directly below it. It now describes the visible list,
 * and a search that finds nobody *here* says whether it would have found
 * somebody under a different segment instead of a flat "no resident matches".
 *
 * ## Why the search is client-side
 *
 * `residentListQuerySchema` takes a `q`, so a server search exists — but the
 * page this screen already holds is 50 rows, which is most hostels in full, and
 * a request per keystroke feels worse than filtering what is in hand. The
 * matching itself is `searchResidents`, where it is tested.
 *
 * ## It edits now, and the argument that said it should not was wrong
 *
 * This block used to read "no edit affordances": registering, moving in and out,
 * changing status and issuing an activation code "all want documents, a deposit
 * figure or a room assignment in front of you", so they lived in the browser.
 * Every one of those is a thing a person does **standing in the hostel**, which
 * is where the phone is and the laptop is not. The rows open
 * `manage/resident/[id]`, and the button registers somebody.
 */
export default function AdminResidentsScreen() {
  const dates = useDates();
  const residents = useResource<AdminResident[]>(
    useCallback(() => listAdminResidents(), []),
    { topics: [REALTIME_TOPIC.RESIDENTS] },
  );

  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<RosterSegment>("active");

  const rows = useMemo(() => residents.data ?? [], [residents.data]);
  const roster = useMemo(() => rosterSummary(rows), [rows]);

  const visible = useMemo(
    () => searchResidents(rosterSegmentRows(rows, segment), query),
    [query, rows, segment],
  );

  /*
   * How many people the same query would find with the segments out of the way.
   * Only consulted when the visible list is empty, and only to say so — a search
   * that quietly widened its own scope would leave the chosen segment lying
   * about what it is showing.
   */
  const elsewhere = useMemo(
    () => (query.trim() ? searchResidents(rows, query).length : 0),
    [query, rows],
  );

  const subtitle = useMemo(() => {
    if (query.trim()) {
      return visible.length === 1 ? "1 match" : `${visible.length} matches`;
    }

    if (segment === "pending") {
      return roster.pending === 1 ? "1 person to move in" : `${roster.pending} to move in`;
    }

    if (segment === "all") {
      return roster.total === 1 ? "1 record" : `${roster.total} records, past and present`;
    }

    return roster.active === 1 ? "1 person living here" : `${roster.active} people living here`;
  }, [query, roster, segment, visible.length]);

  const header = (
    <AdminSearchBar
      actions={<NotificationBell />}
      onQueryChange={setQuery}
      placeholder="Search by name, phone or room"
      query={query}
      subtitle={subtitle}
      title="Residents"
    />
  );

  if (residents.loading) {
    return (
      <Screen header={header} insideTabs>
        {/* The shape is known — search, tabs, then people. See Money's note. */}
        <SkeletonRows rows={7} />
      </Screen>
    );
  }

  if (residents.error || !residents.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={residents.error ?? "The resident list could not be loaded."}
          onRetry={residents.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      floating={
        <FloatingButton
          icon="person-add-outline"
          label="Register a resident"
          onPress={() => router.push("/manage/resident/new")}
        />
      }
      header={header}
      insideTabs
      onRefresh={residents.refresh}
      refreshing={residents.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Segmented
          onChange={setSegment}
          options={[
            { count: roster.active, label: "Living here", value: "active" },
            { count: roster.pending, label: "To move in", value: "pending" },
            { count: roster.total, label: "Everyone", value: "all" },
          ]}
          value={segment}
        />

        {visible.length === 0 ? (
          <Card className="gap-3">
            <EmptyState
              compact
              description={
                query && elsewhere > 0
                  ? `Nobody here matches “${query.trim()}”, but ${
                      elsewhere === 1 ? "one record does" : `${elsewhere} records do`
                    } under Everyone.`
                  : query
                    ? "No resident matches that. Try a name, a phone number or a room type."
                    : "Nobody is in this list yet."
              }
              title={query ? "No match in this list" : "Nobody to show"}
            />

            {query && elsewhere > 0 && segment !== "all" ? (
              <Button
                label="Search everyone"
                onPress={() => setSegment("all")}
                size="sm"
                variant="outline"
              />
            ) : null}
          </Card>
        ) : (
          /*
            One card per person, not one card of rows.

            A roster is a list of *people*, and people are the case where the
            gap between cards earns its space: it is a stronger break than a
            hairline, so a thumb scrolling forty rows lands on one person at a
            time instead of reading down a table. The same change was made to
            the Money list, from the same references.
          */
          <View className="gap-3">
            {visible.map((resident) => {
              const row = (
                <CardRow
                  /*
                   * A face per row. Almost nobody here has uploaded a photo, so
                   * this is the initial circle — and its colour is derived from
                   * the name, which is what makes two adjacent rows of a
                   * forty-person roster tell themselves apart at a glance.
                   */
                  left={
                    <Avatar
                      name={`${resident.firstName} ${resident.lastName}`.trim()}
                      size="md"
                    />
                  }
                  /*
                   * The row opens the record; calling is the swipe, and is also
                   * one tap inside. Calling used to be the row's only action,
                   * which meant a resident with no phone rendered identically to
                   * one with a phone and silently did nothing when tapped — the
                   * same trap §11.6 found on the Money screen.
                   */
                  onPress={() => router.push(`/manage/resident/${resident.id}`)}
                  right={
                    // `shrink-0`: a long name is the thing allowed to truncate,
                    // not the status, which is the only word on the row saying
                    // whether this person is actually here.
                    <View className="shrink-0">
                      <StatusPill status={resident.status} />
                    </View>
                  }
                  subtitle={[
                    humanizeEnum(resident.roomType),
                    resident.phone,
                    `Since ${dates.date(resident.moveInDate)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  title={`${resident.firstName} ${resident.lastName}`.trim()}
                />
              );

              return resident.phone ? (
                <SwipeRow
                  actionIcon="call"
                  actionLabel="Call"
                  key={resident.id}
                  onAction={() => void Linking.openURL(`tel:${resident.phone}`)}
                >
                  {row}
                </SwipeRow>
              ) : (
                <View key={resident.id}>{row}</View>
              );
            })}
          </View>
        )}

        <Text className="px-1" variant="caption">
          Tap anyone to open their record — details, status, activation code, guardians
          and both checklists. Pull a row left to ring them.
        </Text>
      </View>
    </Screen>
  );
}
