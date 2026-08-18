import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { formatDate, humanizeEnum } from "@/lib/format";
import { listProviderJobs, type ProviderJob } from "@/lib/provider-api";
import { isOpenJob, jobAddress, openJobCount, sortProviderJobs } from "@/lib/provider-jobs";

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
