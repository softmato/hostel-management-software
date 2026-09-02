import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip, FactRow } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState, PermissionCard } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  BED_TYPE_LABELS,
  type BedType,
  type FeeSchedule,
  type GatewayConfig,
  GATEWAY_PROVIDERS,
  getPaymentProfile,
  listFeeSchedules,
  listGateways,
  type PaymentProfile,
} from "@/lib/admin-manage-api";
import { API_BASE_URL } from "@/lib/api";
import { openAssetViewer, viewerSourceFor } from "@/lib/asset-viewer";
import { humanizeEnum } from "@/lib/format";

/**
 * Finance — what a bed costs, where the money goes, and whether it arrived.
 *
 * ## This screen shows; the pushed screens edit
 *
 * It used to do both, and the cost was a wall of prose: every card carried the
 * paragraph explaining the rule behind the control next to it, and four bottom
 * sheets held the forms. An owner opening this to check one rate had to read an
 * essay to find one number.
 *
 * So each block is now facts plus one **Edit**, and the rule that used to be
 * printed here lives beside the field it governs on the screen that owns it —
 * `finance/rates`, `finance/payment-setup`, `finance/gateway/[provider]`.
 * Returning from one of those revalidates silently (`useResource` refetches on
 * refocus), so a save shows up here with nothing wired between them.
 *
 * ## Billing is not on this screen at all
 *
 * `cron/billing-cycle` issues the month's invoices for every hostel on the 1st
 * and `cron/payment-reminders` chases them with the reference code residents
 * quote back. A "Run billing" button therefore asked the owner to do the
 * machine's job, and a period summary beside it implied the machine might not
 * have. Both are gone. The month's invoices are the **Money** tab's subject —
 * this screen only decides what they say.
 *
 * ## Three capabilities, not one
 *
 * Reading wants `viewPayments`; the rates want `manageFeeSchedule`; the profile
 * and the gateways want `managePaymentProfile`. They were split so the warden
 * who approves payment proofs cannot also change the account the money is asked
 * to go to — which is why each block can be refused while its neighbour loads.
 */

type FinanceData = {
  gateways: GatewayConfig[] | null;
  profile: PaymentProfile | null;
  schedules: FeeSchedule[] | null;
};

async function loadFinance(): Promise<FinanceData> {
  const [schedules, profile, gateways] = await Promise.all([
    listFeeSchedules().catch(() => null),
    getPaymentProfile().catch(() => null),
    // The one read that needs `managePaymentProfile` rather than `viewPayments`
    // — it lists merchant codes and which keys are installed.
    listGateways().catch(() => null),
  ]);

  return { gateways, profile, schedules };
}

