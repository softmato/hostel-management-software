import { router } from "expo-router";
import { PartyPopper, Percent, Tag } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Sheet, SheetRow } from "@/components/ui/sheet";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  type ConcessionBackfill,
  deleteRentConcession,
  type RentConcession,
  saveRentConcession,
} from "@/lib/admin-manage-api";
import { type AdminFinanceData, adminQuery } from "@/lib/admin-queries";
import { readApiError } from "@/lib/api-contract";
import { openConfirm } from "@/lib/confirm";
import { formatMoney, nepalPeriodKey } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { addBsMonths } from "@hostel/calendar/bs";

/**
 * Festival discounts — a month at reduced rent, on top of the rates.
 *
 * ## It is not a second rate card, and the screen has to make that obvious
 *
 * A hostel taking half fee in Dashain has not changed what a bed costs. Said
 * through `finance/rates` it would take three cards to express one festival —
 * Aswin at the real rents, Kartik at half, Mangsir back again — and the real
 * rents would then live in two rows that agree only by accident. So this screen
 * never shows a rupee figure: it shows a month, a percentage and a word, and the
 * rents stay where an owner already knows to look for them.
 *
 * ## The month is a picker, the percentage is typed, and both have a shortcut
 *
 * `Select` rather than the `YYYY-MM-DD` box `finance/rates` uses, because the
 * thing being named here is a **Bikram Sambat month** and nothing else — there is
 * no day to pick, and asking an owner who means Kartik to work out which
 * Gregorian fortnight that is was the defect the web picker was rewritten to
 * remove. The chips under the percentage are the three answers hostels actually
 * give; the box is there for the fourth.
 *
 * ## A row already billed is labelled, not hidden
 *
 * Those months' invoices carry the amount and the words they were issued with,
 * so a discount set on one changes no money. Refusing the save would be a screen
 * saying no for a reason nobody can check; the badge says the month is done.
 *
 * ## Editing is saving the same month again
 *
 * There is one discount per month by index, so a row's **Change** simply seeds
 * the form with it — no second endpoint, no draft state, and no way to end up
 * with two answers for one Kartik.
 */

/** How far ahead and behind the month picker reaches. Two years of choices. */
const MONTHS_AHEAD = 12;
const MONTHS_BACK = 12;

/** The three a hostel actually announces. The box takes anything else. */
const QUICK_PERCENTS = [25, 50, 100];

/**
 * What happened to bills that had already gone out, as a toast's second line.
 *
 * Empty when nothing was billed yet, which is the ordinary case and the healthy
 * one: the discount was set before the month's run, so the run will charge the
 * reduced rent directly and there was nothing to correct. A line reading "0 bills
 * changed" would make that look like a failure.
 *
 * `invoicesKept` is spoken whenever it is non-zero, because it is the one outcome
 * an owner would otherwise be surprised by — a bill with money already settled
 * against it keeps its discount instead of going back up.
 */
function appliedNote(applied: ConcessionBackfill, verb: "reduced" | "restored") {
  const parts: string[] = [];

  if (applied.invoicesChanged > 0) {
    parts.push(
      `${applied.invoicesChanged} ${applied.invoicesChanged === 1 ? "bill" : "bills"} already sent out ${verb === "reduced" ? "reduced" : "back to full rent"}.`,
    );
  }

  if (applied.refundedAsCredit > 0) {
    parts.push(`${formatMoney(applied.refundedAsCredit)} became credit for next month.`);
  }

  if (applied.invoicesKept > 0) {
    parts.push(
      `${applied.invoicesKept} ${applied.invoicesKept === 1 ? "bill keeps its" : "bills keep their"} discount — already part paid.`,
    );
  }

  return parts.join(" ");
}

