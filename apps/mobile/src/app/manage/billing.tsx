import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { FactRow } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Meter } from "@/components/ui/meter";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import type {
  PlanBilling,
  PlanBillingInvoice,
  PlanBillingPayment,
  PlanBillingPlan,
} from "@/lib/admin-manage-api";
import { adminQuery } from "@/lib/admin-queries";
import { API_BASE_URL } from "@/lib/api";
import { downloadToDevice } from "@/lib/documents";
import { toastError } from "@/lib/toast";

/**
 * Billing — what this hostel pays the platform, and how long it has left.
 *
 * ## Not the Money tab, and not `manage/finance`
 *
 * Both of those are the hostel billing its **residents**: rent, rate cards,
 * proofs, reconciliation, with the hostel as merchant of record. This is the
 * hostel being billed by **us** for the software. The direction of the money is
 * opposite and the counterparty is different, so the two never share a screen —
 * an owner reading "outstanding" here must never have to work out which of the
 * two debts it is.
 *
 * ## What an owner opens this for
 *
 * Almost always one question: *how long have I got*. So the plan card is first,
 * the number is the largest thing on the screen, and everything under it is the
 * record that supports it. The documents matter — they are what an accountant
 * asks for — but nobody opens a billing screen on a phone to browse invoices.
 *
 * ## Days, with the date under it
 *
 * `daysRemaining` is computed on the **server** and printed, never recomputed
 * here. The website shows the same figure from the same field, and two clients
 * each flooring their own part-day is exactly how one screen says 12 and the
 * other says 11 on the same afternoon.
 *
 * The date sits beneath it in the reader's own calendar via `useDates`, because
 * the count is what makes an owner act and the date is what they put in a diary.
 * Neither is sufficient alone.
 *
 * ## One list, switched, rather than two stacked
 *
 * Invoices and receipts are different objects and a phone has one column, so
 * stacking both means the second is below the fold on every visit.
 * `Segmented` is the vocabulary this app already uses for exactly this
 * (`NOTES.md` §7), and the counts on the labels make the empty one visible
 * without opening it.
 *
 * ## Downloads go to the shade, not to a share sheet
 *
 * `downloadToDevice` — the global downloader. The file lands in the user's own
 * folder with progress in the notification shade, which is what every other
 * document in this app does. A share sheet would make saving an invoice a
 * different gesture from saving a statement, for no reason.
 */

type Tab = "invoices" | "receipts";

/**
 * The document route, rebuilt against this build's API host.
 *
 * The server hands back an absolute URL built from `siteUrl()`, which is the
 * *website's* origin. On a device pointed at a dev machine, or any deployment
 * where the app talks to a different host from the one the public site is
 * served on, that URL resolves to somewhere this build cannot authenticate
 * against. The path is stable and the host is the app's own business, so the
 * host is the app's to supply.
 */
function documentUrl(kind: "invoice" | "receipt", number: string) {
  return `${API_BASE_URL}/api/v1/hostel-admin/billing/documents/${kind}/${encodeURIComponent(number)}`;
}

