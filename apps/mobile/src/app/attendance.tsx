import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SkeletonCard, SkeletonTiles } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  type AttendanceDay,
  groupByMonth,
  type ResidentAttendance,
  sourceNote,
  summarize,
  zoneLabel,
  zoneTone,
} from "@/lib/attendance";
import {
  deleteLocationHistory,
  getResidentAttendance,
  setLocationConsent,
} from "@/lib/attendance-api";
import { formatDate, formatPeriod } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * What the app has recorded about where you were.
 *
 * ## This screen ships before any pinging does
 *
 * Deliberate sequencing, and the reason it is Phase 1 of §3.1 while the
 * geofencing is Phase 2: a resident must be able to **see and delete** what is
 * held about them before the app starts producing more of it. Shipping the
 * collection first and the controls later is the order that makes a privacy
 * feature an afterthought.
 *
 * ## Zones, never coordinates
 *
 * `getResidentAttendance` returns `{ day, source, zone }` and nothing else. The
 * server holds a distance; it does not hold a lat/lng, and neither does this
 * app — see `lib/attendance-api.ts` and `lib/location.ts`, which hold the same
 * line for the same reason.
 *
 * ## Being away is not a warning
 *
 * `docs/DESIGN.md`: *"'Outside Hostel' is a neutral status, not a warning —
 * students leaving the hostel is normal life, not a red flag."* So no row on
 * this screen is red, no figure is framed as a shortfall, and there is
 * deliberately **no percentage** — a location log read as an attendance grade is
 * exactly the surveillance framing the design rules out. `lib/attendance.ts`
 * holds those rules with the tests.
 *
 * ## Two separate decisions, two separate controls
 *
 * *Stop recording* and *delete what was recorded* are not the same thing and are
 * not offered as one. Withdrawing consent leaves the history; erasing the
 * history does not withdraw consent. The server models them separately
 * (`ConsentLog` versus `AttendanceLogModel`), residents ask for them separately,
 * and collapsing them into one switch would mean somebody who wanted to stop
 * being tracked silently destroyed their own record — or the reverse.
 */
