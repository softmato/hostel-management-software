import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Chip, Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import {
  Skeleton,
  SkeletonCard,
  SkeletonTiles,
} from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { residentQuery } from "@/lib/resident-queries";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import {
  type ResidentFinanceView,
  type ResidentInvoice,
  statementPdfUrl,
} from "@/lib/finance-api";
import {
  formatDate,
  formatDueLabel,
  formatMoney,
  formatPeriod,
  formatRelativeDay,
} from "@/lib/format";
import {
  filterInvoices,
  outstanding,
  type PaymentFilter,
  paymentStats,
  totalOutstanding,
} from "@/lib/invoice-ledger";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Every month the resident has been billed for, newest first.
 *
 * The **reference code sits on the list row**, not only behind "Pay now". A
 * resident paying from their banking app out of habit never opens the detail
 * screen, and a bank transfer with no code in the remarks has to be matched to
 * a person by hand at the other end — which is the single most common way a
 * payment goes missing for a week.
 *
 * ## Against `resident-payments-page.tsx` (§5.1)
 *
 * The web rebuilt this page around one question — *what do I owe right now, and
 * how do I pay it* — and this screen had not followed. It opened on a total and
 * a list of six months, which leaves "which of these is the one I act on" as the
 * resident's problem. Ported in this pass:
 *
 * - **The focus card.** The oldest open month, with its amount, its reference
 *   code and both actions on it. Paying was previously two taps into a detail
 *   screen from a row that looked like every other row.
 * - **The metric strip** — next due, last payment, months settled. The screen
 *   had none of it, though every value was already in the payload.
 * - **The history filter.** The web has status tabs; on a phone they are chips,
 *   because three tabs above a list is a navigator's worth of chrome for a
 *   choice between three words.
 *
 * Not ported: the web's four-column metric grid keeps "Total Outstanding" as a
 * tile *and* prints it on the focus card. Here the total is the screen's
 * headline and the tiles are the three facts it does not already say.
 */

const FILTERS: { label: string; value: PaymentFilter }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Settled", value: "settled" },
];

