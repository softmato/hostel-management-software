import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import {
  formatDate,
  formatDueLabel,
  formatPeriod,
  formatRelativeDay,
  greetingFor,
  humanizeEnum,
} from "@/lib/format";
import {
  getResidentDashboard,
  getResidentNightStatus,
  type NightStatus,
  type ResidentDashboard,
  type RoutineMeal,
} from "@/lib/resident-api";

/**
 * The resident's home.
 *
 * ## Why two requests
 *
 * `GET /resident/dashboard` returns a `nightStatus` field and it is a hardcoded
 * `{ status: "UNKNOWN", checkedAt: null }` — nothing on the server writes it.
 * Rendering that would tell every resident, forever, that their status is
 * unknown. The real value comes from `GET /resident/night-status`, so this
 * screen asks for both and ignores the dashboard's copy. The dashboard's
 * `complaints` block is a literal `{ openCount: 0, recent: [] }` for the same
 * reason, so it is not rendered at all rather than shown as a confident zero.
 *
 * Night status is fetched **tolerantly**: if the safety module errors, that one
 * card drops out and the rest still renders. Dues and today's menu are why
 * someone opened the app, and they should not vanish because an unrelated
 * collection is having a bad day.
 */

type HomeData = {
  dashboard: ResidentDashboard;
  nightStatus: NightStatus | null;
};

const MEAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  BREAKFAST: "sunny-outline",
  DINNER: "moon-outline",
  LUNCH: "restaurant-outline",
  SNACKS: "cafe-outline",
};

const QUICK_ACTIONS = [
  { href: "/(resident)/payments", icon: "card-outline", label: "Payments" },
  { href: "/(resident)/food", icon: "restaurant-outline", label: "Food" },
  { href: "/(resident)/notices", icon: "megaphone-outline", label: "Notices" },
  { href: "/(resident)/more", icon: "person-outline", label: "Profile" },
] as const;

async function loadHome(): Promise<HomeData> {
  const [dashboard, nightStatus] = await Promise.all([
    getResidentDashboard(),
    getResidentNightStatus().catch(() => null),
  ]);

  return { dashboard, nightStatus };
}

export default function ResidentHomeScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const home = useResource<HomeData>(useCallback(() => loadHome(), []));

  const dashboard = home.data?.dashboard;
  const firstName = dashboard?.resident.firstName ?? account?.name?.split(" ")[0] ?? "";

  const header = (
    <AppBar
      subtitle={dashboard?.hostel?.name ?? undefined}
      title={firstName ? `${greetingFor()}, ${firstName}` : greetingFor()}
    />
  );

  if (home.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your dashboard" />
      </Screen>
    );
  }

  if (home.error || !dashboard) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={home.error ?? "Your dashboard could not be loaded."}
          onRetry={home.reload}
        />
      </Screen>
    );
  }

  const nightStatus = home.data?.nightStatus ?? null;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={home.refresh}
      refreshing={home.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <DuesCard feeStatus={dashboard.feeStatus} />

        <RoomCard
          hostel={dashboard.hostel}
          moveInDate={dashboard.resident.moveInDate}
          roomType={dashboard.accommodation.roomType}
        />

        {nightStatus ? <NightStatusCard status={nightStatus} /> : null}

        <TodaysMenuCard meals={dashboard.foodMenu} />

        <NoticesCard notices={dashboard.notices} />

        <QuickActions />
      </View>
    </Screen>
  );
}

