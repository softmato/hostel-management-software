import { useCallback, useMemo } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Card } from "@/components/ui/card";
import { FactRow } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyCard, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  BED_TYPE_LABELS,
  type BedType,
  type FeeSchedule,
  listFeeSchedules,
} from "@/lib/admin-manage-api";
import { humanizeEnum } from "@/lib/format";

/**
 * Past schedules — every set of rates that has stopped, newest first.
 *
 * This was a card sitting under the live rates on the Finance screen, which put
 * last year's prices between an owner and this month's. It is kept because rates
 * are never edited — a closed schedule is how an invoice issued under it can be
 * explained — but that is a question asked rarely, so it is one tap away instead
 * of always on screen.
 *
 * Grouped the way the reference apps group a statement: the date range is the
 * heading **outside** the card, the numbers are the card.
 */

export default function ManageRateHistoryScreen() {
  const dates = useDates();
  const schedules = useResource<FeeSchedule[]>(
    useCallback(() => listFeeSchedules(), []),
  );

  const past = useMemo(
    () =>
      (schedules.data ?? [])
        .filter((schedule) => schedule.effectiveTo !== null)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [schedules.data],
  );

  const header = <AppBar accent centerTitle showBack title="Past schedules" />;

  if (schedules.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Reading past rates" />
      </Screen>
    );
  }

  if (schedules.error) {
    return (
      <Screen header={header}>
        <ErrorState message={schedules.error} onRetry={schedules.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      onRefresh={schedules.refresh}
      refreshing={schedules.refreshing}
      scroll
    >
      {past.length === 0 ? (
        <EmptyCard
          description="Rates you replace are kept here so older invoices still add up."
          title="No past rates yet"
        />
      ) : (
        <View className="gap-4 pt-1">
          {past.map((schedule) => (
            <View className="gap-2" key={schedule._id}>
              <Text variant="subtitle">
                {`${dates.date(schedule.effectiveFrom)} – ${dates.date(schedule.effectiveTo)}`}
              </Text>

              <Card className="gap-1">
                {schedule.rates.map((rate) => (
                  <FactRow
                    key={rate.bedType}
                    label={
                      BED_TYPE_LABELS[rate.bedType as BedType] ?? humanizeEnum(rate.bedType)
                    }
                    value={<Money value={rate.monthlyAmount} />}
                  />
                ))}
                {schedule.admissionFee ? (
                  <FactRow label="Admission" value={<Money value={schedule.admissionFee} />} />
                ) : null}
                {schedule.depositAmount ? (
                  <FactRow label="Deposit" value={<Money value={schedule.depositAmount} />} />
                ) : null}
              </Card>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
