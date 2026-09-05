import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  NIGHT_STATUS_OPTIONS,
  nightNote,
  nightStanding,
  type SelfReportableStatus,
} from "@/lib/night-status";
import {
  getResidentNightStatus,
  type NightStatus,
  type NightStatusView,
  setResidentNightStatus,
} from "@/lib/resident-api";
import type { SosAlert } from "@/lib/safety-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Telling the hostel where you are tonight.
 *
 * ## Three choices, not the five the server takes
 *
 * `nightStatusUpdateSchema` validates against the whole enum on the resident
 * route, which means a client *could* set `SOS_TRIGGERED` — and nothing would
 * happen: no alert row, no fan-out, no notification, just the word "SOS" on the
 * warden's roster. `lib/night-status.ts` holds the subset and the reasoning.
 *
 * ## There is no history section
 *
 * Every change appends a `NightStatusLog` and **nothing anywhere reads it** — no
 * resident route, no admin route, no aggregation (§1 of
 * `docs/MOBILE_APP_PHASES.md`). An empty "History" heading would suggest the
 * feature exists and is broken; its absence suggests nothing at all, which is
 * accurate.
 *
 * ## Nothing is preselected from a stale answer
 *
 * A night runs 17:00 → 17:00 Nepal time. Last night's status is shown as
 * history-of-record but does not preselect a choice: a preselected stale answer
 * is one tap away from confirming a location nobody has asked about since.
 */

export default function NightStatusScreen() {
  /*
    The endpoint returns the resident's latest `SOSAlert` alongside the status
    row now. The screen needs both: the row says an SOS was written and the alert
    says whether staff have closed it — and the row alone can never say, because
    `writeNightStatus` upserts one per resident and expires nothing.
  */
  const resource = useResource<NightStatusView>(
    useCallback(() => getResidentNightStatus(), []),
    { topics: [REALTIME_TOPIC.SAFETY] },
  );

  const header = <AppBar showBack title="Night status" />;

  if (resource.loading) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  if (resource.error || !resource.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={resource.error ?? "Your night status could not be loaded."}
          onRetry={resource.reload}
        />
      </Screen>
    );
  }

  return (
    <NightStatusForm
      header={header}
      /*
        Only the status comes back from the POST — `updateResidentNightStatus`
        returns the row it wrote and nothing about the alert, which is correct:
        answering a night check does not close an SOS. So the alert already on
        screen is carried through untouched.
      */
      onChanged={(status) =>
        resource.setData((view) => (view ? { ...view, status } : { sos: null, status }))
      }
      onRefresh={resource.refresh}
      refreshing={resource.refreshing}
      sos={resource.data.sos}
      status={resource.data.status}
    />
  );
}

function NightStatusForm({
  header,
  onChanged,
  onRefresh,
  refreshing,
  sos,
  status,
}: {
  header: React.ReactNode;
  onChanged: (status: NightStatus) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** The resident's latest alert, or null if they have never raised one. */
  sos: SosAlert | null;
  status: NightStatus;
}) {
  const dates = useDates();

  const { colors } = useAppTheme();
  const standing = nightStanding(status, new Date(), sos);
  const [choice, setChoice] = useState<SelfReportableStatus | null>(
    standing.suggested,
  );
  const [note, setNote] = useState(status.note);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!choice) {
      return;
    }

    const parsed = nightNote(note);

    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    setError(null);
    setSaving(true);

    try {
      const next = await setResidentNightStatus({ ...parsed, status: choice });

      onChanged(next);
      toastSuccess("Status updated", "Your hostel can see this now.");
    } catch (caught) {
      toastError("Could not update your status", readApiError(caught));
    } finally {
      setSaving(false);
    }
  }, [choice, note, onChanged]);

  return (
    <Screen
      footer={
        <Button
          disabled={!choice}
          label={standing.answered ? "Update my status" : "Tell my hostel"}
          loading={saving}
          onPress={() => void save()}
        />
      }
      header={header}
      onRefresh={onRefresh}
      refreshing={refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="label">Right now</Text>
            <StatusPill status={status.status} />
          </View>

          <Text variant="muted">{standing.headline}</Text>

          {status.checkedAt ? (
            <Text variant="caption">
              Last set {dates.dateTime(status.checkedAt)}
              {standing.answered ? "" : " — that was an earlier night"}
            </Text>
          ) : null}
        </Card>

        {standing.sosNotice ? (
          <Card className="gap-2 border-l-4 border-l-destructive">
            <View className="flex-row items-center gap-2">
              <Ionicons color={colors.destructive} name="warning-outline" size={18} />
              <Text variant="label">An SOS is on your record</Text>
            </View>
            <Text variant="muted">{standing.sosNotice}</Text>
          </Card>
        ) : null}

        <View className="gap-2">
          <Text variant="label">Where are you tonight?</Text>

          {NIGHT_STATUS_OPTIONS.map((option) => {
            const selected = option.value === choice;

            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.value}
                onPress={() => setChoice(option.value)}
              >
                <Card
                  className={`flex-row items-center gap-3 active:opacity-80 ${
                    selected ? "border-primary" : ""
                  }`}
                >
                  <View
                    className="h-10 w-10 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: selected ? colors.brandSoft : colors.muted,
                    }}
                  >
                    <Ionicons
                      color={selected ? colors.primary : colors.mutedForeground}
                      name={option.icon}
                      size={19}
                    />
                  </View>

                  <View className="flex-1">
                    <Text variant="label">{option.label}</Text>
                    <Text variant="caption">{option.description}</Text>
                  </View>

                  <Ionicons
                    color={selected ? colors.primary : colors.border}
                    name={selected ? "radio-button-on" : "radio-button-off"}
                    size={20}
                  />
                </Card>
              </Pressable>
            );
          })}
        </View>

        <Input
          error={error}
          hint="Only your hostel's staff see this."
          label="Anything they should know? (optional)"
          maxLength={1000}
          multiline
          onChangeText={setNote}
          placeholder="Back tomorrow morning."
          style={{ height: 88, paddingTop: 12, textAlignVertical: "top" }}
          value={note}
        />
      </View>
    </Screen>
  );
}
