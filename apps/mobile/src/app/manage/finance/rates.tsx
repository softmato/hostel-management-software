import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import {
  BED_TYPE_LABELS,
  BED_TYPES,
  type BedType,
  closeFeeSchedule,
  createFeeSchedule,
  type FeeSchedule,
  listFeeSchedules,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDate } from "@/lib/format";
import { dayInputFromNow, startOfDayIso } from "@/lib/manage-dates";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Set the rates — the form that used to be a bottom sheet on the Finance screen.
 *
 * ## Rates are never edited, and that is why this screen exists
 *
 * There is no PUT. Saving opens a **new** schedule and closes the current one
 * the day before the new rates start, so an invoice issued last March can still
 * be explained rather than merely trusted. The old card stays readable under
 * *Past schedules*.
 *
 * The overview screen used to print that paragraph next to the numbers. It now
 * lives here, next to the date field it actually governs — one sentence under
 * "Effective from" instead of a rule an owner has to read before they can find
 * out what a single bed costs.
 *
 * ## A blank bed type is not free, it is unpriced
 *
 * Leaving a field empty does not charge nothing — it prices nobody, and every
 * resident on that bed type **fails** the next billing run instead of being
 * charged a fallback. That is deliberate (it is the defect this design removed:
 * a misconfigured resident billed a number no human chose), so the hint says so
 * where the fields are rather than after the failure.
 *
 * ## Stopping the rates lives here, not on the overview
 *
 * "Close this card" sat under the rates on the Finance screen, one tap from a
 * state where nothing is priced and the next run fails everybody. It is a rare,
 * destructive action, so it is at the bottom of the screen that owns rates,
 * behind a confirm — not beside the numbers an owner opens Finance to read.
 */

