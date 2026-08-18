import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { GuardianWardCard } from "@/components/guardian-ward-card";
import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { MealRow } from "@/components/meal-row";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { formatMoney, formatPeriod, humanizeEnum } from "@/lib/format";
import {
  canSee,
  guardianDueAmount,
  guardianPaidAmount,
  sharesNothing,
} from "@/lib/guardian";
import { type GuardianDashboard, getGuardianDashboard } from "@/lib/guardian-api";

/**
 * A guardian's home: their ward, and only what the resident chose to share.
 *
 * ## One request, not five
 *
 * `/guardian/payments`, `/notices`, `/food` and `/safety-summary` each call
 * `getGuardianDashboard` on the server and return a slice of it, so fetching
 * them per tab would be four identical database round trips. Every guardian
 * screen loads the dashboard and slices it locally.
 *
 * ## Sections are absent, not empty
 *
 * The server gates each query by its own permission flag, so an ungranted
 * section arrives as `[]` — the same payload as a section that is genuinely
 * empty. Drawing "no notices yet" at a guardian who was never granted notices
 * states something about the hostel that this app has no basis for. So each
 * block below is behind `canSee(...)`, and a guardian who was granted nothing
 * gets one honest card instead of five empty ones.
 *
 * ## Against `guardian-dashboard-page.tsx` (§5.2)
 *
 * The web's metric row is ported, with the same permission gating: the tiles
 * are built from what is shared, so this row can legitimately hold one tile or
 * three. **"Paid" is new to mobile** — every row it sums was already on screen,
 * but a parent looking at an outstanding figure with no sense of what has been
 * settled reads a debt rather than a rhythm.
 *
 * Still not ported, and still deliberate: the web's **"Make a Payment" button**
 * (there is no guardian payment route anywhere in `apps/web`, so it did
 * nothing), and its **"Emergency Status: Normal"** tile on the safety page (the
 * payload has no SOS field, so it printed "Normal" whether or not an alert was
 * live). Telling a parent there is no emergency without having asked is the one
 * thing these screens must never do.
 */
