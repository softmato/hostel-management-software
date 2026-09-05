import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { Sheet } from "@/components/ui/sheet";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, FailureState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { hasWalletLogo, WalletMark } from "@/components/ui/wallet-mark";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { openAssetViewer } from "@/lib/asset-viewer";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { planHandoff } from "@/lib/checkout";
import {
  fileAssetUrl,
  getPayInstructions,
  type GatewayProvider,
  type PayInstructions,
  type PayMethod,
  startCheckout,
} from "@/lib/finance-api";
import { formatDueLabel, formatMoney } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { openPaymentUrl } from "@/lib/wallet";

/**
 * How to pay one invoice (target §11.1).
 *
 * **One method at a time.** Six panels of account numbers open at once is how
 * somebody pays the right hostel from the wrong app. The server sends the
 * methods already ordered — live checkouts first, then QR, then wallet ids,
 * then bank — so the primary is simply `methods[0]` and the rest are a list of
 * rows. No client-side opinion about which method is best can drift out of step
 * with the server's.
 *
 * ## The fold became a list of rows, and that is the whole redesign
 *
 * The alternatives lived behind a **disclosure** — a card whose header said
 * "Other ways to pay" with a chevron, which expanded into a column of every
 * remaining method's full panel: bank name, account name, account number, wallet
 * ids, QR, all at once, stacked. Two failures in one control. Closed, it hid the
 * existence of the methods a resident actually uses, so somebody with only a
 * bank account saw one eSewa button and a chevron. Open, it was the six-panels
 * problem the primary card exists to avoid, just one tap deeper.
 *
 * They are `<ListRow>`s now — name, one-line description, chevron — and tapping
 * one opens a **bottom sheet** with that method's details and nothing else.
 * `NOTES.md` §3 is explicit that a menu of destinations is rows or tiles rather
 * than expanded panels, and §6 is explicit that the thing a row opens is a
 * sheet. A resident scanning the list sees every way they *could* pay in one
 * screenful, and reads account numbers for exactly one of them.
 *
 * ## The reference code keeps the strongest treatment on the screen
 *
 * Statement matching, auto-settlement and the owner's review queue staying
 * empty all depend on the resident typing it into a banking app on another
 * device — so it is large, spaced, and one tap to copy.
 *
 * The instruction to submit proof afterwards is scoped to the *manual* methods:
 * a gateway payment settles itself, and telling a resident who just paid
 * through one to wait for approval is how they pay twice.
 *
 * ## No sticky footer
 *
 * It had one saying "I've paid — submit proof", which is a button asserting the
 * past tense on a screen the resident has not acted on yet. Worse, it was the
 * heaviest control on a screen whose actual primary action is the accented
 * button inside the recommended card — two filled greens, one of them wrong.
 * The claim form is reached from the Payments tab and from the invoice's own
 * footer, both of which are screens where "I have already paid" is a true thing
 * to be saying. Here the last word is the note that says when proof is needed.
 *
 * ## Every glyph on this screen is coloured
 *
 * Four `<Ionicons>` here carried **no `color`**, which renders black — so the
 * method icon on the primary card, the disclosure chevron, each folded method's
 * icon and the copy glyph were all invisible on a dark card in dark mode. It is
 * the same fault the Payments tab's statement button had, and the same fix: read
 * the resolved token.
 */

const PROVIDER_LABEL: Record<GatewayProvider, string> = {
  ESEWA: "eSewa",
  FONEPAY: "Fonepay",
  KHALTI: "Khalti",
};

function methodKey(method: PayMethod) {
  return method.kind === "GATEWAY" ? `GATEWAY:${method.provider}` : method.kind;
}

function methodLabel(method: PayMethod) {
  switch (method.kind) {
    case "GATEWAY":
      return PROVIDER_LABEL[method.provider];
    case "BANK":
      return "Bank transfer";
    case "QR":
      return "QR payment";
    case "ESEWA":
      return "eSewa";
    default:
      return "Khalti";
  }
}

/**
 * The one line under a method's name in the list.
 *
 * Says what the resident will *do*, not what the method is — "Scan QR to pay"
 * rather than "QR". A row whose subtitle restates its title is a row with an
 * empty second line, and the reference apps (`NOTES.md` §3) caption every tile
 * with the action rather than the category.
 */
function methodCaption(method: PayMethod) {
  switch (method.kind) {
    case "GATEWAY":
      return `Pay in the ${PROVIDER_LABEL[method.provider]} app`;
    case "BANK":
      return method.bankName ?? "Pay via bank account";
    case "QR":
      return "Scan QR to pay";
    case "ESEWA":
      return "Send to the hostel's eSewa ID";
    default:
      return "Send to the hostel's Khalti ID";
  }
}

