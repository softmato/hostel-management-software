import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import {
  getFinanceView,
  receiptPdfUrl,
  type ResidentClaim,
  type ResidentFinanceView,
  type ResidentInvoice,
} from "@/lib/finance-api";
import { formatDate, formatDateBoth, formatDueLabel, formatMoney, formatPeriod, humanizeEnum } from "@/lib/format";
import { invoiceLedger, outstanding } from "@/lib/invoice-ledger";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One invoice, as a statement.
 *
 * ## Why this refetches the whole finance view
 *
 * There is no `GET /resident/finance/invoices/{id}`. The list endpoint is the
 * only resident-facing read, so the detail screen asks for it again and picks
 * its row out. That is one extra request rather than a second shape that can
 * drift from the list's — and the list is small (a resident's own months).
 *
 * ## Breakdown, then statement
 *
 * They answer different questions and both are here. The **breakdown** is what
 * the month is made of — rent, a part-month proration, an admission fee, a
 * carried credit — and it is why the total is the number it is. The
 * **statement** is what has happened to that total since: charges and payments
 * in order, with a running balance. A resident asking "why is this month more
 * than last?" wants the first; one asking "did my payment land?" wants the
 * second.
 *
 * The breakdown was blocked server-side until 2026-08-17: `Invoice.lines` had
 * always existed and `toPortalInvoice()` dropped it, so a resident could see
 * what they owed and never why.
 */
