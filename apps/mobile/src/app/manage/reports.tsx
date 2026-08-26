import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip, StatTile } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import {
  type AttendanceAnalytics,
  type CountMap,
  type FoodAnalytics,
  getAttendanceAnalytics,
  getFoodAnalytics,
  getReportsOverview,
  REPORT_EXPORTS,
  type ReportExport,
  type ReportsOverview,
} from "@/lib/admin-manage-api";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import { formatDate, formatMoney, formatPeriod, humanizeEnum } from "@/lib/format";
import { toastError } from "@/lib/toast";

/**
 * Reports — the whole portal page, minus its tables.
 *
 * ## One request, not seven
 *
 * `reports/overview` returns payments, complaints, maintenance, occupancy, food,
 * inquiries, referrals, night status and public visibility together. The six
 * narrower `reports/*` routes are cuts of the same numbers for other screens, so
 * calling them here would be six requests for figures already in hand. Only the
 * two analytics panels are separate, because they are windowed (`?days=`) and
 * the overview is not.
 *
 * ## What a phone does with a report
 *
 * The web draws a bar chart, three breakdown lists and a seven-column ledger
 * table. A phone gets the same *facts* in the shapes it can actually render: a
 * meter for every rate, a compact month strip for the trend, and breakdowns as
 * chips. The ledger table becomes the five most recent entries as rows — the
 * whole thing is what the CSV export is for, and that button is at the top.
 *
 * ## Exports are aggregates
 *
 * The four CSVs carry no resident phone number and no address. Worth saying
 * where somebody might otherwise assume the opposite, because they are shared
 * out of the app through the OS share sheet — into mail, into Drive, into
 * whatever is installed.
 *
 * ## Attendance can say when, never where
 *
 * The attendance panel is built from zone rows. Coordinates are discarded as
 * each ping lands and a test enforces it, so "outside on eleven nights" is
 * sayable and "outside *at* somewhere" is not, by construction.
 */

type Tab = "money" | "operations" | "growth";

function rateTone(rate: number): "danger" | "success" | "warning" {
  if (rate >= 85) {
    return "success";
  }

  return rate >= 60 ? "warning" : "danger";
}

