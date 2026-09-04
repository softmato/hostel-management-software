import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SkeletonCard, SkeletonTiles } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import {
  getFinanceView,
  receiptPdfUrl,
  type ResidentFinanceView,
  type ResidentInvoice,
} from "@/lib/finance-api";
import { formatDate, formatMoney, formatPeriod } from "@/lib/format";
import { outstanding } from "@/lib/invoice-ledger";
import {
  activeCodes,
  type CertifiedReceipt,
  certifiedReceipts,
  offerProgramStats,
} from "@/lib/offer-program";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * The resident's own view of the Offer Program.
 *
 * ## Why this is not part of Payments
 *
 * The web page's header makes the argument and it holds on a phone too: Payments
 * answers *what do I owe and how do I pay it*, and everything on it is arranged
 * around a due date. The questions here are different in kind — which code is
 * live for me, how much of what I paid was matched, where are my receipts — and
 * are usually asked when no money is due. Folding them into Payments buries them
 * under a balance.
 *
 * ## It reads the payments endpoint, and there is no second one
 *
 * Every figure is a rearrangement of what `getFinanceView()` already returns. A
 * dedicated endpoint would be a second chance for two screens to disagree about
 * the same resident's money, which is the failure this product can least afford.
 *
 * ## What is fixed here rather than ported
 *
 * The web filters active codes on `["OPEN", "PARTIAL", "OVERDUE"]` and so hides
 * the reference code for an **`UNPAID`** month — the ordinary state of a month
 * nobody has paid yet, and precisely the invoice somebody opening this screen is
 * about to pay. `lib/offer-program.ts` uses `isOpenInvoice`, which holds the same
 * five statuses the server's own `buildFeeSummary` sums.
 *
 * The web also prints `invoice.month` raw, which renders `null` for an admission
 * fee — `Invoice.period` is nullable and one-off invoices have no month. Here it
 * goes through `formatPeriod`.
 */
