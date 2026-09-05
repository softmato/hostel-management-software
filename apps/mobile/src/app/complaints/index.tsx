import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { complaintCategoryLabel, complaintStanding } from "@/lib/complaints";
import {
  type Complaint,
  type ComplaintList,
  getResidentComplaints,
} from "@/lib/complaints-api";

/**
 * Everything this resident has raised.
 *
 * ## Open first, then the rest
 *
 * Sorted newest-first by the server, which is right within a group and wrong
 * across them: a complaint resolved this morning would sit above the one that
 * has been ignored for a week. So open complaints are lifted to the top and the
 * closed ones keep their own order underneath — the list is a worklist, and the
 * thing still waiting is the thing to see first.
 *
 * ## No pager
 *
 * The route takes no query, so the response is always the newest 100. A pager
 * would be a control the server ignores. See `lib/complaints-api.ts`.
 */

const OPEN_STATUSES = new Set(["IN_PROGRESS", "PENDING"]);

/** Awaiting the resident's own confirmation — the only row with something to do. */
function needsResident(complaint: Complaint) {
  return complaint.status === "RESOLVED" && !complaint.confirmedAt;
}

function rank(complaint: Complaint) {
  if (needsResident(complaint)) {
    return 0;
  }

  return OPEN_STATUSES.has(complaint.status) ? 1 : 2;
}

export default function ComplaintsScreen() {
  const complaints = useResource<ComplaintList>(
    useCallback(() => getResidentComplaints(), []),
    { topics: [REALTIME_TOPIC.COMPLAINTS] },
  );
  const [showClosed, setShowClosed] = useState(true);

  const rows = useMemo(() => {
    const all = complaints.data?.complaints ?? [];

    // A copy: `sort` mutates, and this array belongs to the resource's state.
    return [...all].sort((left, right) => rank(left) - rank(right));
  }, [complaints.data]);

  const open = rows.filter((complaint) => OPEN_STATUSES.has(complaint.status));
  const visible = showClosed
    ? rows
    : rows.filter(
        (complaint) => OPEN_STATUSES.has(complaint.status) || needsResident(complaint),
      );

  const header = (
    <AppBar
      showBack
      subtitle={
        complaints.data
          ? open.length > 0
            ? `${open.length} still open`
            : "Nothing open"
          : undefined
      }
      title="Complaints"
    />
  );

  if (complaints.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading your complaints" />
      </Screen>
    );
  }

  if (complaints.error || !complaints.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={complaints.error ?? "Your complaints could not be loaded."}
          onRetry={complaints.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      floating={
        <FloatingButton
          icon="add"
          label="Raise a complaint"
          onPress={() => router.push("/complaints/new")}
        />
      }
      header={header}
      onRefresh={complaints.refresh}
      refreshing={complaints.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        {rows.length === 0 ? (
          <EmptyState
            description="Raise one and you can follow it here until it is fixed."
            title="No complaints yet"
          />
        ) : (
          <>
            {/* Only worth a control once there is something it would hide. */}
            {rows.length > open.length ? (
              <ScrollView
                contentContainerClassName="gap-2"
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                <FilterChip
                  active={showClosed}
                  label="All"
                  onPress={() => setShowClosed(true)}
                />
                <FilterChip
                  active={!showClosed}
                  label="Needs attention"
                  onPress={() => setShowClosed(false)}
                />
              </ScrollView>
            ) : null}

            {visible.length === 0 ? (
              <EmptyState
                description="Everything you raised has been closed out."
                title="Nothing needs you"
              />
            ) : (
              <View className="gap-3">
                {visible.map((complaint) => (
                  <ComplaintCard complaint={complaint} key={complaint.id} />
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </Screen>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
        active ? "border-primary bg-primary" : "border-border"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-sm font-medium ${
          active ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ComplaintCard({ complaint }: { complaint: Complaint }) {
  const dates = useDates();

  const { colors } = useAppTheme();
  const standing = complaintStanding(complaint);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/complaints/${complaint.id}`)}
    >
      {/*
        The left border marks a row waiting on the resident, not one that is
        merely overdue: overdue is the hostel's problem to fix and already says
        so in words, while an unconfirmed resolution is the one thing this screen
        can ask *them* to do.
      */}
      <Card
        className={`gap-2 active:opacity-80 ${
          standing.action ? "border-l-4 border-l-primary" : ""
        }`}
      >
        <View className="flex-row items-start gap-2">
          <Text className="flex-1" variant="subtitle">
            {complaint.title}
          </Text>
          <StatusPill status={complaint.status} />
        </View>

        <Text numberOfLines={2} variant="muted">
          {complaint.description}
        </Text>

        <Text variant="caption">{standing.headline}</Text>

        <View className="flex-row items-center gap-2">
          <Badge label={complaintCategoryLabel(complaint.category)} />
          {complaint.isOverdue ? <Badge label="Overdue" tone="danger" /> : null}
          {complaint.isAnonymous ? <Badge label="Anonymous" /> : null}

          {complaint.attachments.length > 0 ? (
            <View className="flex-row items-center gap-1">
              <Ionicons
                color={colors.mutedForeground}
                name="image-outline"
                size={14}
              />
              <Text variant="caption">{complaint.attachments.length}</Text>
            </View>
          ) : null}

          <View className="flex-1" />
          <Text variant="caption">{dates.relativeDay(complaint.createdAt)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}