export default function GuardianHomeScreen() {
  const guardian = useResource<GuardianDashboard>(
    useCallback(() => getGuardianDashboard(), []),
    {
      topics: [
        REALTIME_TOPIC.PAYMENTS,
        REALTIME_TOPIC.NOTICES,
        REALTIME_TOPIC.FOOD,
        REALTIME_TOPIC.SAFETY,
      ],
    },
  );

  const header = <AppBar title="Home" />;

  if (guardian.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your ward's summary" />
      </Screen>
    );
  }

  if (guardian.error || !guardian.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={guardian.error ?? "Your guardian dashboard could not be loaded."}
          onRetry={guardian.reload}
        />
      </Screen>
    );
  }

  const dashboard = guardian.data;
  const wardName = dashboard.resident.fullName;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={guardian.refresh}
      refreshing={guardian.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <GuardianWardCard dashboard={dashboard} />

        {sharesNothing(dashboard) ? (
          <Card className="gap-2">
            <Text variant="subtitle">Nothing is shared yet</Text>
            <Text variant="muted">
              {`${wardName} has not turned on any sharing for this guardian account. You can see that they are a resident here; fees, meals, notices and night status stay private until they choose otherwise.`}
            </Text>
          </Card>
        ) : null}

        {canSee(dashboard, "canViewSafety") && dashboard.safety ? (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="label">Night status</Text>
              <StatusPill status={dashboard.safety.status} />
            </View>
            {/*
              A date, never a time. `asOf` is truncated by the serializer on
              purpose — the exact minute a resident was checked is the
              surveillance detail PHASES.md §4.1 rules out showing a guardian.
            */}
            <Text variant="caption">
              {dashboard.safety.asOf
                ? `As of ${dashboard.safety.asOf}`
                : "Not verified recently"}
            </Text>
          </Card>
        ) : null}

        {canSee(dashboard, "canViewPayments") ? (
          <Card className="gap-2">
            <Text variant="caption">Outstanding</Text>
            <Money owed size="display" value={dashboard.summary?.dueAmount ?? 0} />
            <View className="flex-row items-center gap-2">
              <Badge
                label={
                  (dashboard.summary?.unpaidCount ?? 0) > 0
                    ? `${dashboard.summary?.unpaidCount} unpaid`
                    : "All settled"
                }
                tone={(dashboard.summary?.unpaidCount ?? 0) > 0 ? "warning" : "success"}
              />
              {/*
                Read-only, and said so rather than left implied. There is no
                guardian payment endpoint — the web's dashboard had a "Make a
                Payment" button with nothing behind it, which is worse than no
                button at all.
              */}
              <Text className="flex-1" variant="caption">
                Payment is made from the resident&apos;s portal
              </Text>
            </View>
          </Card>
        ) : null}

        <GuardianMetrics dashboard={dashboard} />

        {canSee(dashboard, "canViewFood") ? (
          <View>
            <SectionHeader subtitle="What the kitchen is serving" title="Today's meals" />
            <Card className="gap-2">
              {dashboard.food.length === 0 ? (
                <EmptyState
                  description="The hostel has not published a routine for today."
                  title="No menu today"
                />
              ) : (
                /*
                 * The same meal block the resident's own screens use. A parent
                 * and their child looking at today's dinner should be looking at
                 * the same thing — and the items get two lines rather than a
                 * truncated row, which is where the answer actually is.
                 */
                dashboard.food.map((meal) => (
                  <MealRow
                    items={meal.items}
                    key={meal.id}
                    mealType={meal.mealType}
                    timing={meal.timing}
                  />
                ))
              )}
            </Card>
          </View>
        ) : null}

        {canSee(dashboard, "canViewNotices") ? (
          <View>
            <SectionHeader title="From the hostel" />
            <Card>
              {dashboard.notices.length === 0 ? (
                <EmptyState
                  description="Notices addressed to guardians appear here."
                  title="No notices"
                />
              ) : (
                dashboard.notices.map((notice, index) => (
                  <View key={notice.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={notice.isUrgent ? <Badge label="Urgent" tone="danger" /> : undefined}
                      subtitle={notice.content}
                      title={notice.title}
                    />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}

        {canSee(dashboard, "canViewComplaintStatus") ? (
          <View>
            <SectionHeader
              subtitle="Status only — never the text of what they wrote"
              title="Complaints"
            />
            <Card>
              {dashboard.complaints.length === 0 ? (
                <EmptyState
                  description={`${wardName} has not raised anything with the hostel.`}
                  title="Nothing open"
                />
              ) : (
                dashboard.complaints.map((complaint, index) => (
                  <View key={complaint.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={<StatusPill status={complaint.status} />}
                      title={complaint.title}
                    />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}

        {canSee(dashboard, "canViewPayments") ? (
          <Card>
            <ListRow
              icon="card-outline"
              onPress={() => router.push("/(guardian)/payments")}
              subtitle={
                dashboard.payments.length > 0
                  ? `Latest: ${formatPeriod(dashboard.payments[0]?.month)}`
                  : "Every month the hostel has billed"
              }
              title="See all dues"
            />
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

/**
 * The web's metric row, gated the same way everything else on this screen is.
 *
 * The tiles are **collected**, not rendered with `null` holes: a guardian who
 * shared only night status gets one tile filling the row rather than one tile
 * and two gaps where the finances would have been. `<Grid>` then fits whatever
 * survived to the width of the phone.
 */
function GuardianMetrics({ dashboard }: { dashboard: GuardianDashboard }) {
  const paid = guardianPaidAmount(dashboard);
  const due = guardianDueAmount(dashboard);
  const tiles = [];

  if (due !== null) {
    tiles.push(
      <StatTile
        icon="wallet-outline"
        key="due"
        label="Due"
        tone={due > 0 ? "warning" : "success"}
        trend={
          (dashboard.summary?.unpaidCount ?? 0) > 0
            ? `${dashboard.summary?.unpaidCount} unpaid`
            : "Nothing owed"
        }
        value={formatMoney(due)}
      />,
    );
  }

  if (paid !== null) {
    tiles.push(
      <StatTile
        icon="receipt-outline"
        key="paid"
        label="Paid"
        tone="success"
        // The qualifier matters: the guardian sees the invoices the resident
        // shared and no others, so this is not a lifetime total.
        trend="Across shared invoices"
        value={formatMoney(paid)}
      />,
    );
  }

  if (canSee(dashboard, "canViewSafety") && dashboard.safety) {
    tiles.push(
      <StatTile
        icon="moon-outline"
        key="safety"
        label="Night"
        tone={dashboard.safety.status === "VERIFIED" ? "success" : "neutral"}
        // A date, never a time — `asOf` is truncated by the serializer and
        // deriving a time from it is the surveillance detail §4.1 rules out.
        trend={dashboard.safety.asOf ? `As of ${dashboard.safety.asOf}` : "Not verified"}
        value={humanizeEnum(dashboard.safety.status)}
      />,
    );
  }

  if (tiles.length === 0) {
    return null;
  }

  return (
    <Grid gap={10} maxColumns={3} minCellWidth={104}>
      {tiles}
    </Grid>
  );
}
