import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip, Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import {
  getFinanceView,
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
  const finance = useResource<ResidentFinanceView>(useCallback(() => getFinanceView(), []));

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

  const header = (
    <AppBar
      actions={
        <Pressable
          accessibilityLabel="Download statement"
          accessibilityRole="button"
          disabled={statementBusy}
          hitSlop={10}
          onPress={() => void shareStatement()}
        >
          <Ionicons
            name={statementBusy ? "hourglass-outline" : "download-outline"}
            size={22}
          />
        </Pressable>
      }
      title="Payments"
    />
  );

  if (finance.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your invoices" />
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