export default function ResidentPaymentsScreen() {
  /*
   * `payments` is published by all four of the services that can change what a
   * resident owes without the resident doing anything: a claim approved or
   * rejected, a gateway payment reviewed, a bank statement reconciled, a
   * statement imported. This is the screen where being one refresh stale is
   * most expensive — it is the balance somebody is about to pay again.
   */
  const query = residentQuery.finance();
  const finance = useResource<ResidentFinanceView>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [statementBusy, setStatementBusy] = useState(false);
  const [filter, setFilter] = useState<PaymentFilter>("all");

  const shareStatement = useCallback(async () => {
    setStatementBusy(true);

    try {
      // The control says "Download statement", so it downloads. Progress goes
      // to the global toaster and the shade — see `downloadToDevice`.
      await downloadToDevice({
        extension: "pdf",
        fileName: "hostel-statement",
        label: "Statement",
        mimeType: "application/pdf",
        url: statementPdfUrl(),
      });
    } catch (caught) {
      toastError("Could not open your statement", readApiError(caught));
    } finally {
      setStatementBusy(false);
    }
  }, []);

  /*
   * Two actions, both `<IconButton>`.
   *
   * The statement button used to be a bare `Pressable` around an `Ionicons`
   * with **no `color`** — which is black, so on a dark bar in dark mode it was a
   * control nobody could see. `IconButton` reads `colors.foreground` and is the
   * header-action shape the rest of the app already uses, bell included.
   *
   * It has no `disabled` prop, and does not need one here: the glyph still
   * swaps to an hourglass while the download runs, and the handler returns
   * early rather than queueing a second fetch of the same PDF.
   */
  const header = (
    <AppBar
      actions={
        <View className="flex-row items-center gap-2">
          <IconButton
            label={statementBusy ? "Downloading your statement" : "Download statement"}
            name={statementBusy ? "hourglass-outline" : "download-outline"}
            onPress={() => {
              if (statementBusy) {
                return;
              }

              void shareStatement();
            }}
          />
          <NotificationBell />
        </View>
      }
      title="Payments"
    />
  );

  if (finance.loading) {
    return (
      /* Focus card, metric strip, filter chips, then months. See Home's note. */
      <Screen header={header} insideTabs scroll>
        <View className="gap-4 pt-1">
          <View className="gap-3 rounded-2xl border border-border bg-card p-4">
            <Skeleton height={11} width="34%" />
            <Skeleton height={30} radius={10} width="50%" />
            <Skeleton height={12} width="46%" />
            <Skeleton height={44} radius={14} />
          </View>

          <SkeletonTiles />

          <View className="flex-row gap-2">
            <Skeleton height={30} radius={15} width={68} />
            <Skeleton height={30} radius={15} width={82} />
            <Skeleton height={30} radius={15} width={74} />
          </View>

          <SkeletonCard rows={4} />
        </View>
      </Screen>
    );
  }

  if (finance.error || !finance.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={finance.error ?? "Your invoices could not be loaded."}
          onRetry={finance.reload}
        />
      </Screen>
    );
  }

  const { claims, credit, invoices } = finance.data;
  const openClaims = claims.filter((claim) => claim.status !== "APPROVED");
  const stats = paymentStats(invoices);
  const shown = filterInvoices(invoices, filter);

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={finance.refresh}
      refreshing={finance.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Card className="gap-2">
          <Text variant="caption">Total outstanding</Text>
          <Money owed size="display" value={totalOutstanding(invoices)} />

          {stats.overdueCount > 0 ? (
            <Badge
              label={
                stats.overdueCount === 1
                  ? "1 month overdue"
                  : `${stats.overdueCount} months overdue`
              }
              tone="danger"
            />
          ) : null}

          {credit > 0 ? (
            <View className="flex-row items-center gap-2">
              <Badge label="Credit" tone="success" />
              {/*
                Carried from an overpayment, and applied to the next invoice by
                the server. Shown only when it exists — a permanent "NPR 0
                credit" row teaches people to ignore the line.
              */}
              <Text className="flex-1" variant="muted">
                {`${formatMoney(credit)} will be applied to your next invoice.`}
              </Text>
            </View>
          ) : null}
        </Card>

        {stats.nextDue ? <FocusCard invoice={stats.nextDue} /> : <SettledCard />}

        {/*
          The programme's own view, as a row rather than a third icon in the app
          bar. Three glyphs up there would crowd a title, and this is not a
          header action in any case — it is a destination, and the question it
          answers ("where are my certified receipts") is not one somebody asks
          while looking at a balance. It sits under the focus card because that
          is where the reference code they are about to quote already is.
        */}
        <Card padding="px-4 py-1">
          <ListRow
            icon="ribbon-outline"
            onPress={() => router.push("/offer-program/mine")}
            subtitle="Your live codes, certified receipts and what has been matched"
            title="Offer Program"
          />
        </Card>

        <Grid gap={10} maxColumns={3} minCellWidth={104}>
          <StatTile
            icon="calendar-outline"
            label="Next due"
            tone={stats.overdueCount > 0 ? "danger" : "brand"}
            trend={stats.nextDue ? formatPeriod(stats.nextDue.month) : "Nothing open"}
            value={stats.nextDue?.dueDate ? formatDate(stats.nextDue.dueDate) : "—"}
          />

          <StatTile
            icon="receipt-outline"
            label="Last paid"
            tone="success"
            trend={stats.lastPaid ? formatPeriod(stats.lastPaid.month) : "No payments yet"}
            value={stats.lastPaid ? formatMoney(stats.lastPaid.paidAmount) : "—"}
          />

          <StatTile
            icon="checkmark-done-outline"
            label="Settled"
            tone="neutral"
            trend={`of ${invoices.length} billed`}
            value={String(stats.settledCount)}
          />
        </Grid>

        {openClaims.length > 0 ? (
          <View>
            <SectionHeader
              subtitle="Waiting on the hostel to verify"
              title="Your claims"
            />
            <Card>
              {openClaims.map((claim, index) => (
                <View key={claim.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    right={<StatusPill status={claim.status} />}
                    subtitle={
                      claim.createdAt
                        ? `Submitted ${formatRelativeDay(claim.createdAt)}`
                        : undefined
                    }
                    title={`Claimed ${formatMoney(claim.amount)}`}
                  />
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <View>
          <SectionHeader title="Invoices" />

          {invoices.length === 0 ? (
            <Card>
              <EmptyState
                description="Your hostel has not billed you yet. Invoices appear here as soon as they do."
                title="No invoices"
              />
            </Card>
          ) : (
            <View className="gap-3">
              {/*
                Chips rather than the web's tab bar: three tabs above a list is a
                navigator's worth of chrome for a choice between three words, and
                on a phone that chrome costs a row of the list itself.
              */}
              <View className="flex-row gap-2">
                {FILTERS.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    onPress={() => setFilter(option.value)}
                    tone={filter === option.value ? "brand" : "neutral"}
                  />
                ))}
              </View>

              <Card>
                {shown.length === 0 ? (
                  <Text variant="muted">
                    {filter === "open"
                      ? "Nothing open — every month billed to you is settled."
                      : "No settled months yet."}
                  </Text>
                ) : (
                  shown.map((invoice, index) => {
                    const owed = outstanding(invoice);
                    const dueLabel = formatDueLabel(invoice.dueDate);

                    return (
                      <View key={invoice.id}>
                        {index > 0 ? <RowDivider /> : null}
                        <ListRow
                          onPress={() => router.push(`/invoice/${invoice.id}`)}
                          right={
                            <View className="items-end gap-1">
                              <Money
                                owed={owed > 0}
                                value={owed > 0 ? owed : invoice.dueAmount}
                              />
                              <StatusPill status={invoice.status} />
                            </View>
                          }
                          subtitle={
                            [invoice.referenceCode, owed > 0 ? dueLabel : null]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                          title={formatPeriod(invoice.month)}
                        />
                      </View>
                    );
                  })
                )}
              </Card>
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

/**
 * The one invoice the resident is here about — the web's `FocusCard`.
 *
 * It is the **oldest** open month, not the newest (see `paymentStats`): someone
 * two months behind must be pointed at July, or it ages into a default while
 * they settle August.
 *
 * Both actions sit on it. "I've paid" is not a lesser button — a resident who
 * transferred from their bank has already done the hard part, and burying the
 * claim behind a detail screen is what produces payments the hostel cannot see.
 */
function FocusCard({ invoice }: { invoice: ResidentInvoice }) {
  const { colors } = useAppTheme();
  const owed = outstanding(invoice);
  const dueLabel = formatDueLabel(invoice.dueDate);

  const copyCode = useCallback(() => {
    if (!invoice.referenceCode) {
      return;
    }

    void Haptics.selectionAsync();
    void Clipboard.setStringAsync(invoice.referenceCode);
    toastSuccess("Reference copied", "Paste it into your transfer's remarks.");
  }, [invoice.referenceCode]);

  return (
    <Card className="gap-3 border-primary/30">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="caption">Due next</Text>
          <Text variant="subtitle">{formatPeriod(invoice.month)}</Text>
        </View>
        <StatusPill status={invoice.status} />
      </View>

      <View className="flex-row items-end justify-between gap-3">
        <Money owed size="large" value={owed} />
        {dueLabel ? (
          <Text
            className={invoice.status === "OVERDUE" ? "text-destructive" : undefined}
            variant="muted"
          >
            {dueLabel}
          </Text>
        ) : null}
      </View>

      {invoice.referenceCode ? (
        <Pressable
          accessibilityHint="Copies the code"
          accessibilityLabel={`Reference ${invoice.referenceCode}`}
          accessibilityRole="button"
          className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 active:opacity-70"
          onPress={copyCode}
        >
          <View className="flex-1">
            <Text variant="caption">Quote this when you transfer</Text>
            <Text className="font-semibold tracking-wide" variant="label">
              {invoice.referenceCode}
            </Text>
          </View>
          <Ionicons color={colors.primary} name="copy-outline" size={18} />
        </Pressable>
      ) : null}

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            label="Pay now"
            onPress={() => router.push(`/invoice/${invoice.id}/pay`)}
          />
        </View>
        <View className="flex-1">
          <Button
            label="I've paid"
            onPress={() => router.push(`/invoice/${invoice.id}/claim`)}
            variant="outline"
          />
        </View>
      </View>
    </Card>
  );
}

function SettledCard() {
  const { colors } = useAppTheme();

  return (
    <Card className="items-center gap-2 border-success/40">
      <Ionicons color={colors.success} name="checkmark-circle" size={30} />
      <Text variant="subtitle">Nothing outstanding</Text>
      <Text className="text-center" variant="muted">
        Every month billed to you so far has been settled.
      </Text>
    </Card>
  );
}
