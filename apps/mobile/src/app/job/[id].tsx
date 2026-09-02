import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, View } from "react-native";

import { VoiceNotePlayer } from "@/components/voice-note-player";
import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { formatDate, formatRelativeDay, humanizeEnum } from "@/lib/format";
import {
  listProviderJobs,
  type ProviderJob,
  type ProviderJobStatus,
  updateProviderJobStatus,
} from "@/lib/provider-api";
import { jobActions, jobAddress } from "@/lib/provider-jobs";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One job: where it is, who to call, and the two things this provider can say
 * about it.
 *
 * ## Why it reloads the whole list
 *
 * There is no `GET /public/service-providers/me/jobs/{id}`. The list endpoint
 * is already scoped to the caller's own assignments and capped at 100, so
 * fetching it and picking the row is one round trip with no new server surface
 * — and it means a job that was reassigned away shows "not found" rather than
 * stale detail a provider might act on. If the list ever needs paging, this is
 * the call site that wants a real detail route.
 *
 * ## Two actions, deliberately
 *
 * `serviceProviderJobStatusSchema` accepts `CONTACTED` and `COMPLETED` and
 * nothing else. Cancelling is the hostel's decision, scheduling carries a date
 * this screen has no field for, and reopening a signed-off job would let a
 * provider un-finish paid work. A 409 back from either action is worth showing
 * verbatim — the server's messages say what to do next.
 */
export default function ProviderJobScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const jobId = params.id ?? "";

  const jobs = useResource<ProviderJob[]>(useCallback(() => listProviderJobs(), []), {
    topics: [REALTIME_TOPIC.MAINTENANCE],
  });

  const [busy, setBusy] = useState<ProviderJobStatus | null>(null);

  const move = useCallback(
    async (status: ProviderJobStatus) => {
      setBusy(status);

      try {
        await updateProviderJobStatus(jobId, { status });
        toastSuccess(status === "COMPLETED" ? "Marked complete" : "Marked contacted");
        jobs.refresh();
      } catch (caught) {
        toastError("That didn't go through", readApiError(caught));
      } finally {
        setBusy(null);
      }
    },
    [jobId, jobs],
  );

  const header = <AppBar showBack title="Job" />;

  if (jobs.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading the job" />
      </Screen>
    );
  }

  if (jobs.error || !jobs.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={jobs.error ?? "This job could not be loaded."}
          onRetry={jobs.reload}
        />
      </Screen>
    );
  }

  const job = jobs.data.find((row) => row.id === jobId);

  if (!job) {
    return (
      <Screen header={header}>
        <Card className="gap-3">
          <Text variant="label">This job is no longer yours</Text>
          <Text variant="muted">
            It was reassigned or removed by the hostel. Nothing you did caused this.
          </Text>
          <Button
            label="Back to jobs"
            onPress={() => router.replace("/(provider)")}
            variant="outline"
          />
        </Card>
      </Screen>
    );
  }

  const address = jobAddress(job);
  const actions = jobActions(job);

  return (
    <Screen
      footer={
        actions.canComplete || actions.canContact ? (
          <View className="gap-2">
            {actions.canComplete ? (
              <Button
                label="Mark complete"
                loading={busy === "COMPLETED"}
                onPress={() => void move("COMPLETED")}
              />
            ) : null}
            {actions.canContact ? (
              <Button
                label="Mark contacted"
                loading={busy === "CONTACTED"}
                onPress={() => void move("CONTACTED")}
                variant="outline"
              />
            ) : null}
          </View>
        ) : undefined
      }
      header={header}
      onRefresh={jobs.refresh}
      refreshing={jobs.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1" variant="subtitle">
              {job.title}
            </Text>
            <StatusPill status={job.status} />
          </View>

          <View className="flex-row items-center gap-2">
            <Badge label={humanizeEnum(job.category)} />
            <Badge
              label={`${humanizeEnum(job.priority)} priority`}
              tone={job.priority === "URGENT" ? "danger" : "neutral"}
            />
          </View>

          {job.description ? <Text variant="muted">{job.description}</Text> : null}

          {/*
            The hostel describing the fault in their own voice.

            Worth more here than anywhere else in the app: this is the screen a
            contractor opens before driving across town, and the difference
            between "leak in 204" and thirty seconds of somebody pointing at the
            pipe is whether they bring the right part.
          */}
          {job.voiceNoteAssetId ? (
            <VoiceNotePlayer assetId={job.voiceNoteAssetId} />
          ) : null}
        </Card>

        <View>
          <SectionHeader title="Where" />
          <Card>
            <ListRow
              icon="location-outline"
              onPress={
                address
                  ? () =>
                      void Linking.openURL(
                        // No coordinates on a maintenance request, so this is a
                        // text search rather than a pin — which is also what an
                        // admin typing "Room 204" would expect.
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          address,
                        )}`,
                      )
                  : undefined
              }
              subtitle={address || undefined}
              title={job.hostelName}
            />
            {job.hostelPhone ? (
              <>
                <RowDivider inset />
                <ListRow
                  icon="call-outline"
                  onPress={() => void Linking.openURL(`tel:${job.hostelPhone}`)}
                  subtitle={job.hostelPhone}
                  title="Call the hostel"
                />
              </>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="When" />
          <Card>
            <ListRow
              title="Scheduled"
              value={job.scheduledFor ? formatDate(job.scheduledFor) : "Not scheduled"}
            />
            <RowDivider />
            <ListRow
              title="Assigned"
              value={job.createdAt ? formatRelativeDay(job.createdAt) : "—"}
            />
          </Card>
          {!actions.canComplete ? (
            <Text className="px-1 pt-2" variant="caption">
              This job is closed. Reopening it is the hostel&apos;s decision — call them
              if something is wrong.
            </Text>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