export default function ManageFinanceScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();
  const token = useAppSelector((state) => state.auth.accessToken);

  const finance = useResource<FinanceData>(useCallback(() => loadFinance(), []));

  const schedules = finance.data?.schedules ?? null;
  const profile = finance.data?.profile ?? null;
  const gateways = finance.data?.gateways ?? null;

  const open = useMemo(
    () => (schedules ?? []).find((schedule) => schedule.effectiveTo === null) ?? null,
    [schedules],
  );

  const pastCount = useMemo(
    () => (schedules ?? []).filter((schedule) => schedule.effectiveTo !== null).length,
    [schedules],
  );

  const qrSource = profile?.staticQrAssetId
    ? viewerSourceFor(
        { assetId: profile.staticQrAssetId },
        { baseUrl: API_BASE_URL, token },
      )
    : null;

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
      header={
        <AppBar
          accent
          centerTitle
          showBack
          subtitle="Rates and payment setup"
          title="Finance"
        />
      }
      onRefresh={finance.refresh}
      refreshing={finance.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {/*
          Past rates, one tap up and out of the way.

          A chip on the page rather than an action in the bar: the bar is
          `centerTitle`, whose side slots are one icon wide by construction, and
          a second control up there pushes the title off the optical centre —
          `<AppBar>`'s own note says to leave `centerTitle` off in that case,
          and this screen wants the centred bar every other pushed screen has.
        */}
        {pastCount > 0 ? (
          <View className="flex-row justify-end">
            <Chip
              icon="time-outline"
              label="Past schedules"
              onPress={() => router.push("/manage/finance/history")}
            />
          </View>
        ) : null}

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              open ? (
                <Button
                  label="New rates"
                  onPress={() => router.push("/manage/finance/rates")}
                  size="sm"
                  variant="outline"
                />
              ) : undefined
            }
            title="Fee schedule"
          />

          {schedules === null ? (
            <PermissionCard capability="payments" feature="The fee schedule" />
          ) : open === null ? (
            <Card className="gap-3">
              <Text variant="label">No rates set</Text>
              <Button
                label="Set the rates"
                onPress={() => router.push("/manage/finance/rates")}
                size="sm"
              />
            </Card>
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text variant="label">{`Effective from ${dates.date(open.effectiveFrom)}`}</Text>
                <Badge label="Active" tone="success" />
              </View>

              <View className="gap-1 border-t border-border pt-3">
                {open.rates.map((rate) => (
                  <FactRow
                    key={rate.bedType}
                    label={
                      BED_TYPE_LABELS[rate.bedType as BedType] ?? humanizeEnum(rate.bedType)
                    }
                    value={<Money value={rate.monthlyAmount} />}
                  />
                ))}
                {open.admissionFee ? (
                  <FactRow label="Admission" value={<Money value={open.admissionFee} />} />
                ) : null}
                {open.referralAdmissionDiscount ? (
                  <FactRow
                    label="Referral discount"
                    value={<Money value={open.referralAdmissionDiscount} />}
                  />
                ) : null}
                {open.depositAmount ? (
                  <FactRow label="Deposit" value={<Money value={open.depositAmount} />} />
                ) : null}
              </View>
            </Card>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              profile ? (
                <Button
                  label="Edit"
                  onPress={() => router.push("/manage/finance/payment-setup")}
                  size="sm"
                  variant="outline"
                />
              ) : undefined
            }
            title="Payment setup"
          />

          {profile === null ? (
            <PermissionCard capability="payments" feature="The payment setup" />
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-center gap-3">
                {qrSource && profile.staticQrAssetId ? (
                  <Pressable
                    accessibilityLabel="View the payment QR"
                    accessibilityRole="imagebutton"
                    className="active:opacity-70"
                    onPress={() =>
                      openAssetViewer([
                        { assetId: profile.staticQrAssetId ?? "", caption: "Payment QR" },
                      ])
                    }
                  >
                    <Image
                      contentFit="cover"
                      source={qrSource}
                      style={{
                        borderColor: colors.border,
                        borderRadius: 12,
                        borderWidth: 1,
                        height: 64,
                        width: 64,
                      }}
                    />
                  </Pressable>
                ) : (
                  <View className="h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border">
                    <Ionicons color={colors.mutedForeground} name="qr-code-outline" size={22} />
                  </View>
                )}

                <View className="flex-1 gap-1.5">
                  <Text variant="label">{profile.displayName || "Not named yet"}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Badge
                      label={profile.usable ? "Residents can pay" : "Not set up"}
                      tone={profile.usable ? "success" : "danger"}
                    />
                    <Badge
                      label={profile.payeeVerifiable ? "Receipts checked" : "Payee unknown"}
                      tone={profile.payeeVerifiable ? "success" : "warning"}
                    />
                  </View>
                </View>
              </View>

              <View className="gap-1 border-t border-border pt-3">
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
                  label="Cash approval above"
                  value={<Money value={profile.cashApprovalThreshold} />}
                />
                <FactRow
                  label="Statement reminder"
                  value={`Every ${profile.statementCadenceDays} days`}
                />
              </View>
            </Card>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader title="Online payment" />

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
                      onPress={() => router.push(`/manage/finance/gateway/${provider}`)}
                      right={
                        <Badge
                          label={
                            entry?.payable
                              ? "On"
                              : entry?.enabled
                                ? "Blocked"
                                : entry?.secret.configured
                                  ? "Off"
                                  : "Not set up"
                          }
                          tone={
                            entry?.payable ? "success" : entry?.enabled ? "warning" : "neutral"
                          }
                        />
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
          <SectionHeader title="Reconcile" />
          <Card padding="px-4 py-1">
            <ListRow
              icon="documents-outline"
              onPress={() => router.push("/manage/statements")}
              title="Bank and wallet statements"
            />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