export default function AttendanceScreen() {
  const attendance = useResource<ResidentAttendance>(
    useCallback(() => getResidentAttendance(), []),
    { topics: [REALTIME_TOPIC.ATTENDANCE] },
  );

  const [busy, setBusy] = useState(false);

  const header = <AppBar showBack title="Location & attendance" />;

  const toggleConsent = useCallback(
    async (granted: boolean) => {
      setBusy(true);

      try {
        await setLocationConsent(granted);
        toastSuccess(
          granted ? "Location recording is on" : "Location recording is off",
          granted
            ? undefined
            : "Nothing new will be recorded. What is already stored stays until you delete it.",
        );
        await attendance.reload();
      } catch (caught) {
        toastError("That did not save", readApiError(caught));
      } finally {
        setBusy(false);
      }
    },
    [attendance],
  );

  const erase = useCallback(() => {
    Alert.alert(
      "Delete your location history?",
      "Every stored day is erased, including your hostel's copy on their attendance board. This cannot be undone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void (async () => {
              try {
                await deleteLocationHistory();
                toastSuccess("Your location history was deleted.");
                await attendance.reload();
              } catch (caught) {
                toastError("Could not delete that", readApiError(caught));
              }
            })();
          },
          style: "destructive",
          text: "Delete history",
        },
      ],
    );
  }, [attendance]);

  if (attendance.loading) {
    return (
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <SkeletonCard rows={1} />
          <SkeletonTiles columns={2} />
          <SkeletonCard rows={5} />
        </View>
      </Screen>
    );
  }

  if (attendance.error || !attendance.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={attendance.error ?? "Your attendance could not be loaded."}
          onRetry={attendance.reload}
        />
      </Screen>
    );
  }

  const { attendance: days, consentGranted } = attendance.data;
  const months = groupByMonth(days);
  const stats = summarize(days);

  return (
    <Screen
      header={header}
      onRefresh={attendance.refresh}
      refreshing={attendance.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <ListRow
            right={
              <Toggle
                accessibilityLabel="Record my location for attendance"
                disabled={busy}
                onChange={(next) => void toggleConsent(next)}
                value={consentGranted}
              />
            }
            subtitle={
              consentGranted
                ? "Your hostel can see whether you were at the hostel each day."
                : "Nothing new is being recorded."
            }
            title="Record my location"
          />

          {/*
            Said in full, in plain words, on the screen that switches it on —
            not buried in a policy nobody opens. Each line answers a question a
            resident actually asks, in the order they ask it.
          */}
          <View className="gap-1.5 border-t border-border pt-3">
            <Text variant="label">What is stored</Text>
            <Text variant="muted">
              One line a day saying whether your phone was at the hostel, nearby, or
              away. Your actual location is never saved — not by the app, and not by
              your hostel.
            </Text>
            <Text variant="muted">
              It records where your <Text variant="label">phone</Text> is, so leaving
              it behind changes what your hostel sees.
            </Text>
            <Text variant="muted">
              Being away is not a problem and is not reported as one. Your hostel uses
              this to know who is in at night, not to check up on where you go.
            </Text>
          </View>
        </Card>

        {days.length > 0 ? (
          <Grid gap={10} maxColumns={2} minCellWidth={140}>
            <StatTile
              icon="home-outline"
              label="At the hostel"
              tone="brand"
              trend={`of ${stats.recorded} days recorded`}
              value={String(stats.inside)}
            />
            <StatTile
              icon="calendar-outline"
              label="Days recorded"
              tone="neutral"
              trend="Last 60 days"
              value={String(stats.recorded)}
            />
          </Grid>
        ) : null}

        {months.length === 0 ? (
          <Card>
            <EmptyState
              compact
              description={
                consentGranted
                  ? "Nothing has been recorded yet. Readings appear here once your hostel has attendance switched on."
                  : "Nothing has been recorded. Switch recording on above if you want your hostel to know when you are in."
              }
              title="No days recorded"
            />
          </Card>
        ) : (
          months.map((month) => (
            <View key={month.period}>
              {/* Heading outside the card — NOTES §5. */}
              <SectionHeader title={formatPeriod(month.period)} />
              <Card>
                {month.days.map((entry, index) => (
                  <View key={entry.day}>
                    {index > 0 ? <RowDivider /> : null}
                    <DayRow entry={entry} />
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}

        {days.length > 0 ? (
          <View className="gap-2">
            <Button label="Delete my location history" onPress={erase} variant="danger" />
            <Text variant="caption">
              Deleting is separate from switching recording off — one stops new days
              being added, the other erases the days already there.
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function DayRow({ entry }: { entry: AttendanceDay }) {
  const note = sourceNote(entry.source);
  const tone = zoneTone(entry.zone);

  return (
    <ListRow
      right={
        /*
          `neutral` gets no badge at all rather than a grey one. Being away is
          the ordinary case, and a pill on every second row turns a calm list
          into something that looks like a compliance report.

          `brand` becomes the badge's `success` here, which is a mapping and not
          a change of mind: `<Badge>`'s tones are colour tokens and it has no
          brand green, while `zoneTone`'s vocabulary is about *meaning* — and
          that vocabulary deliberately refuses to call being inside a "success",
          because it would make being out a failure. The adapter lives here, at
          the presentation edge, so the domain rule stays intact and tested.
        */
        tone === "neutral" ? undefined : (
          <Badge
            label={zoneLabel(entry.zone)}
            tone={tone === "brand" ? "success" : "warning"}
          />
        )
      }
      subtitle={note ?? undefined}
      title={formatDate(entry.day)}
      value={tone === "neutral" ? zoneLabel(entry.zone) : undefined}
    />
  );
}