export default function ManageBillingScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();
  const [tab, setTab] = useState<Tab>("invoices");
  const [busy, setBusy] = useState<string | null>(null);

  const query = adminQuery.planBilling();
  const billing = useResource<PlanBilling>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const data = billing.data;
  const invoices = useMemo(() => data?.invoices ?? [], [data]);
  const payments = useMemo(() => data?.payments ?? [], [data]);

  /*
   * `busy` is keyed by the row rather than a screen-wide boolean: an owner may
   * tap two documents in a row, and a single flag would lock the second behind
   * the first. It stops a double tap on one row and nothing else — the progress
   * itself is the toaster's job.
   */
  const grab = useCallback(
    async (kind: "invoice" | "receipt", number: string, key: string) => {
      setBusy(key);

      try {
        await downloadToDevice({
          extension: "pdf",
          fileName: number.replace(/\//g, "-"),
          label: kind === "invoice" ? "Invoice" : "Receipt",
          mimeType: "application/pdf",
          url: documentUrl(kind, number),
        });
      } catch (error) {
        toastError(
          "Could not save it",
          error instanceof Error ? error.message : "Please try again.",
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const header = <AppBar accent centerTitle showBack title="Billing" />;

  if (billing.loading) {
    return (
      <Screen header={header}>
        <SkeletonCard rows={4} />
      </Screen>
    );
  }

  if (billing.error) {
    return (
      <Screen header={header}>
        <ErrorState
          message={billing.error}
          onRetry={billing.reload}
          title="Billing unavailable"
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll>
      <View className="gap-5">
          {data?.plan ? (
            <PlanCard dateLong={dates.dateLong} plan={data.plan} />
          ) : (
            <EmptyCard
              description="This hostel is not on a plan yet, so there is nothing to bill."
              title="No plan"
            />
          )}

          <View>
            <SectionHeader
              subtitle="Every document we have issued for this hostel"
              title="Paperwork"
            />

            <Segmented
              onChange={setTab}
              options={[
                { label: `Invoices (${invoices.length})`, value: "invoices" },
                { label: `Receipts (${payments.length})`, value: "receipts" },
              ]}
              value={tab}
            />

            <View className="mt-3 gap-3">
              {tab === "invoices" ? (
                invoices.length === 0 ? (
                  <EmptyCard
                    description="Nothing has been billed for this hostel's plan yet."
                    title="No invoices"
                  />
                ) : (
                  invoices.map((invoice) => (
                    <InvoiceCard
                      busy={busy === invoice.invoiceNumber}
                      dateLong={dates.dateLong}
                      invoice={invoice}
                      key={invoice.invoiceNumber}
                      onDownload={() =>
                        void grab(
                          "invoice",
                          invoice.invoiceNumber,
                          invoice.invoiceNumber,
                        )
                      }
                    />
                  ))
                )
              ) : payments.length === 0 ? (
                <EmptyCard
                  description="No payment has been received against a plan invoice yet."
                  title="No receipts"
                />
              ) : (
                payments.map((payment, index) => {
                  const key =
                    payment.printedNumber ??
                    payment.receiptNumber ??
                    String(index);

                  return (
                    <ReceiptCard
                      busy={busy === key}
                      dateLong={dates.dateLong}
                      iconColor={colors.mutedForeground}
                      key={key}
                      onDownload={() => void grab("receipt", key, key)}
                      payment={payment}
                    />
                  );
                })
              )}
            </View>
          </View>
      </View>
    </Screen>
  );
}

/**
 * The plan, and the countdown.
 *
 * The meter is the cycle consumed rather than a decorative bar: it is drawn
 * only when both ends of the period are known, because a proportion with no
 * denominator is a bar that means whatever its width happens to be. When the
 * cycle length is unknown the number and the date carry the whole message,
 * which they can.
 *
 * Amber inside a fortnight, never red. A plan coming up for renewal is the
 * product working; a hostel that has paid every cycle does not need its billing
 * screen alarmed at it. The one genuinely wrong state — the period has run out —
 * says so in words.
 */
function PlanCard({
  dateLong,
  plan,
}: {
  dateLong: (value: string | null | undefined) => string;
  plan: PlanBillingPlan;
}) {
  const days = plan.daysRemaining;
  const expiring = days !== null && days <= 14;
  const expired = days === 0;

  const percent = useMemo(() => {
    if (!plan.currentPeriodEnd || !plan.activatedAt || days === null) {
      return null;
    }

    const end = new Date(plan.currentPeriodEnd).getTime();
    const start = new Date(plan.activatedAt).getTime();
    const span = end - start;

    if (span <= 0) return null;

    return Math.round(((span - days * 86_400_000) / span) * 100);
  }, [days, plan.activatedAt, plan.currentPeriodEnd]);

  return (
    <Card className={expiring ? "gap-3 border-warning/40 bg-warning/5" : "gap-3"}>
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1">
          <Text variant="caption">Current plan</Text>
          <Text className="mt-0.5" variant="subtitle">
            {plan.planName ?? "No plan chosen"}
          </Text>
          {plan.cycleLabel ? (
            <Text variant="muted">{plan.cycleLabel}</Text>
          ) : null}
        </View>

        {days !== null ? (
          <View className="items-end">
            <Text
              className={`text-3xl font-bold ${expiring ? "text-warning" : "text-foreground"}`}
            >
              {days}
            </Text>
            <Text variant="caption">{days === 1 ? "day left" : "days left"}</Text>
          </View>
        ) : null}
      </View>

      {percent === null ? null : (
        <Meter label={`${percent}% of this cycle used`} percent={percent} />
      )}

      <View className="gap-0 border-t border-border pt-1">
        <FactRow
          label="Status"
          value={
            <Badge
              label={plan.status.replaceAll("_", " ").toLowerCase()}
              tone={
                plan.status === "ACTIVE"
                  ? "success"
                  : plan.status === "PAST_DUE" || plan.status === "EXPIRED"
                    ? "warning"
                    : "neutral"
              }
            />
          }
        />

        <FactRow
          label={expired ? "Ended" : "Paid through"}
          value={
            plan.currentPeriodEnd
              ? dateLong(plan.currentPeriodEnd)
              : "Nothing paid for yet"
          }
        />

        {plan.price ? (
          <FactRow
            label="Price per cycle"
            value={<Money size="inline" value={plan.price} />}
          />
        ) : null}

        {plan.dueBy ? (
          <FactRow label="Balance due by" value={dateLong(plan.dueBy)} />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * One invoice.
 *
 * The number shown is the one **printed on the document** — Softmato's when they
 * raised it, ours when we did. That is what an owner is reading off the copy in
 * their hand when they ring us, and it is the number the download is addressed
 * by from the reader's point of view. Our own reference sits under it in the
 * caption because it is what every other screen indexes by.
 */
function InvoiceCard({
  busy,
  dateLong,
  invoice,
  onDownload,
}: {
  busy: boolean;
  dateLong: (value: string | null | undefined) => string;
  invoice: PlanBillingInvoice;
  onDownload: () => void;
}) {
  const settled = invoice.outstanding === 0;

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="subtitle">{invoice.planName}</Text>
          <Text variant="caption">
            {invoice.printedNumber}
            {invoice.printedNumber === invoice.invoiceNumber
              ? ""
              : ` · ${invoice.invoiceNumber}`}
          </Text>
        </View>

        <View className="items-end">
          <Money size="large" value={invoice.amount} />
          {settled ? null : (
            <Money owed size="inline" value={invoice.outstanding} />
          )}
        </View>
      </View>

      <View className="flex-row items-center gap-2">
        <Badge
          label={invoice.status.toLowerCase()}
          tone={
            invoice.status === "PAID"
              ? "success"
              : invoice.status === "VOID"
                ? "neutral"
                : "warning"
          }
        />
        <Text variant="caption">
          {invoice.cycleLabel} · issued {dateLong(invoice.issuedAt)}
        </Text>
      </View>

      <RowDivider />

      {/*
        Always offered. Every invoice has a document now — theirs when Softmato
        raised it, ours when they could not be reached — so there is no state
        left where this row would produce nothing.
      */}
      <ListRow
        busy={busy}
        icon="download-outline"
        onPress={onDownload}
        subtitle={
          invoice.issuedBy === "platform"
            ? "Issued by us while Softmato is unavailable"
            : "Issued by Softmato"
        }
        title="Download invoice"
      />
    </Card>
  );
}

/**
 * One payment, and the receipt for it.
 *
 * A payment that has not settled carries no download, and the row says why
 * rather than disappearing. A receipt asserts that a sum was received; offering
 * one for money still in flight would put a document into the world stating
 * something that may never become true.
 */
function ReceiptCard({
  busy,
  dateLong,
  iconColor,
  onDownload,
  payment,
}: {
  busy: boolean;
  dateLong: (value: string | null | undefined) => string;
  iconColor: string;
  onDownload: () => void;
  payment: PlanBillingPayment;
}) {
  const settled = payment.status === "SETTLED";

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="subtitle">
            {payment.method === "CASH"
              ? "Cash, collected in person"
              : (payment.provider ?? "Online payment")}
          </Text>
          <Text variant="caption">
            {payment.printedNumber ?? payment.receiptNumber ?? "—"}
          </Text>
        </View>

        <Money size="large" tone="credit" value={payment.amount} />
      </View>

      <View className="flex-row items-center gap-2">
        <Badge
          label={payment.status.toLowerCase()}
          tone={settled ? "success" : payment.status === "FAILED" ? "danger" : "neutral"}
        />
        <Text variant="caption">{dateLong(payment.paidAt)}</Text>
      </View>

      <RowDivider />

      {settled ? (
        <ListRow
          busy={busy}
          icon="receipt-outline"
          onPress={onDownload}
          subtitle={payment.providerRef ? `Ref ${payment.providerRef}` : undefined}
          title="Download receipt"
        />
      ) : (
        <View className="flex-row items-center gap-2 py-2">
          <Ionicons color={iconColor} name="time-outline" size={16} />
          <Text variant="caption">
            The receipt is issued once this payment settles.
          </Text>
        </View>
      )}
    </Card>
  );
}
