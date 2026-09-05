import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import {
  FLOAT_SHADOW,
  PaintedAmount,
  usePortalPaint,
} from "@/components/portal-shared";
import { copyReference } from "@/components/resident-payments";
import { AppBar } from "@/components/ui/app-bar";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { downloadToDevice } from "@/lib/documents";
import {
  getFinanceView,
  receiptPdfUrl,
  type ResidentFinanceView,
  type ResidentInvoice,
} from "@/lib/finance-api";
import { formatMoney } from "@/lib/format";
import { oneOffLabel } from "@/lib/invoice-ledger";
import {
  activeCodes,
  type CertifiedReceipt,
  certifiedReceipts,
  offerProgramStats,
} from "@/lib/offer-program";
import { toastError } from "@/lib/toast";

/**
 * Certified receipts — the resident's own view of the Offer Program.
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
 * ## The screen is named after what people come here for
 *
 * It was titled `Offer Program`, which is the *scheme's* name and not the
 * object anybody is looking for. A resident opening this screen wants a receipt
 * — for a landlord, a visa application, a parent — and "Offer Program" is a
 * phrase they would have to have learnt in order to know it is where receipts
 * live. The bar says `Certified receipts` and the Payments tab's door says the
 * same thing, so the label a person taps is the label of the place they land.
 *
 * ## Three tiles became two facts
 *
 * A `<Grid>` of three `<StatTile>`s stood above the codes: `Certified` (a
 * count), `Amount` (a total) and `In review` (another count). Two of the three
 * were counts of rows that were already listed below them, which is a metric
 * strip counting a list on the same screen as the list.
 *
 * What survives is the one comparison a resident cannot make for themselves:
 * **matched & verified** against **total paid**. The gap between those two
 * numbers is money they have handed over that has no receipt behind it, and it
 * is the only thing on this screen that could prompt them to go and chase
 * something.
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

/** Matches the Payments tab's card and the invoice header's block. */
const STRADDLE = 22;