export default function MyOfferProgramScreen() {
  const finance = useResource<ResidentFinanceView>(
    useCallback(() => getFinanceView(), []),
    { topics: [REALTIME_TOPIC.PAYMENTS] },
  );

  const header = <AppBar showBack subtitle="Your codes and receipts" title="Offer Program" />;

  if (finance.loading) {
    return (
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <SkeletonTiles />
          <SkeletonCard rows={2} />
          <SkeletonCard rows={3} />
        </View>
      </Screen>
    );
  }

  if (finance.error || !finance.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={finance.error ?? "Your Offer Program details could not be loaded."}
          onRetry={finance.reload}
        />
      </Screen>
    );
  }

  const codes = activeCodes(finance.data.invoices);
  const receipts = certifiedReceipts(finance.data.invoices);
  const stats = offerProgramStats(finance.data);

  return (
    <Screen
      header={header}
      onRefresh={finance.refresh}
      refreshing={finance.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {/*
          "Am I actually in this?" is the first question and no other panel
          answers it. Kept from the web, shortened — the phone version drops the
          paragraph and keeps the sentence that says what the code does.
        */}
        <Card className="gap-2">
          <View className="flex-row items-center gap-2">
            <Text variant="subtitle">Active</Text>
            <Badge label="Member" tone="success" />
          </View>
          <Text variant="muted">
            Quote your reference code when you pay and the payment is matched to the
            right month automatically. Every verified payment is receipted under the
            programme.
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/offer-program")}
          >
            <Text className="text-primary" variant="label">
              Programme rules
            </Text>
          </Pressable>
        </Card>

        <Grid gap={10} maxColumns={3} minCellWidth={104}>
          <StatTile
            icon="ribbon-outline"
            label="Certified"
            tone="brand"
            trend="Verified and receipted"
            value={String(stats.certifiedCount)}
          />
          <StatTile
            icon="cash-outline"
            label="Amount"
            tone="success"
            trend="Total under the programme"
            value={formatMoney(stats.certifiedAmount)}
          />
          <StatTile
            icon="hourglass-outline"
            label="In review"
            tone={stats.pendingCount > 0 ? "warning" : "neutral"}
            trend={stats.pendingCount > 0 ? "With your hostel" : "Nothing waiting"}
            value={String(stats.pendingCount)}
          />
        </Grid>

        <View>
          <SectionHeader
            subtitle="Paste one into the remarks field when you transfer"
            title="Your live reference codes"
          />

          {codes.length === 0 ? (
            <Card>
              <EmptyState
                compact
                description="Nothing is due right now, so there is no code to quote."
                title="No live codes"
              />
            </Card>
          ) : (
            <View className="gap-2">
              {codes.map((invoice) => (
                <CodeCard invoice={invoice} key={invoice.id} />
              ))}

              <Text variant="caption">
                If your bank has no remarks field, pay as normal — your rent still
                counts, it just has to be matched by hand.
              </Text>
            </View>
          )}
        </View>

        <View>
          <SectionHeader
            subtitle={
              receipts.length === 1 ? "1 receipt" : `${receipts.length} receipts`
            }
            title="Your certified receipts"
          />

          {receipts.length === 0 ? (
            <Card>
              <EmptyState
                compact
                description="One is issued each time your hostel verifies a payment."
                title="No receipts yet"
              />
            </Card>
          ) : (
            <>
              <Card>
                {receipts.map((receipt, index) => (
                  <View key={receipt.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ReceiptRow receipt={receipt} />
                  </View>
                ))}
              </Card>

              {/*
                Said here as well as on the public page, because this is the
                screen a receipt is downloaded from — which is the moment
                somebody is most likely to re-upload one as proof of payment.
              */}
              <Text className="pt-2" variant="caption">
                A receipt is your hostel&rsquo;s record that they were paid. It cannot
                be uploaded back as proof of a payment — for that, use the
                confirmation from the app or bank you paid with.
              </Text>
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}

/**
 * One month's code, big enough to read off the screen while typing it into a
 * banking app — and copyable, which is the point.
 *
 * Copying matters more here than anywhere else in the app: the code goes into a
 * bank's remarks field on the same phone, and a resident retyping `RUP-4821-K`
 * by eye is how a payment ends up quoting a code that does not validate. The
 * check character catches the typo, but only after the money has moved.
 */
function CodeCard({ invoice }: { invoice: ResidentInvoice }) {
  const { colors } = useAppTheme();
  const [copied, setCopied] = useState(false);
  const code = invoice.referenceCode;

  const copy = useCallback(() => {
    if (!code) {
      return;
    }

    void Haptics.selectionAsync();
    void Clipboard.setStringAsync(code);
    setCopied(true);
    toastSuccess("Reference copied");
  }, [code]);

  if (!code) {
    return null;
  }

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="label">{formatPeriod(invoice.month)}</Text>
          <Text variant="caption">
            {`${formatMoney(outstanding(invoice))} outstanding`}
          </Text>
        </View>
        <StatusPill status={invoice.status} />
      </View>

      <Pressable
        accessibilityHint="Copies the code to your clipboard"
        accessibilityLabel={`Reference ${code}`}
        accessibilityRole="button"
        className="flex-row items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 active:opacity-70"
        onPress={copy}
        style={{ backgroundColor: colors.muted }}
      >
        <Text
          className="flex-1 font-semibold tracking-widest"
          numberOfLines={1}
          style={{ color: colors.primary }}
        >
          {code}
        </Text>
        <Text className="text-primary" variant="caption">
          {copied ? "Copied" : "Copy"}
        </Text>
      </Pressable>
    </Card>
  );
}

/**
 * The receipt number is the title, not the month.
 *
 * There is one receipt per *payment*, so a month somebody part-paid has several
 * and only the number tells them apart — the web's own comment makes the point
 * and it is even more true on a narrow row.
 */
function ReceiptRow({ receipt }: { receipt: CertifiedReceipt }) {
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setBusy(true);

    try {
      /*
        The global downloader — no share sheet, no per-screen spinner, no
        permission prompt; progress goes to the global toaster and the shade.
        `fileName` carries no extension, which `downloadToDevice` appends from
        `extension` after checking the bytes really are a PDF.
      */
      await downloadToDevice({
        extension: "pdf",
        fileName: `receipt-${receipt.number}`,
        label: `Receipt ${receipt.number}`,
        mimeType: "application/pdf",
        url: receiptPdfUrl(receipt.id),
      });
    } catch (caught) {
      toastError("Could not save that receipt", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [receipt.id, receipt.number]);

  return (
    <ListRow
      icon={busy ? "hourglass-outline" : "download-outline"}
      onPress={() => void save()}
      subtitle={[
        formatPeriod(receipt.month),
        formatMoney(receipt.amount),
        receipt.issuedAt ? `issued ${formatDate(receipt.issuedAt)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      title={receipt.number}
    />
  );
}
