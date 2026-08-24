import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip, FactRow, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, LoadingState, PermissionCard } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useResource } from "@/hooks/use-resource";
import {
  BED_TYPE_LABELS,
  BED_TYPES,
  type BedType,
  type BillingPeriodSummary,
  closeFeeSchedule,
  createFeeSchedule,
  type FeeSchedule,
  type GatewayConfig,
  GATEWAY_PROVIDERS,
  type GatewayProviderName,
  getBillingPeriod,
  getPaymentProfile,
  listFeeSchedules,
  listGateways,
  type PaymentProfile,
  runBilling,
  saveGateway,
  updatePaymentProfile,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDate, formatMoney, formatPeriod, humanizeEnum } from "@/lib/format";
import { dayInputFromNow, startOfDayIso } from "@/lib/manage-dates";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Finance — the rates, the billing run, and where the money is asked to go.
 *
 * The Money tab is the *ledger*: this month's invoices, the claims waiting on a
 * decision, who has not paid. This screen is everything that decides what those
 * invoices say in the first place, and it is deliberately a separate surface —
 * an owner opens Money daily and this maybe monthly.
 *
 * ## A fee schedule is never edited
 *
 * There is no PUT. Opening a new schedule closes the current one the day before
 * the new one starts, and the old rates stay readable — so an invoice issued
 * last March can be explained rather than merely trusted. The screen therefore
 * offers "new rates from a date", never "change these rates", and the history
 * below is the point rather than clutter.
 *
 * ## The billing run has no amount field
 *
 * Amounts come from the schedule and the per-resident override, and from nowhere
 * else. A resident with no rate for their bed type **fails** into the result's
 * `failures` list rather than being billed a fallback — which is exactly the
 * defect this design removed, where a misconfigured resident got charged a
 * number no human chose. The run is safe to repeat: an already-billed resident
 * is skipped, not double-billed.
 *
 * ## Three capabilities, not one
 *
 * Reading wants `viewPayments`; the schedule and the run want
 * `manageFeeSchedule`; the profile and the gateways want `managePaymentProfile`.
 * They were split apart so the warden who approves payment proofs cannot also
 * change the account the money is asked to go to — so each block below can
 * legitimately be refused while its neighbour loads.
 */

