import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { PartyPopper } from "lucide-react-native";
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
import { WalletMark, walletLabel } from "@/components/ui/wallet-mark";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  BED_TYPE_LABELS,
  type BedType,
  type FeeSchedule,
  GATEWAY_PROVIDERS,
} from "@/lib/admin-manage-api";
import { type AdminFinanceData, adminQuery } from "@/lib/admin-queries";
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
 * ## Festival discounts sit under the rates, not inside them
 *
 * A month at half rent is not a price for a bed, so it is not a rate card — see
 * `finance/month-discounts`. It is shown directly under Rates because that is
 * the only place it means anything: the percentage is read against the rents
 * immediately above it, and an owner checking "what will Kartik cost" needs both
 * numbers in one glance.
 *
 * ## Three capabilities, not one
 *
 * Reading wants `viewPayments`; the rates want `manageFeeSchedule`; the profile
 * and the gateways want `managePaymentProfile`. They were split so the warden
 * who approves payment proofs cannot also change the account the money is asked
 * to go to — which is why each block can be refused while its neighbour loads.
 */

/*
 * `FinanceData` and its loader are `adminQuery.finance()` — see
 * `lib/admin-queries.ts`.
 */

export default function ManageFinanceScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();
  const token = useAppSelector((state) => state.auth.accessToken);

  const query = adminQuery.finance();
  const finance = useResource<AdminFinanceData>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const schedules = finance.data?.schedules ?? null;
  const profile = finance.data?.profile ?? null;
  const gateways = finance.data?.gateways ?? null;
  const concessions = finance.data?.concessions ?? null;

  /*
   * What is billing residents today, and what is only booked to.
   *
   * These used to be one thing — the row with `effectiveTo: null`, drawn with a
   * green **Active** badge. They are not one thing for the whole month between
   * setting new rates and those rates starting, and an owner who set October's
   * rates in September was shown them as live. Their residents were being billed
   * at the previous card the entire time, at ten times the rate, and this screen
   * said everything was fine.
   *
   * `standing` is decided by the server so no screen has to work it out twice.
   */
  const current = useMemo(
    () => (schedules ?? []).find((schedule) => schedule.standing === "current") ?? null,
    [schedules],
  );

  const upcoming = useMemo(
    () => (schedules ?? []).find((schedule) => schedule.standing === "upcoming") ?? null,
    [schedules],
  );

  const pastCount = useMemo(
    () => (schedules ?? []).filter((schedule) => schedule.standing === "past").length,
    [schedules],
  );

  /** What the rate rows for one card look like. Two cards can be on screen. */
  const rateRows = useCallback(
    (schedule: FeeSchedule) => (
      <View className="gap-1 border-t border-border pt-3">
        {schedule.rates.map((rate) => (
          <FactRow
            key={rate.roomType ?? rate.bedType ?? String(rate.monthlyAmount)}
            label={
              rate.roomType ??
              (rate.bedType
                ? (BED_TYPE_LABELS[rate.bedType as BedType] ?? humanizeEnum(rate.bedType))
                : "Unpriced")
            }
            value={<Money value={rate.monthlyAmount} />}
          />
        ))}
        {schedule.admissionFee ? (
          <FactRow label="Admission" value={<Money value={schedule.admissionFee} />} />
        ) : null}
        {schedule.referralAdmissionDiscount ? (
          <FactRow
            label="Referral discount"
            value={<Money value={schedule.referralAdmissionDiscount} />}
          />
        ) : null}
        {schedule.depositAmount ? (
          <FactRow label="Deposit" value={<Money value={schedule.depositAmount} />} />
        ) : null}
      </View>
    ),
    [],
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
              label="Past rates"
              onPress={() => router.push("/manage/finance/history")}
            />
          </View>
        ) : null}

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              current || upcoming ? (
                <Button
                  label={upcoming ? "Change" : "New rates"}
                  onPress={() => router.push("/manage/finance/rates")}
                  size="sm"
                  variant="outline"
                />
              ) : undefined
            }
            title="Rates"
          />

          {schedules === null ? (
            <PermissionCard capability="payments" feature="The fee schedule" />
          ) : !current && !upcoming ? (
            <Card className="gap-3">
              <Text variant="label">No rates set</Text>
              <Button
                label="Set the rates"
                onPress={() => router.push("/manage/finance/rates")}
                size="sm"
              />
            </Card>
          ) : (
            <View className="gap-3">
              {current ? (
                <Card className="gap-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text variant="label">Charging now</Text>
                    <Badge label="Live" tone="success" />
                  </View>
                  {rateRows(current)}
                </Card>
              ) : (
                /*
                 * Rates booked for a future month and nothing running today. The
                 * hostel cannot bill anybody this month, and saying so plainly is
                 * the whole point — the old screen showed the future card as
                 * Active and this state was invisible.
                 */
                <Card className="gap-2">
                  <Text variant="label">No rates are running this month</Text>
                  <Text variant="caption">
                    Nobody can be billed until rates start. The ones below have not
                    begun yet.
                  </Text>
                </Card>
              )}

              {upcoming ? (
                <Card className="gap-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text variant="label">{`Starts ${dates.dateBoth(upcoming.effectiveFrom)}`}</Text>
                    <Badge label="Not started" tone="warning" />
                  </View>
                  {rateRows(upcoming)}
                </Card>
              ) : null}
            </View>
          )}
        </View>

        {/* -------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              concessions ? (
                <Button
                  label={concessions.length > 0 ? "Change" : "Add"}
                  onPress={() => router.push("/manage/finance/month-discounts")}
                  size="sm"
                  variant="outline"
                />
              ) : undefined
            }
            subtitle="One month at reduced rent"
            title="Festival discounts"
          />

          {concessions === null ? (
            <PermissionCard capability="payments" feature="Festival discounts" />
          ) : concessions.length === 0 ? (
            <Card className="gap-2">
              <View className="flex-row items-center gap-2">
                <PartyPopper color={colors.mutedForeground} size={18} />
                <Text variant="label">Every month is at full rent</Text>
              </View>
              <Text variant="caption">
                Take a percentage off one month — Dashain at half fee — without
                touching the rates above.
              </Text>
            </Card>
          ) : (
            <Card padding="px-4 py-1">
              {/*
                Months only, not the rates they reduce. This block is read against
                the card immediately above it, and repeating four room rents at
                50% here would be the second store of one number that the rate
                card's own history warns about on every screen it touches.
              */}
              {concessions.map((row, index) => (
                <View key={row._id}>
                  {index > 0 ? <RowDivider inset /> : null}
                  <ListRow
                    onPress={() => router.push("/manage/finance/month-discounts")}
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

              {/*
                The three destinations money can be sent to, each under its own
                mark rather than its own word.

                `Bank`, `eSewa` and `Khalti` as plain grey labels made a column
                in which the two wallets — the two an owner is most likely to
                have typed into the wrong row — were distinguished by one word in
                the same type as the account number beside it. The marks are the
                same ones the resident sees on the method they pick and the same
                ones `finance/payment-setup` puts beside each field, so the
                summary and the form now match mark for mark.

                `WalletMark` takes the bank's *typed* name, so a misspelling
                shows the fallback glyph here too — the one place an owner reads
                their own setup back is the right place to notice that.
              */}
              <View className="gap-2 border-t border-border pt-3">
                <View className="flex-row items-center gap-2.5">
                  <WalletMark name={profile.bankName} size={28} />
                  <View className="flex-1">
                    <FactRow
                      label={profile.bankName || "Bank"}
                      value={profile.bankAccountNumber || "—"}
                    />
                  </View>
                </View>
                <View className="flex-row items-center gap-2.5">
                  <WalletMark name="ESEWA" size={28} />
                  <View className="flex-1">
                    <FactRow label={walletLabel("ESEWA")} value={profile.esewaId || "—"} />
                  </View>
                </View>
                <View className="flex-row items-center gap-2.5">
                  <WalletMark name="KHALTI" size={28} />
                  <View className="flex-1">
                    <FactRow
                      label={walletLabel("KHALTI")}
                      value={profile.khaltiId || "—"}
                    />
                  </View>
                </View>
              </View>

              <View className="gap-1 border-t border-border pt-3">
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
                      /*
                        The provider's own mark, and its own spelling. Three
                        rows of `card-outline` said nothing about which of the
                        three a tap would open, and `humanizeEnum("ESEWA")` is
                        "Esewa" — the wrong capital on the brand our owners see
                        a dozen times a day. `walletLabel` holds the casing.
                      */
                      left={<WalletMark name={provider} size={36} />}
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
                      title={walletLabel(provider)}
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