export default function MyOfferProgramScreen() {
  const finance = useResource<ResidentFinanceView>(
    useCallback(() => getFinanceView(), []),
    { topics: [REALTIME_TOPIC.PAYMENTS] },
  );

  const header = <AppBar showBack title="Certified receipts" />;

  if (finance.loading) {
    return (
      <Screen header={header} padded={false} scroll>
        <View className="px-5">
          <Skeleton height={96} radius={20} />
        </View>

        <View className="px-5" style={{ marginTop: -STRADDLE }}>
          <Skeleton height={132} radius={18} />
        </View>

        <View className="gap-3 px-5 pt-6">
          <Skeleton height={18} width="34%" />
          <SkeletonCard rows={3} />
        </View>
      </Screen>
    );
  }

  if (finance.error || !finance.data) {
    return (
      <Screen header={header}>
        <FailureState
          message={finance.error ?? "Your receipts could not be loaded."}
          onRetry={finance.reload}
          title="Couldn't load receipts"
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
      padded={false}
      refreshing={finance.refreshing}
      scroll
    >
      <ActiveCodesBlock codes={codes} />

      <TotalsCard certified={stats.certifiedAmount} paid={stats.totalPaid} />

      <View className="gap-5 px-5 pt-6">
        <View>
          <SectionHeader
            subtitle={receipts.length === 1 ? "1 receipt" : `${receipts.length} receipts`}
            title="Receipts"
          />

          {receipts.length === 0 ? (
            <Card>
              <EmptyState
                compact
                description="Receipts will appear here after payments are verified."
                icon="receipt-outline"
                title="No receipts yet"
              />
            </Card>
          ) : (
            <Card padding="px-4 py-1">
              {receipts.map((receipt, index) => (
                <View key={receipt.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ReceiptRow receipt={receipt} />
                </View>
              ))}
            </Card>
          )}
        </View>

        {/*
          Two facts about receipts that a resident only needs at the moment they
          are holding one, which is this screen and nowhere else.

          The second is said here as well as on the public page, because this is
          where a receipt is downloaded from — and that is the moment somebody is
          most likely to try re-uploading one as proof of a payment.
        */}
        <Card className="gap-2">
          <Text variant="caption">
            Receipts are issued only for matched and verified payments.
          </Text>
          <Text variant="caption">
            A receipt is your hostel&rsquo;s record that they were paid. It cannot be
            uploaded back as proof of a payment — for that, use the confirmation from
            the app or bank you paid with.
          </Text>
        </Card>

        <Pressable
          accessibilityRole="button"
          className="self-start active:opacity-60"
          hitSlop={8}
          onPress={() => router.push("/offer-program")}
        >
          <Text className="text-primary" variant="label">
            Programme rules
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/**
 * The codes still worth quoting, painted.
 *
 * ## Why the codes are the header
 *
 * They were a `<SectionHeader>` and a stack of `<CodeCard>`s two thirds of the
 * way down, under three metric tiles and a paragraph about the programme. That
 * is the wrong depth for the one string on this screen somebody might be
 * copying while a banking app is open in front of them.
 *
 * On the paint they are the first thing read, and the block is the same object
 * the invoice detail screen uses for its identity — a bled accent panel with
 * rounded bottom corners and a card straddling it (`NOTES.md` §1). The three
 * payments screens now share one chrome.
 *
 * ## Every code copies on tap
 *
 * Copying matters more here than anywhere else in the app: the code goes into a
 * bank's remarks field on the same phone, and a resident retyping `RUP-4821-K`
 * by eye is how a payment ends up quoting a code that does not validate. The
 * check character catches the typo, but only after the money has moved.
 *
 * A resident two months behind has two live codes, so this is a list rather
 * than a single value — but the common case is one, and the common case gets
 * the whole width.
 */
function ActiveCodesBlock({ codes }: { codes: ResidentInvoice[] }) {
  const paint = usePortalPaint();

  return (
    <LinearGradient
      colors={[paint.from, paint.to]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={{
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        overflow: "hidden",
      }}
    >
      <View className="absolute inset-0" style={{ pointerEvents: "none" }}>
        <View
          className="absolute rounded-full bg-white/10"
          style={{ height: 140, right: -50, top: -70, width: 140 }}
        />
      </View>

      <View className="gap-2 px-5 pt-4" style={{ paddingBottom: STRADDLE + 14 }}>
        <Text
          className="font-semibold uppercase tracking-wider"
          numberOfLines={1}
          style={{ color: "rgba(255,255,255,0.7)", fontSize: 10 }}
        >
          {codes.length === 1 ? "Active reference code" : "Active reference codes"}
        </Text>

        {codes.length === 0 ? (
          /*
            Not an empty state with a disc and a heading — this is a header, and
            a header that grows a 56-point circle when a resident is paid up is
            a header that changes height for good news. One line, same slot.
          */
          <Text style={{ color: "rgba(255,255,255,0.88)", fontSize: 14 }}>
            Nothing is due right now, so there is no code to quote.
          </Text>
        ) : (
          codes.map((invoice) => <CodeLine invoice={invoice} key={invoice.id} />)
        )}
      </View>
    </LinearGradient>
  );
}

function CodeLine({ invoice }: { invoice: ResidentInvoice }) {
  const dates = useDates();

  const code = invoice.referenceCode;

  if (!code) {
    return null;
  }

  return (
    <Pressable
      accessibilityHint="Copies the code to your clipboard"
      accessibilityLabel={`Reference ${code}`}
      accessibilityRole="button"
      className="flex-row items-center gap-3 active:opacity-70"
      hitSlop={6}
      onPress={() => copyReference(code)}
    >
      <View className="flex-1 gap-0.5">
        <PaintedAmount size={22} value={code} />
        <Text
          numberOfLines={1}
          style={{ color: "rgba(255,255,255,0.72)", fontSize: 11 }}
        >
          {`For ${oneOffLabel(invoice) ?? dates.period(invoice.month)}`}
        </Text>
      </View>

      <Ionicons color="rgba(255,255,255,0.9)" name="copy-outline" size={20} />
    </Pressable>
  );
}

/**
 * Matched and verified, against everything paid.
 *
 * Two figures, one above the other with a rule between, and the certified one
 * leading in the success tone — it is the number the screen is named after. The
 * caption under each says what it counts, because "Rs 9,000" and "Rs 10,200" on
 * one card with no explanation is an invitation to assume the difference is a
 * mistake.
 */
function TotalsCard({ certified, paid }: { certified: number; paid: number }) {
  return (
    <View className="px-5" style={{ marginTop: -STRADDLE }}>
      <View
        className="gap-3 rounded-[18px] border border-border bg-card p-4"
        style={FLOAT_SHADOW}
      >
        <View className="gap-0.5">
          <Text variant="caption">Matched &amp; verified</Text>
          <Text className="text-success" variant="title">
            {formatMoney(certified)}
          </Text>
          <Text variant="caption">Total matched payments</Text>
        </View>

        <View className="gap-0.5 border-t border-border pt-3">
          <Text variant="caption">Total paid</Text>
          <Text variant="label">{formatMoney(paid)}</Text>
          <Text variant="caption">Includes unverified &amp; pending</Text>
        </View>
      </View>
    </View>
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
  const dates = useDates();
  const { colors } = useAppTheme();

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
      onPress={() => void save()}
      right={
        /*
          The download glyph on the right, where the chevron would be. A
          `<ListRow>` draws its own chevron for a row that navigates, and this
          row does not navigate — it produces a file. An arrow pointing right on
          a row that opens nothing is the wrong promise.
        */
        <Ionicons
          color={busy ? colors.mutedForeground : colors.primary}
          name={busy ? "hourglass-outline" : "download-outline"}
          size={20}
        />
      }
      subtitle={
        [
          formatMoney(receipt.amount),
          receipt.issuedAt ? dates.date(receipt.issuedAt) : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      title={`#${receipt.number.replace(/^#/, "")}`}
    />
  );
}