export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const finance = useResource<ResidentFinanceView>(
    useCallback(() => getFinanceView(), []),
  );

  const invoice = finance.data?.invoices.find((row) => row.id === id) ?? null;

  const header = (
    <AppBar
      showBack
      subtitle={invoice ? humanizeEnum(invoice.status) : undefined}
      title={invoice ? formatPeriod(invoice.month) : "Invoice"}
    />
  );

  if (finance.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading this invoice" />
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

  if (!invoice) {
    return (
      <Screen header={header}>
        <EmptyState
          description="It may have been voided, or it belongs to a different account."
          title="Invoice not found"
        />
      </Screen>
    );
  }

  const owed = outstanding(invoice);
  const claims = (finance.data?.claims ?? []).filter(
    (claim) => claim.invoiceId === invoice.id,
  );

  return (
    <Screen
      /*
       * The pay CTA is a sticky footer, not a card in the scroll.
       *
       * A resident opening an unpaid invoice came to pay it, and the statement
       * below can run to a dozen rows — a button at the end of that is a button
       * most of them never reach. It disappears once nothing is owed rather
       * than greying out: "pay" on a settled month is a question, not a
       * disabled control.
       */
      footer={
        owed > 0 ? (
          <Button label="Pay now" onPress={() => router.push(`/invoice/${id}/pay`)} />
        ) : undefined
      }
      header={header}
      onRefresh={finance.refresh}
      refreshing={finance.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <SummaryCard invoice={invoice} owed={owed} />

        <ReferenceCard invoice={invoice} />

        <BreakdownCard invoice={invoice} />

        <LedgerCard invoice={invoice} />

        {claims.length > 0 ? <ClaimsCard claims={claims} /> : null}

        {invoice.receipts.length > 0 ? <ReceiptsCard invoice={invoice} /> : null}
      </View>
    </Screen>
  );
}

function SummaryCard({ invoice, owed }: { invoice: ResidentInvoice; owed: number }) {
  const dueLabel = formatDueLabel(invoice.dueDate);

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="caption">{owed > 0 ? "Still owed" : "Settled"}</Text>
          <Money owed size="display" value={owed} />
        </View>
        <StatusPill status={invoice.status} />
      </View>

      {invoice.dueDate ? (
        <Text variant="muted">
          {`Due ${formatDateBoth(invoice.dueDate)}${owed > 0 && dueLabel ? ` · ${dueLabel}` : ""}`}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * The code that connects a bank transfer back to this invoice.
 *
 * Copyable, because the alternative is retyping it into a banking app and
 * mistyping one character — and a payment carrying a wrong code arrives as an
 * orphan that somebody has to match to a person by hand.
 */
function ReferenceCard({ invoice }: { invoice: ResidentInvoice }) {
  if (!invoice.referenceCode) {
    return null;
  }

  return (
    <Card className="gap-2">
      <Text variant="label">Payment reference</Text>
      <Text className="text-2xl font-semibold tracking-widest text-foreground">
        {invoice.referenceCode}
      </Text>
      <Text variant="caption">
        Put this in the remarks of your transfer so the hostel can match it to this
        month.
      </Text>
      <ListRow
        icon="copy-outline"
        onPress={() => {
          void Clipboard.setStringAsync(invoice.referenceCode ?? "");
          toastSuccess("Reference copied");
        }}
        title="Copy reference"
      />
    </Card>
  );
}

/**
 * What the month is made of.
 *
 * ## Rendered only when the server has lines
 *
 * Migrated history has none — invoices that came from the old `Payment` rows
 * predate the breakdown — so an empty card would appear on exactly the oldest
 * months, where a resident is most likely to be checking something. No lines,
 * no section.
 *
 * ## The sign is the meaning
 *
 * A credit line is negative (target §9.4). Printing `formatMoney(amount)` on
 * its absolute value would show a refund as a second charge, which is the one
 * misreading that makes a resident phone the hostel. Negative lines are green
 * and carry a minus, matching the statement below so the two do not disagree
 * about which way money moved.
 *
 * ## The total is checked against the server's
 *
 * `Invoice.totalAmount` is a denormalised sum of the lines, kept honest by a
 * pre-validate hook — so if these two ever disagree, something is wrong on the
 * server and the resident should not be the last to know. Rather than silently
 * showing whichever number is prettier, the card prints the line total and the
 * summary above prints `dueAmount`; a mismatch is visible instead of hidden.
 */
function BreakdownCard({ invoice }: { invoice: ResidentInvoice }) {
  if (invoice.lines.length === 0) {
    return null;
  }

  const total = invoice.lines.reduce((sum, line) => sum + line.amount, 0);

  return (
    <View>
      <SectionHeader
        subtitle="Why this month costs what it does"
        title="Breakdown"
      />

      <Card>
        {invoice.lines.map((line, index) => (
          <View key={`${line.description}-${index}`}>
            {index > 0 ? <RowDivider /> : null}
            <View className="min-h-14 flex-row items-center gap-3 py-3">
              <View className="flex-1">
                <Text variant="label">{line.description}</Text>
                {/*
                  The proration basis is the whole explanation of a part month
                  — "18/31 days" turns an odd number into an obviously correct
                  one — so it leads. The bed type is the fallback context.
                */}
                {line.prorationBasis ? (
                  <Text variant="caption">{line.prorationBasis}</Text>
                ) : line.bedType ? (
                  <Text variant="caption">{humanizeEnum(line.bedType)}</Text>
                ) : null}
              </View>

              <Text
                className={line.amount < 0 ? "text-success" : "text-foreground"}
                variant="label"
              >
                {`${line.amount < 0 ? "−" : ""}${formatMoney(Math.abs(line.amount))}`}
              </Text>
            </View>
          </View>
        ))}

        <RowDivider />

        <View className="flex-row items-center justify-between gap-3 py-3">
          <Text variant="label">Total charged</Text>
          <Text variant="label">{formatMoney(total)}</Text>
        </View>
      </Card>
    </View>
  );
}

function LedgerCard({ invoice }: { invoice: ResidentInvoice }) {
  const lines = invoiceLedger(invoice);

  return (
    <View>
      <SectionHeader subtitle="Charges and payments, in order" title="Statement" />

      <Card>
        {lines.map((line, index) => (
          <View key={`${line.kind}-${line.label}-${index}`}>
            {index > 0 ? <RowDivider /> : null}
            <View className="min-h-14 flex-row items-center gap-3 py-3">
              <View className="flex-1">
                <Text numberOfLines={1} variant="label">
                  {line.label}
                </Text>
                <Text variant="caption">
                  {line.date ? formatDate(line.date) : "Date not recorded"}
                </Text>
              </View>

              <View className="items-end">
                <Text
                  className={line.amount < 0 ? "text-success" : "text-foreground"}
                  variant="label"
                >
                  {`${line.amount < 0 ? "−" : "+"}${formatMoney(Math.abs(line.amount))}`}
                </Text>
                <Text variant="caption">{`Balance ${formatMoney(line.balance)}`}</Text>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

function ClaimsCard({ claims }: { claims: ResidentClaim[] }) {
  return (
    <View>
      <SectionHeader
        subtitle="What you told the hostel you have paid"
        title="Your claims"
      />
      <Card>
        {claims.map((claim, index) => (
          <View key={claim.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              right={<StatusPill status={claim.status} />}
              subtitle={claim.createdAt ? formatDate(claim.createdAt) : undefined}
              title={formatMoney(claim.amount)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

/**
 * Voided receipts are already excluded by the server — a receipt voided with a
 * reversed payment must not stay downloadable, or the resident keeps a document
 * asserting a payment the ledger no longer counts.
 *
 * Tapping one downloads it with the bearer token and **saves it to the device**.
 * A resident who needs proof of rent for a visa or a landlord should be one tap
 * from the PDF rather than emailing the hostel for it — and what those people
 * ask for is a file to attach, which is a saved document rather than a share
 * sheet that has to be re-opened later.
 */
function ReceiptsCard({ invoice }: { invoice: ResidentInvoice }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const share = useCallback(async (receipt: ResidentInvoice["receipts"][number]) => {
    setBusyId(receipt.id);

    try {
      await downloadToDevice({
        extension: "pdf",
        fileName: `receipt-${receipt.number}`,
        label: `Receipt ${receipt.number}`,
        mimeType: "application/pdf",
        url: receiptPdfUrl(receipt.id),
      });
    } catch (caught) {
      toastError("Could not open the receipt", readApiError(caught));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <View>
      <SectionHeader title="Receipts" />
      <Card>
        {invoice.receipts.map((receipt, index) => (
          <View key={receipt.id}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              icon={busyId === receipt.id ? "hourglass-outline" : "document-text-outline"}
              onPress={() => void share(receipt)}
              subtitle={receipt.issuedAt ? formatDate(receipt.issuedAt) : undefined}
              title={receipt.number}
              value={formatMoney(receipt.amount)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
