import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import {
  type AdminHostel,
  type AdminReport,
  getAdminHostel,
  getAdminReport,
} from "@/lib/admin-api";
import { occupancyRate } from "@/lib/admin-alerts";
import { humanizeEnum } from "@/lib/format";

/**
 * The hostel at a glance — read-only, and short on purpose.
 *
 * ## What this screen is not
 *
 * It is not the web dashboard. The web portal carries fee schedules, billing
 * runs, statement reconciliation, warden management, room configuration and
 * nine report views, none of which anybody does standing up. Admin-lite answers
 * one question — *is anything wrong right now* — and hands everything else to
 * the browser from the More tab.
 *
 * ## Occupancy can be unknown, and says so
 *
 * `vacantBeds` comes from `capacitySummary`, which a hostel that never
 * configured its rooms does not have. `occupancyRate` returns null there rather
 * than 0: an admin with forty residents reading "0% occupied" stops believing
 * the rest of the screen, and they would be right to.
 */
type Overview = { hostel: AdminHostel | null; report: AdminReport };

async function loadOverview(): Promise<Overview> {
  const [report, hostel] = await Promise.all([
    getAdminReport(),
    // A warden may be scoped to several hostels, in which case the profile read
    // needs a hostelId it has no way to choose. The numbers above still apply
    // across all of them, so the header simply loses its name.
    getAdminHostel().catch(() => null),
  ]);

  return { hostel, report };
}

export default function AdminOverviewScreen() {
  const overview = useResource<Overview>(useCallback(() => loadOverview(), []), {
    topics: [
      REALTIME_TOPIC.PAYMENTS,
      REALTIME_TOPIC.RESIDENTS,
      REALTIME_TOPIC.COMPLAINTS,
      REALTIME_TOPIC.SAFETY,
    ],
  });

  const header = <AppBar subtitle={overview.data?.hostel?.name} title="Overview" />;

  if (overview.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your hostel" />
      </Screen>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={overview.error ?? "The dashboard could not be loaded."}
          onRetry={overview.reload}
        />
      </Screen>
    );
  }

  const { hostel, report } = overview.data;
  const occupancy = occupancyRate(report);
  const nightStatuses = Object.entries(report.nightStatusSummary ?? {}).filter(
    ([, count]) => count > 0,
  );

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={overview.refresh}
      refreshing={overview.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-2">
          <Text variant="caption">Collected this month</Text>
          <Money size="display" value={report.paidAmount} />
          <View className="flex-row items-center gap-2">
            <Badge
              label={
                report.monthlyDues - report.paidAmount > 0 ? "Dues outstanding" : "Settled"
              }
              tone={report.monthlyDues - report.paidAmount > 0 ? "warning" : "success"}
            />
            <Text variant="caption">
              {`of ${report.monthlyDues.toLocaleString("en-NP")} billed`}
            </Text>
          </View>
        </Card>

        <View>
          <SectionHeader title="Occupancy" />
          <Card>
            <ListRow
              title="Residents"
              value={String(report.residents)}
            />
            <RowDivider />
            <ListRow title="Vacant beds" value={String(report.vacantBeds)} />
            <RowDivider />
            <ListRow
              title="Occupied"
              value={occupancy === null ? "Rooms not configured" : `${occupancy}%`}
            />
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="What is open right now" title="Needs attention" />
          <Card>
            <ListRow
              icon="card-outline"
              onPress={() => router.push("/(admin)/alerts")}
              right={
                <Badge
                  label={String(report.pendingPaymentProofs)}
                  tone={report.pendingPaymentProofs > 0 ? "warning" : "neutral"}
                />
              }
              title="Payment claims to verify"
            />
            <RowDivider inset />
            <ListRow
              icon="chatbox-ellipses-outline"
              onPress={() => router.push("/(admin)/alerts")}
              right={<Badge label={String(report.complaints)} tone="neutral" />}
              title="Complaints"
            />
            <RowDivider inset />
            <ListRow
              icon="construct-outline"
              right={<Badge label={String(report.maintenanceRequests)} tone="neutral" />}
              title="Maintenance requests"
            />
          </Card>
        </View>

        {nightStatuses.length > 0 ? (
          <View>
            <SectionHeader subtitle="Tonight's roster" title="Night status" />
            <Card>
              {nightStatuses.map(([status, count], index) => (
                <View key={status}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow title={humanizeEnum(status)} value={String(count)} />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View>
          <SectionHeader subtitle="Last 30 days" title="Your listing" />
          <Card>
            <ListRow title="Views" value={String(report.publicViewsLast30Days)} />
            <RowDivider />
            <ListRow
              title="Unique visitors"
              value={String(report.uniquePublicVisitors)}
            />
            {hostel ? (
              <>
                <RowDivider />
                <ListRow title="Listing status" value={humanizeEnum(hostel.status)} />
              </>
            ) : null}
          </Card>
        </View>
      </View>
    </Screen>
  );
}