export default function ManageRatesScreen() {
  const [busy, setBusy] = useState(false);
  const [ratesDraft, setRatesDraft] = useState<Record<string, string> | null>(null);
  const [formDraft, setFormDraft] = useState<Record<string, string> | null>(null);

  const schedules = useResource<FeeSchedule[]>(
    useCallback(() => listFeeSchedules(), []),
  );

  const open = useMemo(
    () => (schedules.data ?? []).find((schedule) => schedule.effectiveTo === null) ?? null,
    [schedules.data],
  );

  /*
   * Seeded from the open card, and the draft wins the moment anything is typed.
   *
   * Not `useState(seed)` plus an effect that re-seeds when the read lands: the
   * silent refocus revalidate in `useResource` would fire that effect again and
   * rewrite a half-typed number under the user's thumb, with the keyboard still
   * up. A null draft simply means "nothing typed yet", so a later response can
   * change what is displayed only while that is still true.
   */
  const seededRates = useMemo(() => {
    const next: Record<string, string> = {};

    for (const bedType of BED_TYPES) {
      const rate = open?.rates.find((entry) => entry.bedType === bedType);

      next[bedType] = rate ? String(rate.monthlyAmount) : "";
    }

    return next;
  }, [open]);

  const seededForm = useMemo(
    () => ({
      admissionFee: open?.admissionFee ? String(open.admissionFee) : "",
      depositAmount: open?.depositAmount ? String(open.depositAmount) : "",
      effectiveFrom: dayInputFromNow(1),
      referralAdmissionDiscount: open?.referralAdmissionDiscount
        ? String(open.referralAdmissionDiscount)
        : "",
    }),
    [open],
  );

  const rates = ratesDraft ?? seededRates;
  const form = formDraft ?? seededForm;

  const editRates = useCallback(
    (patch: Record<string, string>) =>
      setRatesDraft((prev) => ({ ...(prev ?? seededRates), ...patch })),
    [seededRates],
  );

  const editForm = useCallback(
    (patch: Record<string, string>) =>
      setFormDraft((prev) => ({ ...(prev ?? seededForm), ...patch })),
    [seededForm],
  );

  const submit = useCallback(async () => {
    const effectiveFrom = startOfDayIso(form.effectiveFrom ?? "");

    if (!effectiveFrom) {
      toastError("Check the start date", "Write it as YYYY-MM-DD.");
      return;
    }

    const priced = BED_TYPES.flatMap((bedType) => {
      const raw = rates[bedType]?.trim();

      if (!raw) {
        return [];
      }

      const monthlyAmount = Number(raw);

      return Number.isInteger(monthlyAmount) && monthlyAmount >= 0
        ? [{ bedType: bedType as BedType, monthlyAmount }]
        : [];
    });

    if (priced.length === 0) {
      toastError("Price at least one bed type", "Otherwise nobody can be billed.");
      return;
    }

    setBusy(true);

    try {
      await createFeeSchedule({
        admissionFee: form.admissionFee?.trim() ? Number(form.admissionFee) : undefined,
        depositAmount: form.depositAmount?.trim() ? Number(form.depositAmount) : undefined,
        effectiveFrom,
        rates: priced,
        referralAdmissionDiscount: form.referralAdmissionDiscount?.trim()
          ? Number(form.referralAdmissionDiscount)
          : undefined,
      });
      toastSuccess("Rates saved");
      router.back();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [form, rates]);

  const stop = useCallback(() => {
    if (!open) {
      return;
    }

    Alert.alert(
      "Stop these rates?",
      "Nothing is priced from today, so the next billing run fails every resident without a personal fee.",
      [
        { style: "cancel", text: "Keep them" },
        {
          onPress: () => {
            void (async () => {
              setBusy(true);

              try {
                await closeFeeSchedule(open._id, startOfDayIso(dayInputFromNow(0)) ?? "");
                toastSuccess("Stopped");
                router.back();
              } catch (error) {
                toastError("Could not stop them", readApiError(error));
              } finally {
                setBusy(false);
              }
            })();
          },
          style: "destructive",
          text: "Stop them",
        },
      ],
    );
  }, [open]);

  if (schedules.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Rates" />}>
        <LoadingState label="Reading your rates" />
      </Screen>
    );
  }

  if (schedules.error) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Rates" />}>
        <ErrorState message={schedules.error} onRetry={schedules.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={<Button label="Save rates" loading={busy} onPress={() => void submit()} />}
      header={
        <AppBar
          accent
          centerTitle
          showBack
          subtitle={open ? `Replaces the rates from ${formatDate(open.effectiveFrom)}` : undefined}
          title={open ? "New rates" : "Set the rates"}
        />
      }
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader subtitle="Per month, per bed" title="Rent" />
          <Card className="gap-3">
            {BED_TYPES.map((bedType) => (
              <Input
                key={bedType}
                keyboardType="number-pad"
                label={BED_TYPE_LABELS[bedType]}
                onChangeText={(value) => editRates({ [bedType]: value })}
                placeholder="NPR"
                value={rates[bedType] ?? ""}
              />
            ))}
            <Text variant="caption">
              Leave one blank and it is not priced — those residents are skipped by the
              billing run rather than charged a guess.
            </Text>
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Charged once, on arrival" title="One-off" />
          <Card className="gap-3">
            <Input
              keyboardType="number-pad"
              label="Admission fee"
              onChangeText={(admissionFee) => editForm({ admissionFee })}
              placeholder="NPR"
              value={form.admissionFee ?? ""}
            />
            <Input
              hint="Comes off the admission fee when someone arrives on a resident's referral code. Never off the rent."
              keyboardType="number-pad"
              label="Referral discount"
              onChangeText={(referralAdmissionDiscount) => editForm({ referralAdmissionDiscount })}
              placeholder="NPR"
              value={form.referralAdmissionDiscount ?? ""}
            />
            <Input
              keyboardType="number-pad"
              label="Deposit"
              onChangeText={(depositAmount) => editForm({ depositAmount })}
              placeholder="NPR"
              value={form.depositAmount ?? ""}
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Effective from" />
          <Card className="gap-3">
            <Input
              keyboardType="numbers-and-punctuation"
              onChangeText={(effectiveFrom) => editForm({ effectiveFrom })}
              placeholder="YYYY-MM-DD"
              value={form.effectiveFrom ?? ""}
            />
            <View className="flex-row flex-wrap gap-2">
              <Chip
                label="Tomorrow"
                onPress={() => editForm({ effectiveFrom: dayInputFromNow(1) })}
              />
              <Chip
                label="Next month"
                onPress={() => editForm({ effectiveFrom: dayInputFromNow(30) })}
              />
            </View>
            {open ? (
              <Text variant="caption">
                The current rates stop the day before, and stay readable under Past
                schedules so old invoices still add up.
              </Text>
            ) : null}
          </Card>
        </View>

        {open ? (
          <Button
            label="Stop charging these rates"
            loading={busy}
            onPress={stop}
            size="sm"
            variant="ghost"
          />
        ) : null}
      </View>
    </Screen>
  );
}