type Panel = "cash" | "gateway" | "profile" | "run" | "schedule" | null;

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentPeriod(now: Date = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

type FinanceData = {
  gateways: GatewayConfig[] | null;
  period: BillingPeriodSummary | null;
  profile: PaymentProfile | null;
  schedules: FeeSchedule[] | null;
};

async function loadFinance(period: string): Promise<FinanceData> {
  const [schedules, periodSummary, profile, gateways] = await Promise.all([
    listFeeSchedules().catch(() => null),
    getBillingPeriod(period).catch(() => null),
    getPaymentProfile().catch(() => null),
    // The one read that needs `managePaymentProfile` rather than `viewPayments`
    // — it lists merchant codes and which keys are installed.
    listGateways().catch(() => null),
  ]);

  return { gateways, period: periodSummary, profile, schedules };
}

export default function ManageFinanceScreen() {
  const [period, setPeriod] = useState(() => currentPeriod());
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});
  const [gateway, setGateway] = useState<GatewayProviderName>("ESEWA");
  const [gatewayForm, setGatewayForm] = useState<Record<string, string>>({});
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [runResult, setRunResult] = useState<
    { billed: number; failures: number; skipped: number; total: number } | null
  >(null);

  const finance = useResource<FinanceData>(
    useCallback(() => loadFinance(period), [period]),
  );

  const schedules = finance.data?.schedules ?? null;
  const profile = finance.data?.profile ?? null;
  const gateways = finance.data?.gateways ?? null;
  const summary = finance.data?.period ?? null;

  const open = useMemo(
    () => (schedules ?? []).find((schedule) => schedule.effectiveTo === null) ?? null,
    [schedules],
  );

  const { reload } = finance;

  const openSchedule = useCallback(() => {
    const next: Record<string, string> = {};

    for (const bedType of BED_TYPES) {
      const rate = open?.rates.find((entry) => entry.bedType === bedType);

      next[bedType] = rate ? String(rate.monthlyAmount) : "";
    }

    setRates(next);
    setForm({
      admissionFee: open?.admissionFee ? String(open.admissionFee) : "",
      depositAmount: open?.depositAmount ? String(open.depositAmount) : "",
      effectiveFrom: dayInputFromNow(1),
    });
    setPanel("schedule");
  }, [open]);

  const submitSchedule = useCallback(async () => {
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
      toastError(
        "Price at least one bed type",
        "An empty card prices nobody, and every resident would fail the next run.",
      );
      return;
    }

    setBusy(true);

    try {
      await createFeeSchedule({
        admissionFee: form.admissionFee?.trim() ? Number(form.admissionFee) : undefined,
        depositAmount: form.depositAmount?.trim() ? Number(form.depositAmount) : undefined,
        effectiveFrom,
        rates: priced,
      });
      toastSuccess("New rates open", "The previous card closed the day before they start.");
      setPanel(null);
      await reload();
    } catch (error) {
      toastError("Could not open it", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [form, rates, reload]);

  const closeCurrent = useCallback(async () => {
    if (!open) {
      return;
    }

    setBusy(true);

    try {
      await closeFeeSchedule(open._id, startOfDayIso(dayInputFromNow(0)) ?? "");
      toastSuccess("Closed", "Nothing is priced from today until a new card opens.");
      await reload();
    } catch (error) {
      toastError("Could not close it", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [open, reload]);

  const bill = useCallback(async () => {
    setBusy(true);
    setRunResult(null);

    try {
      const result = await runBilling({
        dueDate: form.dueDate ? (startOfDayIso(form.dueDate) ?? undefined) : undefined,
        period,
      });

      setRunResult({
        billed: result.billed.length,
        failures: result.failures.length,
        skipped: result.skipped.length,
        total: result.totalBilled,
      });

      if (result.failures.length > 0) {
        toastError(
          `${result.failures.length} could not be billed`,
          result.failures[0]?.message ?? "Check that every bed type has a rate.",
        );
      } else {
        toastSuccess(`Billed ${result.billed.length}`, formatMoney(result.totalBilled));
      }

      await reload();
    } catch (error) {
      toastError("The run did not go through", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [form.dueDate, period, reload]);

  const saveProfile = useCallback(async () => {
    setBusy(true);

    try {
      await updatePaymentProfile({
        bankAccountName: form.bankAccountName?.trim() || undefined,
        bankAccountNumber: form.bankAccountNumber?.trim() || undefined,
        bankName: form.bankName?.trim() || undefined,
        cashApprovalThreshold: form.cashApprovalThreshold?.trim()
          ? Number(form.cashApprovalThreshold)
          : undefined,
        displayName: form.displayName?.trim() || undefined,
        esewaId: form.esewaId?.trim() || undefined,
        khaltiId: form.khaltiId?.trim() || undefined,
        paymentInstructions: form.paymentInstructions?.trim() || undefined,
        qrPayeeName: form.qrPayeeName?.trim() || undefined,
        qrPayeeNumber: form.qrPayeeNumber?.trim() || undefined,
        statementCadenceDays: form.statementCadenceDays?.trim()
          ? Number(form.statementCadenceDays)
          : undefined,
      });
      toastSuccess("Payment setup saved");
      setPanel(null);
      await reload();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [form, reload]);

  const submitGateway = useCallback(async () => {
    setBusy(true);

    try {
      await saveGateway({
        accountKind: (gatewayForm.accountKind as "MERCHANT" | "PERSONAL") ?? "MERCHANT",
        enabled: gatewayEnabled,
        merchantCode: gatewayForm.merchantCode?.trim() || undefined,
        mode: (gatewayForm.mode as "LIVE" | "SANDBOX") ?? "SANDBOX",
        provider: gateway,
        // Omitted rather than sent blank — the server reads an absent secret as
        // "leave the stored one alone" and rejects an empty string outright.
        secret: gatewayForm.secret?.trim() || undefined,
        webhookSecret: gatewayForm.webhookSecret?.trim() || undefined,
      });
      toastSuccess(`${humanizeEnum(gateway)} saved`);
      setPanel(null);
      await reload();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [gateway, gatewayEnabled, gatewayForm, reload]);

  const openGateway = useCallback(
    (provider: GatewayProviderName) => {
      const entry = (gateways ?? []).find((config) => config.provider === provider);

      setGateway(provider);
      setGatewayEnabled(entry?.enabled ?? false);
      setGatewayForm({
        accountKind: entry?.accountKind ?? "MERCHANT",
        merchantCode: entry?.merchantCode ?? "",
        mode: entry?.mode ?? "SANDBOX",
        secret: "",
        webhookSecret: "",
      });
      setPanel("gateway");
    },
    [gateways],
  );

  const openProfile = useCallback(() => {
    setForm({
      bankAccountName: profile?.bankAccountName ?? "",
      bankAccountNumber: profile?.bankAccountNumber ?? "",
      bankName: profile?.bankName ?? "",
      cashApprovalThreshold: String(profile?.cashApprovalThreshold ?? 0),
      displayName: profile?.displayName ?? "",
      esewaId: profile?.esewaId ?? "",
      khaltiId: profile?.khaltiId ?? "",
      paymentInstructions: profile?.paymentInstructions ?? "",
      qrPayeeName: profile?.qrPayeeName ?? "",
      qrPayeeNumber: profile?.qrPayeeNumber ?? "",
      statementCadenceDays: String(profile?.statementCadenceDays ?? 7),
    });
    setPanel("profile");
  }, [profile]);

  if (finance.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Finance" />}>
        <LoadingState label="Reading your rates" />
      </Screen>
    );
  }

  if (finance.error) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Finance" />}>
        <ErrorState message={finance.error} onRetry={finance.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppBar accent centerTitle showBack subtitle="Rates, billing and payment setup" title="Finance" />}
      onRefresh={finance.refresh}
      refreshing={finance.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              schedules ? (
                <Button label="New rates" onPress={openSchedule} size="sm" variant="outline" />
              ) : undefined
            }
            subtitle="What a bed costs, and from when"
            title="Fee schedule"
          />

          {schedules === null ? (
            <PermissionCard capability="payments" feature="The fee schedule" />
          ) : open === null ? (
            <Card className="gap-2">
              <Text variant="label">No open rate card</Text>
              <Text variant="muted">
                Nothing is priced, so the next billing run fails every resident who has
                no personal fee override. Open one before billing.
              </Text>
              <Button label="Open a rate card" onPress={openSchedule} size="sm" />
            </Card>
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-1">
                  <Text variant="label">{`In force since ${formatDate(open.effectiveFrom)}`}</Text>
                  <Text variant="caption">{`${open.rates.length} bed type(s) priced`}</Text>
                </View>
                <Badge label="Open" tone="success" />
              </View>

              <View className="gap-1 border-t border-border pt-3">
                {open.rates.map((rate) => (
                  <FactRow
                    key={rate.bedType}
                    label={BED_TYPE_LABELS[rate.bedType as BedType] ?? humanizeEnum(rate.bedType)}
                    value={<Money value={rate.monthlyAmount} />}
                  />
                ))}
                {open.admissionFee ? (
                  <FactRow label="Admission" value={<Money value={open.admissionFee} />} />
                ) : null}
                {open.depositAmount ? (
                  <FactRow label="Deposit" value={<Money value={open.depositAmount} />} />
                ) : null}
              </View>

              <Button
                label="Close this card"
                loading={busy}
                onPress={() => void closeCurrent()}
                size="sm"
                variant="ghost"
              />

              <Text variant="caption">
                Rates are never edited. Opening a new card closes this one the day before
                the new rates start, so an invoice issued under these can still be
                explained.
              </Text>
            </Card>
          )}
        </View>

        {(schedules ?? []).filter((schedule) => schedule.effectiveTo !== null).length > 0 ? (
          <View>
            <SectionHeader subtitle="Kept so old invoices stay explainable" title="Past rates" />
            <Card className="gap-3">
              {(schedules ?? [])
                .filter((schedule) => schedule.effectiveTo !== null)
                .slice(0, 6)
                .map((schedule) => (
                  <View className="gap-1" key={schedule._id}>
                    <Text variant="label">
                      {`${formatDate(schedule.effectiveFrom)} – ${formatDate(schedule.effectiveTo)}`}
                    </Text>
                    <Text variant="caption">
                      {schedule.rates
                        .map(
                          (rate) =>
                            `${BED_TYPE_LABELS[rate.bedType as BedType] ?? rate.bedType} ${formatMoney(rate.monthlyAmount)}`,
                        )
                        .join(" · ")}
                    </Text>
                  </View>
                ))}
            </Card>
          </View>
        ) : null}

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            subtitle="Issues one invoice per billable resident for a month"
            title="Billing run"
          />

          {summary === null ? (
            <PermissionCard capability="payments" feature="The billing run" />
          ) : (
            <Card className="gap-3">
              <View className="flex-row gap-3">
                <StatTile
                  icon="calendar-outline"
                  label="Period"
                  tone="brand"
                  value={formatPeriod(summary.period)}
                />
                <StatTile
                  icon="document-text-outline"
                  label="Invoices"
                  value={String(summary.invoiceCount)}
                />
                <StatTile
                  icon="alert-circle-outline"
                  label="Unbilled"
                  tone={summary.notBilledResidentIds.length > 0 ? "warning" : "success"}
                  value={String(summary.notBilledResidentIds.length)}
                />
              </View>

              <FactRow label="Billed so far" value={<Money value={summary.totalBilled} />} />

              {runResult ? (
                <View className="gap-1 rounded-xl border border-border p-3">
                  <Text variant="label">Last run</Text>
                  <Text variant="caption">
                    {`${runResult.billed} billed · ${runResult.skipped} skipped · ${runResult.failures} failed · ${formatMoney(runResult.total)}`}
                  </Text>
                  {runResult.failures > 0 ? (
                    <Text variant="caption">
                      A failure means that resident has no rate for their bed type and no
                      personal fee. They were not billed a guess.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Button
                label={
                  summary.notBilledResidentIds.length > 0
                    ? `Bill the ${summary.notBilledResidentIds.length} remaining`
                    : "Run billing for this period"
                }
                onPress={() => {
                  setForm((prev) => ({ ...prev, dueDate: "" }));
                  setRunResult(null);
                  setPanel("run");
                }}
                size="sm"
              />

              <Text variant="caption">
                Safe to repeat — anyone already billed for this period is skipped rather
                than billed twice.
              </Text>
            </Card>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader subtitle="Where residents are asked to send money" title="Payment setup" />

          {profile === null ? (
            <PermissionCard capability="payments" feature="The payment setup" />
          ) : (
            <Card className="gap-3">
              <View className="flex-row flex-wrap gap-2">
                <Badge
                  label={profile.usable ? "Residents can pay" : "Not set up yet"}
                  tone={profile.usable ? "success" : "danger"}
                />
                <Badge
                  label={profile.payeeVerifiable ? "Receipts checkable" : "Payee not verifiable"}
                  tone={profile.payeeVerifiable ? "success" : "warning"}
                />
                <Chip label={`Tier ${humanizeEnum(profile.tier)}`} />
              </View>

              {profile.payeeVerifiable ? null : (
                <Text variant="caption">
                  Every claim this hostel receives reads UNKNOWN on the payee, so the one
                  check a payer cannot fake is switched off. Add a bank account, an eSewa
                  or Khalti ID, or type the name on your QR poster.
                </Text>
              )}

              <View className="gap-1 border-t border-border pt-3">
                <FactRow label="Paid to" value={profile.displayName || "—"} />
                <FactRow
                  label="Bank"
                  value={
                    profile.bankName
                      ? `${profile.bankName} · ${profile.bankAccountNumber ?? ""}`
                      : "—"
                  }
                />
                <FactRow label="eSewa" value={profile.esewaId || "—"} />
                <FactRow label="Khalti" value={profile.khaltiId || "—"} />
                <FactRow
                  label="Cash needs a second approver above"
                  value={<Money value={profile.cashApprovalThreshold} />}
                />
                <FactRow
                  label="Statement expected every"
                  value={`${profile.statementCadenceDays} day(s)`}
                />
                {profile.lastStatementUploadAt ? (
                  <FactRow
                    label="Last statement"
                    value={formatDate(profile.lastStatementUploadAt)}
                  />
                ) : null}
              </View>

              <Button label="Edit payment setup" onPress={openProfile} size="sm" variant="outline" />
            </Card>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            subtitle="Card and wallet checkout, per provider"
            title="Online payment"
          />

          {gateways === null ? (
            <PermissionCard capability="payment setup" feature="Gateway configuration" />
          ) : (
            <Card padding="px-4 py-1">
              {GATEWAY_PROVIDERS.map((provider, index) => {
                const entry = gateways.find((config) => config.provider === provider);

                return (
                  <View key={provider}>
                    {index > 0 ? <RowDivider inset /> : null}
                    <ListRow
                      icon="card-outline"
                      onPress={() => openGateway(provider)}
                      right={
                        <Badge
                          label={
                            entry?.payable
                              ? "Live"
                              : entry?.enabled
                                ? "Blocked"
                                : entry?.secret.configured
                                  ? "Off"
                                  : "Not set up"
                          }
                          tone={
                            entry?.payable
                              ? "success"
                              : entry?.enabled
                                ? "warning"
                                : "neutral"
                          }
                        />
                      }
                      subtitle={
                        entry?.blockedReason ??
                        [
                          entry?.merchantCode ? `Code ${entry.merchantCode}` : null,
                          entry?.mode ? humanizeEnum(entry.mode) : null,
                          entry?.secret.configured ? "Key installed" : "No key",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                      title={humanizeEnum(provider)}
                    />
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader subtitle="Check the account against what was claimed" title="Reconcile" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="documents-outline"
              onPress={() => router.push("/manage/statements")}
              subtitle="Import a statement, settle what matches, chase what does not"
              title="Bank and wallet statements"
            />
          </Card>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button label="Open these rates" loading={busy} onPress={() => void submitSchedule()} />
        }
        onClose={() => setPanel(null)}
        open={panel === "schedule"}
        title="New rate card"
      >
        <View className="gap-3 pb-2">
          <Text variant="caption">
            Prefilled from the current card. Leave a bed type blank and it is not priced —
            residents on it will fail the next run rather than be billed a guess.
          </Text>

          {BED_TYPES.map((bedType) => (
            <Input
              key={bedType}
              keyboardType="number-pad"
              label={`${BED_TYPE_LABELS[bedType]} (NPR / month)`}
              onChangeText={(value) => setRates((prev) => ({ ...prev, [bedType]: value }))}
              value={rates[bedType] ?? ""}
            />
          ))}

          <Input
            keyboardType="number-pad"
            label="Admission fee (NPR)"
            onChangeText={(admissionFee) => setForm((prev) => ({ ...prev, admissionFee }))}
            value={form.admissionFee ?? ""}
          />
          <Input
            keyboardType="number-pad"
            label="Deposit (NPR)"
            onChangeText={(depositAmount) => setForm((prev) => ({ ...prev, depositAmount }))}
            value={form.depositAmount ?? ""}
          />
          <Input
            hint="The current card closes the day before this."
            keyboardType="numbers-and-punctuation"
            label="In force from"
            onChangeText={(effectiveFrom) => setForm((prev) => ({ ...prev, effectiveFrom }))}
            placeholder="YYYY-MM-DD"
            value={form.effectiveFrom ?? ""}
          />
          <View className="flex-row flex-wrap gap-2">
            <Chip
              label="Tomorrow"
              onPress={() => setForm((prev) => ({ ...prev, effectiveFrom: dayInputFromNow(1) }))}
            />
            <Chip
              label="Next month"
              onPress={() => setForm((prev) => ({ ...prev, effectiveFrom: dayInputFromNow(30) }))}
            />
          </View>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Run it" loading={busy} onPress={() => void bill()} />}
        onClose={() => setPanel(null)}
        open={panel === "run"}
        title={`Bill ${formatPeriod(period)}`}
      >
        <View className="gap-3 pb-2">
          <Input
            hint="YYYY-MM. Re-running a month is safe."
            label="Period"
            onChangeText={(value) => {
              if (PERIOD_PATTERN.test(value) || value.length < 7) {
                setPeriod(value);
              }
            }}
            placeholder="2026-08"
            value={period}
          />

          <Input
            hint="Leave blank for the last day of the month, which is what residents are used to."
            keyboardType="numbers-and-punctuation"
            label="Due on"
            onChangeText={(dueDate) => setForm((prev) => ({ ...prev, dueDate }))}
            placeholder="YYYY-MM-DD"
            value={form.dueDate ?? ""}
          />

          <Text variant="caption">
            No amount is asked for here on purpose. Every invoice is priced from the fee
            schedule and the resident&apos;s own override, so nobody can be billed a
            number that came from this form.
          </Text>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Save" loading={busy} onPress={() => void saveProfile()} />}
        onClose={() => setPanel(null)}
        open={panel === "profile"}
        title="Payment setup"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="The name residents see on the pay screen."
            label="Paid to"
            onChangeText={(displayName) => setForm((prev) => ({ ...prev, displayName }))}
            value={form.displayName ?? ""}
          />
          <Input
            label="Bank"
            onChangeText={(bankName) => setForm((prev) => ({ ...prev, bankName }))}
            value={form.bankName ?? ""}
          />
          <Input
            label="Account name"
            onChangeText={(bankAccountName) => setForm((prev) => ({ ...prev, bankAccountName }))}
            value={form.bankAccountName ?? ""}
          />
          <Input
            keyboardType="numbers-and-punctuation"
            label="Account number"
            onChangeText={(bankAccountNumber) =>
              setForm((prev) => ({ ...prev, bankAccountNumber }))
            }
            value={form.bankAccountNumber ?? ""}
          />
          <Input
            keyboardType="numbers-and-punctuation"
            label="eSewa ID"
            onChangeText={(esewaId) => setForm((prev) => ({ ...prev, esewaId }))}
            value={form.esewaId ?? ""}
          />
          <Input
            keyboardType="numbers-and-punctuation"
            label="Khalti ID"
            onChangeText={(khaltiId) => setForm((prev) => ({ ...prev, khaltiId }))}
            value={form.khaltiId ?? ""}
          />

          <Text variant="label">On the QR poster</Text>
          <Text variant="caption">
            Type these only when the recogniser could not read your QR. Typing either marks
            the pair manual, which is what stops a later re-read from overwriting your
            answer.
          </Text>
          <Input
            label="Name on the QR"
            onChangeText={(qrPayeeName) => setForm((prev) => ({ ...prev, qrPayeeName }))}
            value={form.qrPayeeName ?? ""}
          />
          <Input
            keyboardType="numbers-and-punctuation"
            label="Number on the QR"
            onChangeText={(qrPayeeNumber) => setForm((prev) => ({ ...prev, qrPayeeNumber }))}
            value={form.qrPayeeNumber ?? ""}
          />

          <Input
            hint="Zero means every cash entry needs a second approver."
            keyboardType="number-pad"
            label="Cash needs approval above (NPR)"
            onChangeText={(cashApprovalThreshold) =>
              setForm((prev) => ({ ...prev, cashApprovalThreshold }))
            }
            value={form.cashApprovalThreshold ?? ""}
          />
          <Input
            hint="1–90. How often you are reminded to upload a statement."
            keyboardType="number-pad"
            label="Statement expected every (days)"
            onChangeText={(statementCadenceDays) =>
              setForm((prev) => ({ ...prev, statementCadenceDays }))
            }
            value={form.statementCadenceDays ?? ""}
          />
          <Input
            hint="Shown under the pay options — anything a resident should know before sending."
            label="Instructions"
            multiline
            onChangeText={(paymentInstructions) =>
              setForm((prev) => ({ ...prev, paymentInstructions }))
            }
            style={{ height: 96 }}
            value={form.paymentInstructions ?? ""}
          />
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Save" loading={busy} onPress={() => void submitGateway()} />}
        onClose={() => setPanel(null)}
        open={panel === "gateway"}
        title={humanizeEnum(gateway)}
      >
        <View className="gap-3 pb-2">
          <Select
            hint="A personal wallet is stored but can never be enabled for online payment — ask your bank for a merchant account."
            label="Account kind"
            onChange={(accountKind) => setGatewayForm((prev) => ({ ...prev, accountKind }))}
            options={[
              { description: "Registered with the provider.", label: "Merchant", value: "MERCHANT" },
              { description: "A personal wallet.", label: "Personal", value: "PERSONAL" },
            ]}
            value={gatewayForm.accountKind ?? "MERCHANT"}
          />

          <Input
            hint="eSewa's product code, Fonepay's merchant code. Khalti leaves it empty."
            label="Merchant code"
            onChangeText={(merchantCode) => setGatewayForm((prev) => ({ ...prev, merchantCode }))}
            value={gatewayForm.merchantCode ?? ""}
          />

          <Select
            label="Mode"
            onChange={(mode) => setGatewayForm((prev) => ({ ...prev, mode }))}
            options={[
              { description: "Test credentials.", label: "Sandbox", value: "SANDBOX" },
              { description: "Real money.", label: "Live", value: "LIVE" },
            ]}
            value={gatewayForm.mode ?? "SANDBOX"}
          />

          <Input
            hint="Leave blank to keep the key already stored — it cannot be read back, only replaced."
            label="Signing secret"
            onChangeText={(secret) => setGatewayForm((prev) => ({ ...prev, secret }))}
            placeholder="Unchanged"
            secure
            value={gatewayForm.secret ?? ""}
          />

          <Input
            hint="Only where the provider issues a second key for callbacks."
            label="Webhook secret"
            onChangeText={(webhookSecret) =>
              setGatewayForm((prev) => ({ ...prev, webhookSecret }))
            }
            placeholder="Unchanged"
            secure
            value={gatewayForm.webhookSecret ?? ""}
          />

          <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
            <View className="flex-1">
              <Text variant="label">Offer this to residents</Text>
              <Text variant="caption">
                Needs a merchant account and an installed key. The server refuses
                otherwise and says why.
              </Text>
            </View>
            <Toggle
              accessibilityLabel="Offer this gateway to residents"
              onChange={setGatewayEnabled}
              value={gatewayEnabled}
            />
          </View>

          {(gateways ?? []).find((config) => config.provider === gateway)?.health ? (
            <Text variant="caption">
              {`Last health check: ${(gateways ?? []).find((config) => config.provider === gateway)?.health?.detail ?? ""}`}
            </Text>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}
