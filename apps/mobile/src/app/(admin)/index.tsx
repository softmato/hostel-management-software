import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid, StatTile } from "@/components/ui/layout";
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
 *
 * ## Against `hostel-admin-dashboard-page.tsx` (§5.5)
 *
 * The web's metric grid is ported for the two blocks that are *figures read
 * together* — occupancy and listing reach — because that is what a tile row is
 * for. **"Needs attention" stays rows**, and deliberately: those are a queue,
 * each one is a destination, and a tile with a number on it is a worse tap
 * target than a row with a label and a chevron. The rest of the web dashboard —
 * fee schedules, billing runs, reconciliation, warden management, room config,
 * nine report views — stays in the browser, which is what the More tab says.
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
          {/*
            Tiles rather than three label/value rows. These are the numbers an
            owner glances at, and a glance is what a tile is for — a stack of
            rows reads left-to-right, one at a time, which is the wrong shape for
            three figures that mean something together.
          */}
          <Grid gap={10} maxColumns={3} minCellWidth={104}>
            <StatTile
              icon="people-outline"
              label="Residents"
              tone="brand"
              trend="Active right now"
              value={String(report.residents)}
            />
            <StatTile
              icon="bed-outline"
              label="Vacant"
              tone={report.vacantBeds > 0 ? "warning" : "neutral"}
              trend={report.vacantBeds > 0 ? "Beds to fill" : "Full"}
              value={String(report.vacantBeds)}
            />
            <StatTile
              icon="pie-chart-outline"
              label="Occupied"
              tone={occupancy === null ? "neutral" : "success"}
              // Null, not zero. An owner with forty residents reading "0%"
              // stops believing the rest of the screen, and would be right to.
              trend={occupancy === null ? "Configure rooms" : "Of configured beds"}
              value={occupancy === null ? "—" : `${occupancy}%`}
            />
          </Grid>
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
          <Grid gap={10} maxColumns={3} minCellWidth={104}>
            <StatTile
              icon="eye-outline"
              label="Views"
              tone="neutral"
              trend="Last 30 days"
              value={String(report.publicViewsLast30Days)}
            />
            <StatTile
              icon="person-outline"
              label="Visitors"
              tone="neutral"
              trend="Unique"
              value={String(report.uniquePublicVisitors)}
            />
            {/*
              Absent rather than "Unknown" when the hostel read failed: a warden
              scoped to several hostels has no single profile to show, which is
              not the same as a listing whose status could not be determined.
            */}
            {hostel ? (
              <StatTile
                icon="storefront-outline"
                label="Listing"
                tone={hostel.status === "PUBLISHED" ? "success" : "warning"}
                trend="Public profile"
                value={humanizeEnum(hostel.status)}
              />
            ) : null}
          </Grid>
        </View>
      </View>
    </Screen>
  );
}