export default function ManageMonthDiscountsScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();

  /*
   * The finance screen's own read, not a key of its own.
   *
   * `finance/index` already loads the discounts to draw its summary rows, and a
   * separate key here would mean the list arriving twice on the way in and the
   * summary going stale on the way out. One key, revalidated on refocus, and a
   * save shows up on both screens with nothing wired between them.
   */
  const query = adminQuery.finance();
  const finance = useResource<AdminFinanceData>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const concessions = finance.data?.concessions ?? null;

  const [busy, setBusy] = useState<"delete" | "save" | null>(null);
  const [period, setPeriod] = useState(() => addBsMonths(nepalPeriodKey(), 1));
  const [percentOff, setPercentOff] = useState("");
  const [reason, setReason] = useState("");
  /** The row whose sheet is open. Null is "no sheet". */
  const [acting, setActing] = useState<RentConcession | null>(null);

  const months = useMemo(() => {
    const now = nepalPeriodKey();

    return Array.from(
      { length: MONTHS_AHEAD + MONTHS_BACK + 1 },
      (_, offset) => addBsMonths(now, MONTHS_AHEAD - offset),
    ).map((value) => ({
      /*
       * Both calendars, from the shared formatter the rest of the app reads
       * months through. A picker that said only "Kartik" would be the one place
       * in the product an owner could not cross-check against a Gregorian date.
       */
      description: dates.periodYear(value),
      label: dates.periodMonth(value),
      value,
    }));
  }, [dates]);

  /** The discount already on the month in the picker, if any. */
  const existing = useMemo(
    () => (concessions ?? []).find((row) => row.period === period) ?? null,
    [concessions, period],
  );

  const save = useCallback(async () => {
    const percent = Number(percentOff.trim());

    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      toastError("Check the percentage", "A whole number from 1 to 100.");
      return;
    }

    setBusy("save");

    try {
      const saved = await saveRentConcession({
        percentOff: percent,
        period,
        reason: reason.trim() || undefined,
      });
      toastSuccess(
        `${dates.periodMonth(period)} is ${percent}% off`,
        appliedNote(saved.applied, "reduced") ||
          "The billing run will charge the reduced rent.",
      );
      router.back();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(null);
    }
  }, [dates, percentOff, period, reason]);

  /** Loads a row into the form. The save then replaces that same month. */
  const edit = useCallback((row: RentConcession) => {
    setActing(null);
    setPeriod(row.period);
    setPercentOff(String(row.percentOff));
    setReason(row.reason ?? "");
  }, []);

  const remove = useCallback(
    (row: RentConcession) => {
      setActing(null);
      openConfirm({
        confirmLabel: "Charge full rent",
        destructive: true,
        message: `${row.label} goes back to the rates on your rate card. Bills nobody has paid yet go back up; any bill with money already against it keeps its discount.`,
        onConfirm: async () => {
          setBusy("delete");

          try {
            const removed = await deleteRentConcession(row._id);
            toastSuccess(
              `${row.label} is back to full rent`,
              appliedNote(removed.restored, "restored") || undefined,
            );
            await finance.reload();
          } catch (error) {
            toastError("Could not remove it", readApiError(error));
          } finally {
            setBusy(null);
          }
        },
        title: `Remove the ${row.label} discount?`,
      });
    },
    [finance],
  );

  const header = (
    <AppBar
      accent
      centerTitle
      showBack
      subtitle="One month at reduced rent"
      title="Festival discounts"
    />
  );

  if (finance.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Reading your discounts" />
      </Screen>
    );
  }

  if (finance.error) {
    return (
      <Screen header={header}>
        <ErrorState message={finance.error} onRetry={finance.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          disabled={busy === "delete"}
          label={existing ? "Replace this month" : "Save discount"}
          loading={busy === "save"}
          onPress={() => void save()}
        />
      }
      header={header}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader subtitle="Off every resident's rent" title="The month" />
          <Card className="gap-3">
            {/*
              No glyph on this one. `Select`'s mark slot is per *option*, so a
              calendar here would be twenty-five identical calendars in the sheet
              — and the trigger already says it opens something with a chevron.
            */}
            <Select
              label="Month"
              onChange={setPeriod}
              options={months}
              sheetTitle="Which month?"
              value={period}
            />
            <Input
              /*
               * The rate card is never touched by this, and the hint is where an
               * owner finds that out — beside the number, not in a paragraph at
               * the top of the screen they have already scrolled past.
               */
              hint="50 charges half rent. Your rates do not change."
              keyboardType="number-pad"
              label="Off the rent"
              leading={<Percent color={colors.mutedForeground} size={18} />}
              onChangeText={setPercentOff}
              placeholder="%"
              value={percentOff}
            />
            <View className="flex-row flex-wrap gap-2">
              {QUICK_PERCENTS.map((value) => (
                <Chip
                  key={value}
                  label={value === 100 ? "Free month" : `${value}% off`}
                  onPress={() => setPercentOff(String(value))}
                />
              ))}
            </View>
            <Input
              hint="Printed on the resident's bill beside the amount."
              label="Reason"
              leading={<Tag color={colors.mutedForeground} size={18} />}
              onChangeText={setReason}
              placeholder="Dashain"
              value={reason}
            />
            {existing ? (
              <Text variant="caption">
                {`${existing.label} is already ${existing.percentOff}% off. Saving replaces that.`}
              </Text>
            ) : null}
          </Card>
        </View>

        <View>
          <SectionHeader title="Discounted months" />
          {concessions === null || concessions.length === 0 ? (
            <Card className="gap-2">
              <View className="flex-row items-center gap-2">
                <PartyPopper color={colors.mutedForeground} size={18} />
                <Text variant="label">No month is discounted</Text>
              </View>
              <Text variant="caption">
                Every month is charged at the rates on your rate card.
              </Text>
            </Card>
          ) : (
            <Card padding="px-4 py-1">
              {concessions.map((row, index) => (
                <View key={row._id}>
                  {index > 0 ? <RowDivider inset /> : null}
                  <ListRow
                    onPress={() => setActing(row)}
                    right={
                      <Badge
                        label={
                          row.standing === "past"
                            ? "Billed"
                            : row.standing === "current"
                              ? "This month"
                              : "Upcoming"
                        }
                        tone={
                          row.standing === "past"
                            ? "neutral"
                            : row.standing === "current"
                              ? "success"
                              : "warning"
                        }
                      />
                    }
                    subtitle={row.reason ?? undefined}
                    title={`${row.label} · ${row.percentOff}% off`}
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      </View>

      {/*
        Two actions on one row, so a sheet — an anchored menu is not the vocabulary
        this app uses, and a row that did one of the two on tap would do the wrong
        one half the time.
      */}
      <Sheet
        onClose={() => setActing(null)}
        open={acting !== null}
        title={acting?.label ?? ""}
      >
        {acting ? (
          <View className="gap-1">
            <SheetRow
              label="Change this month"
              onPress={() => edit(acting)}
              subtitle={`Currently ${acting.percentOff}% off`}
            />
            <SheetRow
              label="Charge full rent again"
              onPress={() => remove(acting)}
              subtitle={
                acting.standing === "past"
                  ? "That month is billed — its bills do not change"
                  : undefined
              }
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