function DuesCard({ feeStatus }: { feeStatus: ResidentDashboard["feeStatus"] }) {
  const owes = feeStatus.dueAmount > 0;
  const latest = feeStatus.latestPayment;
  const dueLabel = formatDueLabel(latest?.dueDate);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="caption">{owes ? "Outstanding" : "Balance"}</Text>
          <Money owed size="display" value={feeStatus.dueAmount} />
        </View>

        {feeStatus.pendingProofs > 0 ? (
          <Badge
            label={
              feeStatus.pendingProofs === 1
                ? "1 claim in review"
                : `${feeStatus.pendingProofs} claims in review`
            }
            tone="warning"
          />
        ) : null}
      </View>

      {latest ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text variant="muted">{formatPeriod(latest.month)}</Text>
          <StatusPill status={latest.status} />
          {/*
            The due label is the actionable half: "NPR 8,500 outstanding" is a
            fact, "4 days overdue" is a reason to open the tab.
          */}
          {dueLabel ? <Text variant="caption">{dueLabel}</Text> : null}
        </View>
      ) : null}

      <Button
        label={owes ? "Pay now" : "View payments"}
        onPress={() => router.push("/(resident)/payments")}
        variant={owes ? "primary" : "outline"}
      />
    </Card>
  );
}

function RoomCard({
  hostel,
  moveInDate,
  roomType,
}: {
  hostel: ResidentDashboard["hostel"];
  moveInDate: string;
  roomType: string;
}) {
  // Residents are placed by room *type*, not by room number — that is all the
  // accommodation detail the server holds, so showing a bed number here would
  // mean inventing one.
  const area = [hostel?.location.area, hostel?.location.city].filter(Boolean).join(", ");

  return (
    <Card>
      <ListRow icon="bed-outline" subtitle="Room type" title={humanizeEnum(roomType)} />
      <RowDivider inset />
      <ListRow
        icon="business-outline"
        subtitle={area || undefined}
        title={hostel?.name ?? "Your hostel"}
      />
      <RowDivider inset />
      <ListRow icon="calendar-outline" subtitle="Moved in" title={formatDate(moveInDate)} />
    </Card>
  );
}

function NightStatusCard({ status }: { status: NightStatus }) {
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="label">Night status</Text>
        <StatusPill status={status.status} />
      </View>
      <Text variant="caption">
        {status.checkedAt
          ? `Last checked ${formatRelativeDay(status.checkedAt)}`
          : "You have not been checked in tonight."}
      </Text>
      {status.note ? <Text variant="muted">{status.note}</Text> : null}
    </Card>
  );
}

function TodaysMenuCard({ meals }: { meals: RoutineMeal[] }) {
  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/(resident)/food")}
          >
            <Text className="text-primary" variant="label">
              All meals
            </Text>
          </Pressable>
        }
        subtitle="From this week's routine"
        title="Today's food"
      />

      <Card>
        {meals.length === 0 ? (
          <Text variant="muted">No menu published for today yet.</Text>
        ) : (
          meals.map((meal, index) => (
            <View key={meal.mealType}>
              {index > 0 ? <RowDivider inset /> : null}
              <ListRow
                icon={MEAL_ICONS[meal.mealType] ?? "restaurant-outline"}
                subtitle={meal.items.join(", ") || "Not set"}
                title={humanizeEnum(meal.mealType)}
                value={meal.timing || undefined}
              />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

function NoticesCard({ notices }: { notices: ResidentDashboard["notices"] }) {
  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/(resident)/notices")}
          >
            <Text className="text-primary" variant="label">
              See all
            </Text>
          </Pressable>
        }
        title="Latest notices"
      />

      <Card>
        {notices.length === 0 ? (
          <Text variant="muted">Nothing from your hostel right now.</Text>
        ) : (
          notices.slice(0, 3).map((notice, index) => (
            <View key={notice.id}>
              {index > 0 ? <RowDivider /> : null}
              <ListRow
                onPress={() => router.push("/(resident)/notices")}
                right={notice.isUrgent ? <Badge label="Urgent" tone="danger" /> : undefined}
                subtitle={`${humanizeEnum(notice.category)} · ${formatRelativeDay(
                  notice.publishedAt,
                )}`}
                title={notice.title}
              />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

function QuickActions() {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row gap-3">
      {QUICK_ACTIONS.map((action) => (
        <Pressable
          accessibilityRole="button"
          className="flex-1 items-center gap-2 rounded-2xl border border-border bg-card py-4 active:opacity-70"
          key={action.href}
          onPress={() => router.push(action.href)}
        >
          <Ionicons color={colors.primary} name={action.icon} size={22} />
          <Text variant="caption">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