/** `1110` → `18:30`. The analytics service reports minutes since midnight. */
function clockTime(minutes: number | null) {
  if (minutes === null) {
    return "—";
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function delayLabel(minutes: number | null) {
  if (minutes === null) {
    return "No timing set";
  }

  if (minutes === 0) {
    return "On time";
  }

  return minutes > 0 ? `${minutes} min late` : `${Math.abs(minutes)} min early`;
}

function Breakdown({ empty, map }: { empty: string; map: CountMap }) {
  const entries = Object.entries(map).filter(([, count]) => count > 0);

  if (entries.length === 0) {
    return <Text variant="muted">{empty}</Text>;
  }

  return (
    <View className="flex-row flex-wrap gap-2">
      {entries.map(([key, count]) => (
        <Chip key={key} label={`${humanizeEnum(key)} · ${count}`} />
      ))}
    </View>
  );
}

/**
 * Billed against collected, one column per month.
 *
 * Deliberately not a charting library. Twelve pairs of bars is a layout, not a
 * visualisation problem, and every chart package for React Native brings either
 * SVG or a native module for what `View`s with a percentage height already do.
 */
function CollectionStrip({ points }: { points: ReportsOverview["payments"]["monthly"] }) {
  const peak = Math.max(1, ...points.map((point) => Math.max(point.due, point.collected)));

  if (points.length === 0) {
    return <Text variant="muted">No billing history yet.</Text>;
  }

  return (
    <ScrollView contentContainerClassName="gap-3 pr-2" horizontal showsHorizontalScrollIndicator={false}>
      {points.map((point) => (
        <View className="items-center gap-1.5" key={point.month}>
          <View className="h-24 flex-row items-end gap-1">
            <View
              className="w-3 rounded-t bg-muted-foreground/40"
              style={{ height: `${Math.max(2, (point.due / peak) * 100)}%` }}
            />
            <View
              className="w-3 rounded-t bg-primary"
              style={{ height: `${Math.max(2, (point.collected / peak) * 100)}%` }}
            />
          </View>
          <Text className="text-[10px]" variant="caption">
            {point.month.slice(5)}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

type ReportsData = {
  attendance: AttendanceAnalytics | null;
  food: FoodAnalytics | null;
  overview: ReportsOverview | null;
};

async function loadReports(month: string): Promise<ReportsData> {
  const [overview, attendance, food] = await Promise.all([
    getReportsOverview(month).catch(() => null),
    getAttendanceAnalytics(30).catch(() => null),
    // `reports/food` wants `manageFood`, while the other two only want staff —
    // so this is the one a warden most often cannot see, and it fails alone.
    getFoodAnalytics(30).catch(() => null),
  ]);

  return { attendance, food, overview };
}

export default function ManageReportsScreen() {
  const [month, setMonth] = useState("");
  const [tab, setTab] = useState<Tab>("money");
  const [exporting, setExporting] = useState<ReportExport | "">("");

  const reports = useResource<ReportsData>(
    useCallback(() => loadReports(month), [month]),
  );

  const overview = reports.data?.overview ?? null;
  const months = useMemo(() => [...(overview?.months ?? [])].reverse(), [overview]);

  const exportCsv = useCallback(async (report: ReportExport) => {
    setExporting(report);

    try {
      /*
       * A download, not a share. These four are spreadsheets an owner keeps and
       * hands to an accountant, and being asked "share to…" after pressing
       * Export re-opens a decision they already made. `downloadToDevice` reports
       * into the global toaster and the notification shade on its own, so
       * `exporting` is now only here to stop a second tap.
       */
      await downloadToDevice({
        extension: "csv",
        fileName: `${report}-report`,
        label: `${humanizeEnum(report)} report`,
        mimeType: "text/csv",
        url: `${API_BASE_URL}/api/v1/hostel-admin/reports/export?report=${report}`,
      });
    } catch (error) {
      toastError("Could not export", readApiError(error, "The export did not download."));
    } finally {
      setExporting("");
    }
  }, []);

  if (reports.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Reports" />}>
        <LoadingState label="Counting everything" />
      </Screen>
    );
  }

  if (reports.error || !overview) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Reports" />}>
        <ErrorState
          message={reports.error ?? "Reports could not be loaded."}
          onRetry={reports.reload}
        />
      </Screen>
    );
  }

  const { complaints, food, inquiries, maintenance, occupancy, payments, referrals, visibility } =
    overview;
  const selected = payments.selectedMonth;
  const attendance = reports.data?.attendance ?? null;
  const foodTiming = reports.data?.food ?? null;

  return (
    <Screen
      header={
        <AppBar
          accent
          centerTitle
          showBack
          subtitle={`As of ${formatDate(overview.generatedAt)}`}
          title="Reports"
        />
      }
      onRefresh={reports.refresh}
      refreshing={reports.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {/*
          The four headline figures sit above the tabs rather than inside one:
          they are the answer to "how is the hostel doing", which is the question
          somebody opened this screen with, and burying them one tap deep would
          make the first thing on screen a tab bar.
        */}
        <View className="gap-3">
          <View className="flex-row gap-3">
            <StatTile
              icon="bed-outline"
              label="Occupancy"
              tone={rateTone(occupancy.occupancyRate)}
              trend={`${occupancy.occupiedBeds} of ${occupancy.totalBeds} beds`}
              value={`${occupancy.occupancyRate}%`}
            />
            <StatTile
              icon="trending-up-outline"
              label="Collected"
              tone={rateTone(payments.collectionRate)}
              trend={`${formatMoney(payments.totalPaid)} of ${formatMoney(payments.totalDue)}`}
              value={`${payments.collectionRate}%`}
            />
          </View>
          <View className="flex-row gap-3">
            <StatTile
              icon="cash-outline"
              label="Outstanding"
              tone={payments.outstanding > 0 ? "warning" : "success"}
              trend={`${payments.pendingProofs} proof(s) to check`}
              value={formatMoney(payments.outstanding)}
            />
            <StatTile
              icon="alert-circle-outline"
              label="Open issues"
              tone={complaints.slaBreached > 0 ? "danger" : "neutral"}
              trend={`${complaints.open} complaint(s), ${maintenance.open} repair(s)`}
              value={String(complaints.open + maintenance.open)}
            />
          </View>
        </View>

        <View>
          <SectionHeader
            subtitle="Aggregates only — no names, phone numbers or addresses"
            title="Export"
          />
          <ScrollView contentContainerClassName="gap-2 pr-4" horizontal showsHorizontalScrollIndicator={false}>
            {REPORT_EXPORTS.map((entry) => (
              <Button
                key={entry.report}
                label={entry.label}
                loading={exporting === entry.report}
                onPress={() => void exportCsv(entry.report)}
                size="sm"
                variant="outline"
              />
            ))}
          </ScrollView>
        </View>

        <Segmented
          onChange={setTab}
          options={[
            { label: "Money", value: "money" },
            { label: "Operations", value: "operations" },
            { label: "Growth", value: "growth" },
          ]}
          value={tab}
        />

        {/* ---------------------------------------------------------------- */}
        {tab === "money" ? (
          <View className="gap-5">
            <View>
              <SectionHeader
                action={
                  months.length > 0 ? (
                    <Text variant="caption">{formatPeriod(selected.month)}</Text>
                  ) : undefined
                }
                subtitle="Billed against collected, month by month"
                title="Collection"
              />
              <Card className="gap-4">
                <CollectionStrip points={payments.monthly} />

                <View className="flex-row items-center gap-3">
                  <Chip label="Billed" />
                  <Chip label="Collected" tone="brand" />
                </View>

                <View className="gap-2 border-t border-border pt-3">
                  <View className="flex-row items-center justify-between">
                    <Text variant="label">This month billed</Text>
                    <Money value={selected.totalDue} />
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text variant="label">Collected</Text>
                    <Money value={selected.totalPaid} />
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text variant="label">Still owed</Text>
                    <Money owed value={selected.outstanding} />
                  </View>
                  <Meter
                    label={`${selected.collectionRate}% collected`}
                    percent={selected.collectionRate}
                  />
                </View>
              </Card>
            </View>

            {months.length > 1 ? (
              <View>
                <SectionHeader subtitle="Report on an earlier billing month" title="Month" />
                <ScrollView
                  contentContainerClassName="gap-2 pr-4"
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  <Chip
                    label="Latest"
                    onPress={() => setMonth("")}
                    tone={month === "" ? "brand" : "neutral"}
                  />
                  {months.map((option) => (
                    <Chip
                      key={option}
                      label={formatPeriod(option)}
                      onPress={() => setMonth(option)}
                      tone={month === option ? "brand" : "neutral"}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View>
              <SectionHeader title="How people pay" />
              <Card className="gap-3">
                <View className="gap-2">
                  <Text variant="label">By status</Text>
                  <Breakdown empty="No payment records yet." map={payments.byStatus} />
                </View>
                <View className="gap-2 border-t border-border pt-3">
                  <Text variant="label">By method</Text>
                  <Breakdown empty="No method recorded yet." map={payments.byMethod} />
                </View>
              </Card>
            </View>

            <View>
              <SectionHeader
                subtitle="The last few entries in the ledger"
                title="Recent payments"
              />
              <Card className="gap-3">
                {payments.recent.length === 0 ? (
                  <Text variant="muted">No payments recorded yet.</Text>
                ) : (
                  payments.recent.slice(0, 6).map((row, index, rows) => (
                    <View
                      /*
                       * The divider is drawn per row and skipped on the last —
                       * NativeWind compiles a class list at bundle time and has
                       * no `last:` variant, so a `last:border-b-0` here would
                       * silently resolve to nothing and leave a hairline under
                       * the final row.
                       */
                      className={`flex-row items-center justify-between gap-3 ${
                        index === rows.length - 1 ? "" : "border-b border-border pb-3"
                      }`}
                      key={row.id}
                    >
                      <View className="flex-1">
                        <Text numberOfLines={1} variant="label">
                          {row.residentName}
                        </Text>
                        <Text variant="caption">
                          {`${formatPeriod(row.month)} · ${row.roomType || "—"}${row.method ? ` · ${humanizeEnum(row.method)}` : ""}`}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Money value={row.paidAmount} />
                        <Badge
                          label={humanizeEnum(row.status)}
                          tone={row.status === "PAID" ? "success" : "warning"}
                        />
                      </View>
                    </View>
                  ))
                )}
              </Card>
            </View>
          </View>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {tab === "operations" ? (
          <View className="gap-5">
            <View>
              <SectionHeader
                subtitle={
                  complaints.averageResolutionDays === null
                    ? "Nothing resolved yet"
                    : `Resolved in ${complaints.averageResolutionDays} day(s) on average`
                }
                title="Complaints"
              />
              <Card className="gap-3">
                <View className="flex-row gap-3">
                  <StatTile
                    icon="chatbox-ellipses-outline"
                    label="Open"
                    tone={complaints.open > 0 ? "warning" : "success"}
                    value={String(complaints.open)}
                  />
                  <StatTile
                    icon="checkmark-done-outline"
                    label="Resolved"
                    tone="success"
                    value={String(complaints.resolved)}
                  />
                  <StatTile
                    icon="time-outline"
                    label="Past SLA"
                    tone={complaints.slaBreached > 0 ? "danger" : "neutral"}
                    value={String(complaints.slaBreached)}
                  />
                </View>
                <Breakdown empty="Nothing raised yet." map={complaints.byCategory} />
              </Card>
            </View>

            <View>
              <SectionHeader title="Maintenance" />
              <Card className="gap-3">
                <View className="flex-row gap-3">
                  <StatTile
                    icon="construct-outline"
                    label="Open"
                    tone={maintenance.open > 0 ? "warning" : "success"}
                    value={String(maintenance.open)}
                  />
                  <StatTile
                    icon="checkmark-circle-outline"
                    label="Completed"
                    tone="success"
                    value={String(maintenance.completed)}
                  />
                  <StatTile
                    icon="list-outline"
                    label="All time"
                    value={String(maintenance.total)}
                  />
                </View>
                <Breakdown empty="No repairs logged." map={maintenance.byCategory} />
              </Card>
            </View>

            <View>
              <SectionHeader
                subtitle={
                  attendance
                    ? `Last ${attendance.summary.windowDays} days · ${attendance.summary.pings} check-in(s)`
                    : "Not available"
                }
                title="Roll call"
              />
              <Card className="gap-3">
                {attendance === null ? (
                  <Text variant="muted">
                    This account cannot read attendance analytics.
                  </Text>
                ) : (
                  <>
                    <Meter
                      label={`${Math.round(attendance.summary.averageAttendanceRate * 100)}% accounted for`}
                      percent={attendance.summary.averageAttendanceRate * 100}
                    />
                    <Breakdown
                      empty="No check-ins in the window."
                      map={attendance.summary.zones}
                    />
                    <Text variant="caption">
                      Zones only. A check-in records inside, nearby or outside — the
                      coordinates are discarded as it lands, so this can say when
                      somebody was away and never where they were.
                    </Text>

                    {attendance.frequentlyAbsent.length > 0 ? (
                      <View className="gap-2 border-t border-border pt-3">
                        <Text variant="label">Most often away</Text>
                        {attendance.frequentlyAbsent.slice(0, 5).map((resident) => (
                          <View
                            className="flex-row items-center justify-between gap-3"
                            key={resident.residentId}
                          >
                            <View className="flex-1">
                              <Text numberOfLines={1}>{resident.name}</Text>
                              <Text variant="caption">
                                {`${resident.outside} away of ${resident.total} night(s)`}
                              </Text>
                            </View>
                            <Badge
                              label={`${Math.round(resident.attendanceRate * 100)}%`}
                              tone={resident.attendanceRate < 0.5 ? "warning" : "neutral"}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </>
                )}
              </Card>
            </View>

            <View>
              <SectionHeader
                subtitle={
                  food.averageRating === null
                    ? "No feedback yet"
                    : `${food.averageRating.toFixed(1)} ★ from ${food.feedbackCount} rating(s)`
                }
                title="Food"
              />
              <Card className="gap-3">
                {foodTiming === null ? (
                  <Text variant="muted">
                    Meal-timing analytics need the food permission, which this account
                    does not have.
                  </Text>
                ) : (
                  <>
                    <View className="flex-row gap-3">
                      <StatTile
                        icon="notifications-outline"
                        label="Announced"
                        value={String(foodTiming.summary.totalAnnouncements)}
                      />
                      <StatTile
                        icon="checkmark-circle-outline"
                        label="On time"
                        tone="success"
                        value={String(foodTiming.summary.onTimeAnnouncements)}
                      />
                      <StatTile
                        icon="time-outline"
                        label="Late"
                        tone={foodTiming.summary.lateAnnouncements > 0 ? "warning" : "neutral"}
                        value={String(foodTiming.summary.lateAnnouncements)}
                      />
                    </View>

                    {foodTiming.byMeal.map((meal) => (
                      <View
                        className="flex-row items-center justify-between gap-3"
                        key={meal.mealType}
                      >
                        <View className="flex-1">
                          <Text variant="label">{humanizeEnum(meal.mealType)}</Text>
                          <Text variant="caption">
                            {`Usually ready ${clockTime(meal.averageReadyMinutes)}${meal.scheduledTiming ? ` · scheduled ${meal.scheduledTiming}` : ""}`}
                          </Text>
                        </View>
                        <Badge
                          label={delayLabel(meal.averageDelayMinutes)}
                          tone={
                            meal.averageDelayMinutes === null
                              ? "neutral"
                              : meal.averageDelayMinutes > 10
                                ? "warning"
                                : "success"
                          }
                        />
                      </View>
                    ))}
                  </>
                )}
              </Card>
            </View>
          </View>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {tab === "growth" ? (
          <View className="gap-5">
            <View>
              <SectionHeader
                subtitle={`${inquiries.converted} of ${inquiries.total} became residents`}
                title="Inquiries"
              />
              <Card className="gap-3">
                <Meter
                  label={`${Math.round(inquiries.conversionRate)}% converted`}
                  percent={inquiries.conversionRate}
                />
                <Breakdown empty="No inquiries yet." map={inquiries.byStatus} />
              </Card>
            </View>

            <View>
              <SectionHeader
                subtitle="How often the public listing is opened"
                title="Visibility"
              />
              <Card>
                <View className="flex-row gap-3">
                  <StatTile
                    icon="eye-outline"
                    label="30 days"
                    value={String(visibility.publicViewsLast30Days)}
                  />
                  <StatTile
                    icon="people-outline"
                    label="Visitors"
                    value={String(visibility.uniquePublicVisitors)}
                  />
                  <StatTile
                    icon="albums-outline"
                    label="All time"
                    value={String(visibility.totalPublicViews)}
                  />
                </View>
              </Card>
            </View>

            <View>
              <SectionHeader
                subtitle={`${referrals.joined} of ${referrals.total} referrals joined`}
                title="Referrals"
              />
              <Card className="gap-3">
                <View className="flex-row items-center justify-between">
                  <Text variant="label">Rewards promised</Text>
                  <Money value={referrals.rewardTotalAmount} />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="label">Approved</Text>
                  <Money value={referrals.rewardApprovedAmount} />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="label">Paid out</Text>
                  <Money value={referrals.rewardPaidAmount} />
                </View>
                <Breakdown empty="Nobody has referred anyone yet." map={referrals.byStatus} />
              </Card>
            </View>

            <View>
              <SectionHeader subtitle="Where residents are tonight" title="Roll call now" />
              <Card>
                <Breakdown empty="Nothing recorded tonight." map={overview.nightStatus} />
              </Card>
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
