import type { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { formatDate, humanizeEnum } from "@/lib/format";
import { listProviderJobs, type ProviderJob } from "@/lib/provider-api";
import {
  completedJobCount,
  isOpenJob,
  jobAddress,
  jobCategoryIcon,
  openJobCount,
  sortProviderJobs,
  urgentJobCount,
} from "@/lib/provider-jobs";

/**
 * The jobs a hostel assigned to this provider, open work first.
 *
 * ## There is no "available jobs" tab, and there should not be one
 *
 * Broadcast-and-claim does not exist server-side — PHASES.md §6.1's superseded
 * note records the decision and nothing in `apps/web` implements it. A second
 * tab that was permanently empty would read as a broken app rather than as a
 * product boundary, so the surface is exactly what the endpoint returns.
 *
 * ## Nothing about residents appears here
 *
 * `listOwnServiceProviderJobs` returns the hostel's name, area and phone and
 * deliberately no resident details: a maintenance job is about a place. The
 * `location` string ("Room 204") is free text the admin typed, not a link to
 * anybody.
 *
 * ## Against `provider-jobs-page.tsx` (§5.4)
 *
 * The web draws each job as a full card — title, hostel, description, category,
 * location, schedule and phone. **The rows stay rows here.** A provider opens
 * this to answer "how much work do I have and where", and eight cards deep
 * enough to hold a description is two jobs per screenful; the detail screen
 * already carries the description and the call button, which is the tap the web
 * card exists to save and a phone does not need saving.
 *
 * What the rows did lack was the trade. Every row looked identical, so a
 * provider scanning for their own work read every title — `jobCategoryIcon`
 * fixes that, and the metric strip answers the "how much" without counting.
 */
const PRIORITY_TONE = {
  HIGH: "warning",
  LOW: "neutral",
  MEDIUM: "neutral",
  URGENT: "danger",
} as const;

export default function ProviderJobsScreen() {
  const jobs = useResource<ProviderJob[]>(useCallback(() => listProviderJobs(), []), {
    topics: [REALTIME_TOPIC.MAINTENANCE],
  });

  const header = <AppBar title="Jobs" />;

  if (jobs.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your jobs" />
      </Screen>
    );
  }

  if (jobs.error || !jobs.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={jobs.error ?? "Your jobs could not be loaded."}
          onRetry={jobs.reload}
        />
      </Screen>
    );
  }

  const sorted = sortProviderJobs(jobs.data);
  const open = openJobCount(jobs.data);
  const urgent = urgentJobCount(jobs.data);
  const completed = completedJobCount(jobs.data);
  const firstClosedIndex = sorted.findIndex((job) => !isOpenJob(job));

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={jobs.refresh}
      refreshing={jobs.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        {sorted.length === 0 ? (
          <Card>
            <EmptyState
              description="Hostels assign work to you by name. Anything they send appears here."
              title="No jobs yet"
            />
          </Card>
        ) : (
          <>
            {/*
              The three numbers a provider wants before they read anything:
              what is waiting, what cannot wait, and what they have finished.
              `<Grid>` fits them to the phone — three across on any ordinary
              handset, two on a 320dp screen where "Completed" would truncate.
            */}
            <Grid gap={10} maxColumns={3} minCellWidth={104}>
              <StatTile
                icon="briefcase-outline"
                label="Open"
                tone={open > 0 ? "brand" : "neutral"}
                trend={open > 0 ? "Soonest first" : "Nothing waiting"}
                value={String(open)}
              />
              <StatTile
                icon="alert-circle-outline"
                label="Urgent"
                tone={urgent > 0 ? "danger" : "success"}
                trend={urgent > 0 ? "Needs attention" : "None right now"}
                value={String(urgent)}
              />
              <StatTile
                icon="checkmark-done-outline"
                label="Done"
                tone="success"
                trend={`of ${sorted.length} assigned`}
                value={String(completed)}
              />
            </Grid>

            <SectionHeader
              subtitle={open > 0 ? "Soonest first" : "Nothing open right now"}
              title={`${open} open`}
            />

            <Card>
              {sorted.map((job, index) => (
                <View key={job.id}>
                  {/*
                    One divider carries the whole "everything below is history"
                    boundary — a second Card and header for closed work pushes
                    the open list off the first screen on a phone.
                  */}
                  {index === firstClosedIndex && index > 0 ? (
                    <View className="border-t border-border pb-2 pt-4">
                      <Text variant="caption">Closed</Text>
                    </View>
                  ) : index > 0 ? (
                    <RowDivider />
                  ) : null}

                  <ListRow
                    // The trade, so a provider scanning for their own work does
                    // not have to read every title.
                    icon={jobCategoryIcon(job.category) as keyof typeof Ionicons.glyphMap}
                    onPress={() => router.push(`/job/${job.id}`)}
                    right={
                      <View className="items-end gap-1">
                        <StatusPill status={job.status} />
                        {isOpenJob(job) && job.priority !== "MEDIUM" ? (
                          <Badge
                            label={humanizeEnum(job.priority)}
                            tone={PRIORITY_TONE[job.priority]}
                          />
                        ) : null}
                      </View>
                    }
                    subtitle={[
                      jobAddress(job),
                      job.scheduledFor ? `Due ${formatDate(job.scheduledFor)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    title={job.title}
                  />
                </View>
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}
