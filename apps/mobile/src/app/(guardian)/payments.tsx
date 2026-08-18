import { useCallback } from "react";
import { View } from "react-native";

import { GuardianNotShared, GuardianWardCard } from "@/components/guardian-ward-card";
import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { formatDueLabel, formatMoney, formatPeriod } from "@/lib/format";
import { canSee, guardianOutstanding, receiptsByMonth } from "@/lib/guardian";
import { type GuardianDashboard, getGuardianDashboard } from "@/lib/guardian-api";

/**
 * The ward's dues, read-only — which is the server's shape, not a limitation
 * of this screen.
 *
 * `/guardian/payments` is a GET and there is no guardian-side payment or claim
 * route anywhere in `apps/web`. The web dashboard drew a "Make a Payment"
 * button anyway, with no handler behind it, so a parent tapping it to settle
 * their child's rent got silence. This screen says what to do instead.
 *
 * Receipts arrive as their own list keyed by billing month, so they join the
 * dues rows without a second request — and are gated by their *own* flag, which
 * is why a row can legitimately show dues with no receipt number beside it.
 */
export default function GuardianPaymentsScreen() {
  const guardian = useResource<GuardianDashboard>(
    useCallback(() => getGuardianDashboard(), []),
    { topics: [REALTIME_TOPIC.PAYMENTS] },
  );

  const header = <AppBar title="Payments" />;

  if (guardian.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading dues" />
      </Screen>
    );
  }

  if (guardian.error || !guardian.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={guardian.error ?? "Your ward's dues could not be loaded."}
          onRetry={guardian.reload}
        />
      </Screen>
    );
  }

  const dashboard = guardian.data;

  if (!canSee(dashboard, "canViewPayments")) {
    return (
      <Screen
        header={header}
        insideTabs
        onRefresh={guardian.refresh}
        refreshing={guardian.refreshing}
        scroll
      >
        <View className="gap-5 pt-1">
          <GuardianWardCard dashboard={dashboard} />
          <GuardianNotShared
            subject="fees and dues"
            wardName={dashboard.resident.fullName}
          />
        </View>
      </Screen>
    );
  }

  const receipts = receiptsByMonth(dashboard.receipts);

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={guardian.refresh}
      refreshing={guardian.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-2">
          <Text variant="caption">Total outstanding</Text>
          <Money owed size="display" value={dashboard.summary?.dueAmount ?? 0} />
          <Text variant="caption">
            {(dashboard.summary?.unpaidCount ?? 0) > 0
              ? `${dashboard.summary?.unpaidCount} month(s) unpaid`
              : "Nothing outstanding"}
          </Text>
          <Text className="pt-1" variant="muted">
            Guardians can follow dues here but cannot settle them. Payment is made from
            the resident&apos;s own portal, or directly with the hostel office.
          </Text>
        </Card>

        <View>
          <SectionHeader title="Monthly dues" />
          {dashboard.payments.length === 0 ? (
            <Card>
              <EmptyState
                description="The hostel has not billed this resident yet."
                title="No invoices"
              />
            </Card>
          ) : (
            <Card>
              {dashboard.payments.map((payment, index) => {
                const owed = guardianOutstanding(payment);
                const receipt = receipts.get(payment.month);

                return (
                  <View key={payment.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={
                        <View className="items-end gap-1">
                          <Money
                            owed={owed > 0}
                            value={owed > 0 ? owed : payment.dueAmount}
                          />
                          <StatusPill status={payment.status} />
                        </View>
                      }
                      subtitle={
                        [
                          // The receipt *number*, not a download: there is no
                          // guardian receipt-PDF route, and an icon that
                          // downloads nothing is the dead control again.
                          receipt ? `Receipt ${receipt.receiptNumber}` : null,
                          owed > 0 ? formatDueLabel(payment.dueDate) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      title={formatPeriod(payment.month)}
                    />
                  </View>
                );
              })}
            </Card>
          )}
        </View>

        {/*
          Receipts have their own permission flag, so this section can be absent
          while dues above are visible — and an empty receipts list under a
          granted flag genuinely means none have been issued.
        */}
        {canSee(dashboard, "canViewReceipts") ? (
          <View>
            <SectionHeader subtitle="Issued by the hostel" title="Receipts" />
            <Card>
              {dashboard.receipts.length === 0 ? (
                <EmptyState
                  description="Receipts appear here as the hostel issues them."
                  title="No receipts yet"
                />
              ) : (
                dashboard.receipts.map((receipt, index) => (
                  <View key={receipt.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={<Badge label={formatMoney(receipt.amount)} tone="success" />}
                      subtitle={`${formatPeriod(receipt.month)} · ${receipt.issuedOn}`}
                      title={receipt.receiptNumber}
                    />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
