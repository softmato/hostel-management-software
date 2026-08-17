import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { downloadAndShare } from "@/lib/documents";
import {
  getFinanceView,
  type ResidentFinanceView,
  statementPdfUrl,
} from "@/lib/finance-api";
import {
  formatDueLabel,
  formatMoney,
  formatPeriod,
  formatRelativeDay,
} from "@/lib/format";
import { outstanding, totalOutstanding } from "@/lib/invoice-ledger";
import { toastError } from "@/lib/toast";

/**
 * Every month the resident has been billed for, newest first.
 *
 * The **reference code sits on the list row**, not only behind "Pay now". A
 * resident paying from their banking app out of habit never opens the detail
 * screen, and a bank transfer with no code in the remarks has to be matched to
 * a person by hand at the other end — which is the single most common way a
 * payment goes missing for a week.
 */
export default function ResidentPaymentsScreen() {
  const finance = useResource<ResidentFinanceView>(useCallback(() => getFinanceView(), []));

  const [statementBusy, setStatementBusy] = useState(false);

  const shareStatement = useCallback(async () => {
    setStatementBusy(true);

    try {
      await downloadAndShare({ fileName: "hostel-statement", url: statementPdfUrl() });
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

          {credit > 0 ? (
            <View className="flex-row items-center gap-2">
              <Badge label="Credit" tone="success" />
              {/*
                Carried from an overpayment, and applied to the next invoice by
                the server. Shown only when it exists — a permanent "NPR 0
                credit" row teaches people to ignore the line.
              */}
              <Text variant="muted">
                {`${formatMoney(credit)} will be applied to your next invoice.`}
              </Text>
            </View>
          ) : null}
        </Card>

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
            <Card>
              {invoices.map((invoice, index) => {
                const owed = outstanding(invoice);
                const dueLabel = formatDueLabel(invoice.dueDate);

                return (
                  <View key={invoice.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      onPress={() => router.push(`/invoice/${invoice.id}`)}
                      right={
                        <View className="items-end gap-1">
                          <Money owed={owed > 0} value={owed > 0 ? owed : invoice.dueAmount} />
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
              })}
            </Card>
          )}
        </View>
      </View>
    </Screen>
  );
}