/**
 * What `<WalletMark>` should try to find a logo for.
 *
 * A `GATEWAY` carries its provider explicitly and the two wallet-id kinds *are*
 * their provider, so those are enums. A `BANK` hands over **the bank's own
 * name** — `bankName` is free text the owner typed, and matching it is exactly
 * what `resolvePaymentLogoKey` is for; a hostel banking with Everest gets
 * Everest's mark rather than a generic building glyph.
 *
 * `QR` has no brand of its own — a hostel's static QR is whatever their bank or
 * wallet printed — so it keeps its kind and gets the glyph.
 */
function methodProvider(method: PayMethod): string {
  if (method.kind === "GATEWAY") {
    return method.provider;
  }

  if (method.kind === "BANK") {
    return method.bankName ?? method.kind;
  }

  return method.kind;
}

export default function PayInvoiceScreen() {
  const { colors } = useAppTheme();

  const { id } = useLocalSearchParams<{ id: string }>();
  const instructions = useResource<PayInstructions>(
    useCallback(() => getPayInstructions(id), [id]),
  );

  /** Which alternative method's sheet is up, by `methodKey`. */
  const [openMethod, setOpenMethod] = useState<string | null>(null);

  const data = instructions.data;
  const header = <AppBar showBack title="Pay now" />;

  if (instructions.loading) {
    return (
      /* The amount card, the reference, then the recommended and other panels. */
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <Skeleton height={106} radius={16} />
          <Skeleton height={86} radius={16} />
          <Skeleton height={18} width="40%" />
          <Skeleton height={140} radius={16} />
          <Skeleton height={18} width="46%" />
          <Skeleton height={200} radius={16} />
        </View>
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <FailureState
          message={instructions.error ?? "Payment methods could not be loaded."}
          onRetry={instructions.reload}
          title="Couldn't load methods"
        />
      </Screen>
    );
  }

  const primary = data.methods[0] ?? null;
  const others = data.methods.slice(1);
  // Scoped to the whole list, not to the primary: a resident who opened a
  // sheet and paid by bank transfer is exactly the case where a missing
  // reference costs the owner a manual match.
  const needsReference = data.methods.some((method) => method.kind !== "GATEWAY");
  const sheetMethod = others.find((method) => methodKey(method) === openMethod) ?? null;

  return (
    <Screen
      header={header}
      onRefresh={instructions.refresh}
      refreshing={instructions.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <AmountCard instructions={data} />

        {data.referenceCode ? (
          <ReferenceCard code={data.referenceCode} needsReference={needsReference} />
        ) : null}

        {data.usable && primary ? (
          <>
            <View>
              <SectionHeader title="Recommended" />
              <Card className="gap-3">
                {/*
                  The provider's own mark where a generic glyph used to be. On a
                  card whose whole job is "this is who you are about to pay", a
                  `phone-portrait-outline` in our green identified nothing —
                  eSewa and Khalti drew the *same* glyph. `<WalletMark>` falls
                  back to one for a method that has no logo (bank, QR).
                */}
                <View className="flex-row items-center gap-2.5">
                  <WalletMark name={methodProvider(primary)} size={32} />
                  <Text variant="label">{methodLabel(primary)}</Text>
                </View>
                <MethodPanel invoiceId={id} method={primary} />
              </Card>
            </View>

            {others.length > 0 ? (
              <View>
                <SectionHeader title="Other ways to pay" />

                {/*
                  Rows, not an accordion. Each opens a sheet holding one
                  method's details — `NOTES.md` §3 and §6, and the argument in
                  this file's header comment.
                */}
                <Card padding="px-4 py-1">
                  {others.map((method, index) => (
                    <View key={methodKey(method)}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        left={<WalletMark name={methodProvider(method)} size={36} />}
                        onPress={() => setOpenMethod(methodKey(method))}
                        subtitle={methodCaption(method)}
                        title={methodLabel(method)}
                      />
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        ) : (
          /*
            `usable: false` means the hostel has configured no way to be paid at
            all. Not an error and not an empty list — a fact about their setup,
            and the resident's rent is still due. So it says what to do next
            rather than only what is missing, and the claim route stays open:
            money paid in cash at the office still has to reach the record.
          */
          <Card>
            <EmptyState
              action={
                <Button
                  label="I've paid — submit proof"
                  onPress={() => router.push(`/invoice/${id}/claim`)}
                  variant="outline"
                />
              }
              compact
              description="Your hostel has not set up any payment method yet. Ask them how to pay, then submit your receipt so it still reaches your record."
              icon="card-outline"
              title="No payment methods"
              tone="warning"
            />
          </Card>
        )}

        {data.instructions ? (
          <Card>
            <Text variant="muted">{data.instructions}</Text>
          </Card>
        ) : null}

        {/*
          The last word on the screen, and scoped. A gateway checkout settles
          itself; telling somebody who just paid through one to submit a
          screenshot and wait is how they end up paying twice.
        */}
        {needsReference ? (
          <Card className="flex-row items-start gap-2.5">
            <Ionicons color={colors.mutedForeground} name="information-circle-outline" size={16} />
            <Text className="flex-1" variant="caption">
              After payment, submit proof only for manual methods.
            </Text>
          </Card>
        ) : null}
      </View>

      <Sheet
        onClose={() => setOpenMethod(null)}
        open={Boolean(sheetMethod)}
        title={sheetMethod ? methodLabel(sheetMethod) : undefined}
      >
        {sheetMethod ? (
          <View className="gap-3 pb-2">
            {hasWalletLogo(methodProvider(sheetMethod)) ? (
              <WalletMark name={methodProvider(sheetMethod)} size={44} />
            ) : null}
            <MethodPanel invoiceId={id} method={sheetMethod} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/**
 * What is being paid.
 *
 * The screen's whole first question — *how much, for what, and by when* — in the
 * object the eye lands on. A plain card on the page rather than a straddling one
 * on paint: this screen's bar is not accented any more (see `index.tsx` for why
 * a pushed screen's bar says what the screen is rather than what the record is),
 * and a card pulled up onto nothing is a card with a negative margin bug.
 */
function AmountCard({ instructions }: { instructions: PayInstructions }) {
  const dates = useDates();
  const { colors } = useAppTheme();

  const dueLabel = formatDueLabel(instructions.dueDate);
  const late = Boolean(dueLabel?.includes("overdue"));

  return (
    <Card className="gap-1">
      {/*
        Above the amount, never below it. A credit that surfaces after the
        resident has read the number is a credit they have already ignored.
      */}
      {instructions.credit > 0 ? (
        <Badge label={`${formatMoney(instructions.credit)} credit applied`} tone="success" />
      ) : null}

      <Text variant="caption">Amount due</Text>
      <Money size="display" value={instructions.amountDue} />

      {/* So they can sanity-check their own bill: "is this the right rent" is
          only answerable if the screen says what it is rent for. */}
      {instructions.bedLabel ? (
        <Text variant="muted">{instructions.bedLabel}</Text>
      ) : null}

      {/*
        The overdue tone is a resolved colour, not `text-destructive` through
        `className`.

        `variant="caption"` already carries `text-muted-foreground`; both rules
        reach the compiled stylesheet and which one wins is decided by
        generation order, not by where it sat in the string. The caption won, so
        "1 day overdue" shipped in the same grey as the date beside it — the
        same trap `<AppBar>`'s `ink` and `<Card>`'s `padding` document, and the
        reason this file's own glyphs read `colors.*`.
      */}
      {instructions.dueDate ? (
        <Text
          style={late ? { color: colors.destructive } : undefined}
          variant="caption"
        >
          {`Due date: ${dates.dateBoth(instructions.dueDate)}${dueLabel ? ` · ${dueLabel}` : ""}`}
        </Text>
      ) : null}
    </Card>
  );
}

function ReferenceCard({
  code,
  needsReference,
}: {
  code: string;
  needsReference: boolean;
}) {
  return (
    <Card className="gap-2">
      <Text variant="caption">
        {needsReference ? "PUT THIS IN THE REMARKS" : "YOUR REFERENCE"}
      </Text>

      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-2xl font-semibold tracking-widest text-foreground">
          {code}
        </Text>
        <CopyButton label="reference code" value={code} />
      </View>

      <Text variant="caption">
        {needsReference
          ? "Payments carrying it are confirmed faster. Without it your hostel has to match the payment by hand, which is slower and sometimes wrong."
          : "Added automatically when you pay through the app."}
      </Text>
    </Card>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`Copy ${label}`}
      accessibilityRole="button"
      className="flex-row items-center gap-1.5 rounded-lg border border-border px-3 py-2 active:opacity-70"
      onPress={() => {
        void Clipboard.setStringAsync(value);
        toastSuccess("Copied");
      }}
    >
      <Ionicons color={colors.mutedForeground} name="copy-outline" size={14} />
      <Text variant="caption">Copy</Text>
    </Pressable>
  );
}

/** One labelled value with its own copy button — an account number, a wallet id. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
      <View className="flex-1">
        <Text variant="caption">{label}</Text>
        <Text numberOfLines={1} variant="label">
          {value}
        </Text>
      </View>
      <CopyButton label={label} value={value} />
    </View>
  );
}

function MethodPanel({ invoiceId, method }: { invoiceId: string; method: PayMethod }) {
  if (method.kind === "GATEWAY") {
    return <GatewayPanel invoiceId={invoiceId} method={method} />;
  }

  if (method.kind === "QR") {
    return <QrPanel method={method} />;
  }

  if (method.kind === "BANK") {
    return (
      <View className="gap-2">
        {method.bankName ? <Text variant="label">{method.bankName}</Text> : null}
        {method.accountName ? (
          <DetailLine label="Account name" value={method.accountName} />
        ) : null}
        <DetailLine label="Account number" value={method.accountNumber} />
      </View>
    );
  }

  return (
    <DetailLine
      label={method.kind === "ESEWA" ? "eSewa ID" : "Khalti ID"}
      value={method.id}
    />
  );
}

/**
 * The hostel's static QR.
 *
 * Served through our own authorising route, so the bearer token has to ride on
 * the request — `expo-image` takes headers, a bare `<Image src>` does not.
 */
function QrPanel({ method }: { method: Extract<PayMethod, { kind: "QR" }> }) {
  const token = useAppSelector((state) => state.auth.accessToken);
  const { colors } = useAppTheme();

  return (
    <View className="gap-3">
      <View className="items-center gap-2 rounded-xl border border-border p-4">
        {/*
          Tappable, because 208dp of QR is scanned by *another* phone held over
          this one — and a code that will not resolve at arm's length is a
          payment that does not happen. Full-screen is the whole screen's width.
        */}
        <Pressable
          accessibilityHint="Opens the code full screen"
          accessibilityLabel="Scan to pay"
          accessibilityRole="imagebutton"
          className="active:opacity-80"
          onPress={() =>
            openAssetViewer([
              {
                assetId: method.assetId,
                caption: "Scan with any payment app",
                title: "Pay by QR",
              },
            ])
          }
        >
          <Image
            contentFit="contain"
            source={{
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              uri: fileAssetUrl(method.assetId),
            }}
            style={{ backgroundColor: colors.card, height: 208, width: 208 }}
          />
        </Pressable>
        <Text variant="caption">Scan with any payment app</Text>
      </View>

      {/* A personal wallet's daily cap, said before they try — the network's
          rejection afterwards explains nothing. */}
      {method.notice ? (
        <View className="rounded-xl bg-warning-soft p-3">
          <Text className="text-warning" variant="caption">
            {method.notice}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Starts a live checkout and hands the resident to the provider.
 *
 * Every provider the server offers can be opened: a `REDIRECT` goes straight to
 * the wallet, and a `FORM_POST` — eSewa — goes through the server's `/pay`
 * relay, which is the only place the signature can be rebuilt. A handoff kind
 * this build does not recognise is reported *here*, after the intent exists but
 * before the resident thinks they have paid.
 */
function GatewayPanel({
  invoiceId,
  method,
}: {
  invoiceId: string;
  method: Extract<PayMethod, { kind: "GATEWAY" }>;
}) {
  const [busy, setBusy] = useState(false);
  const label = PROVIDER_LABEL[method.provider];

  const start = useCallback(async () => {
    setBusy(true);

    try {
      const intent = await startCheckout(invoiceId, method.provider);
      /*
       * The reference, not the signed fields, is what identifies this attempt
       * to the relay page — the server rebuilds the signature from the stored
       * intent, so nothing secret travels through a URL.
       */
      const plan = planHandoff(intent.handoff, {
        baseUrl: API_BASE_URL,
        reference: intent.reference,
      });

      if (plan.kind === "OPEN_URL") {
        /*
         * Handed to the OS, so the wallet's own app takes it when installed —
         * it already holds the session, the balance and the biometric unlock
         * that a web form makes the resident re-enter. See `lib/wallet.ts`.
         *
         * Not awaited-then-trusted: the status screen is pushed either way and
         * asks the provider, because leaving for the app and coming back is no
         * more evidence of payment than a browser closing was.
         */
        router.push(`/checkout/${encodeURIComponent(intent.reference)}`);
        await openPaymentUrl(plan.url);
        return;
      }

      if (plan.kind === "SHOW_QR") {
        router.push(`/checkout/${encodeURIComponent(intent.reference)}`);
        return;
      }

      toastError(`${label} isn't available here yet`, plan.reason);
    } catch (caught) {
      toastError(`Could not open ${label}`, readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [invoiceId, label, method.provider]);

  return (
    <View className="gap-2">
      <Text variant="muted">{`Pay securely via ${label}.`}</Text>

      <Button
        label={busy ? `Opening ${label}…` : `Pay with ${label}`}
        loading={busy}
        onPress={() => void start()}
      />

      <Text className="text-center" variant="caption">
        Opens the {label} app if you have it. Confirms automatically — no screenshot
        needed.
      </Text>

      {method.sandbox ? (
        <View className="rounded-xl bg-warning-soft p-2.5">
          <Text className="text-warning" variant="caption">
            Test mode — this is a sandbox merchant and moves no real money.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
