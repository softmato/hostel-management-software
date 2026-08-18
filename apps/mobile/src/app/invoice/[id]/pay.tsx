import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
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
import { formatDateBoth, formatDueLabel, formatMoney, formatPeriod } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { openPaymentUrl } from "@/lib/wallet";

/**
 * How to pay one invoice (target §11.1).
 *
 * **One method at a time.** Six panels of account numbers open at once is how
 * somebody pays the right hostel from the wrong app. The server sends the
 * methods already ordered — live checkouts first, then QR, then wallet ids,
 * then bank — so the primary is simply `methods[0]` and the rest fold away. No
 * client-side opinion about which method is best can drift out of step with the
 * server's.
 *
 * **The reference code keeps the strongest treatment on the screen.**
 * Statement matching, auto-settlement and the owner's review queue staying
 * empty all depend on the resident typing it into a banking app on another
 * device — so it is large, spaced, and one tap to copy.
 *
 * The instruction to submit proof afterwards is scoped to the *manual* methods:
 * a gateway payment settles itself, and telling a resident who just paid
 * through one to wait for approval is how they pay twice.
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
      return "Scan QR";
    case "ESEWA":
      return "eSewa";
    default:
      return "Khalti";
  }
}

function methodIcon(method: PayMethod): keyof typeof Ionicons.glyphMap {
  if (method.kind === "BANK") return "business-outline";
  if (method.kind === "QR") return "qr-code-outline";

  return "phone-portrait-outline";
}

export default function PayInvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const instructions = useResource<PayInstructions>(
    useCallback(() => getPayInstructions(id), [id]),
  );
  const [showOthers, setShowOthers] = useState(false);

  const data = instructions.data;
  const header = (
    <AppBar
      showBack
      subtitle={data?.period ? `Rent for ${formatPeriod(data.period)}` : undefined}
      title="Complete your payment"
    />
  );

  if (instructions.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading payment details" />
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={instructions.error ?? "Payment instructions could not be loaded."}
          onRetry={instructions.reload}
        />
      </Screen>
    );
  }

  const primary = data.methods[0] ?? null;
  const others = data.methods.slice(1);
  // Scoped to the whole list, not to the primary: a resident who opened the
  // fold and paid by bank transfer is exactly the case where a missing
  // reference costs the owner a manual match.
  const needsReference = data.methods.some((method) => method.kind !== "GATEWAY");

  return (
    <Screen
      footer={
        needsReference ? (
          <Button
            label="I've paid — submit proof"
            onPress={() => router.push(`/invoice/${id}/claim`)}
          />
        ) : undefined
      }
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
          <View className="gap-3">
            <Text variant="label">
              {data.displayName ? `Paying ${data.displayName}` : "Pay with"}
            </Text>

            <Card className="gap-3 border-2 border-primary/40">
              <View className="flex-row items-center gap-2">
                <Ionicons name={methodIcon(primary)} size={16} />
                <Text variant="label">{methodLabel(primary)}</Text>
              </View>
              <MethodPanel invoiceId={id} method={primary} />
            </Card>

            {others.length > 0 ? (
              <Card>
                <Pressable
                  accessibilityRole="button"
                  className="min-h-12 flex-row items-center justify-between active:opacity-70"
                  onPress={() => setShowOthers((value) => !value)}
                >
                  <Text variant="label">Other ways to pay</Text>
                  <Ionicons name={showOthers ? "chevron-up" : "chevron-down"} size={18} />
                </Pressable>

                {showOthers ? (
                  <View className="gap-5 border-t border-border pt-4">
                    {others.map((method) => (
                      <View className="gap-2" key={methodKey(method)}>
                        <View className="flex-row items-center gap-2">
                          <Ionicons name={methodIcon(method)} size={14} />
                          <Text variant="caption">{methodLabel(method)}</Text>
                        </View>
                        <MethodPanel invoiceId={id} method={method} />
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            ) : null}
          </View>
        ) : (
          <Card className="gap-1 bg-warning-soft">
            <Text className="text-warning" variant="label">
              Your hostel has not set up online payment details yet.
            </Text>
            <Text variant="muted">
              Ask them how to pay, then submit your payment screenshot so it still
              reaches your record.
            </Text>
          </Card>
        )}

        {data.instructions ? (
          <Card>
            <Text variant="muted">{data.instructions}</Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

function AmountCard({ instructions }: { instructions: PayInstructions }) {
  const dueLabel = formatDueLabel(instructions.dueDate);

  return (
    <Card className="gap-2">
      {/*
        Above the amount, never below it. A credit that surfaces after the
        resident has read the number is a credit they have already ignored.
      */}
      {instructions.credit > 0 ? (
        <Badge label={`${formatMoney(instructions.credit)} credit applied`} tone="success" />
      ) : null}

      <Text variant="caption">Amount to pay</Text>
      <Money size="display" value={instructions.amountDue} />

      {/* So they can sanity-check their own bill: "is this the right rent" is
          only answerable if the screen says what it is rent for. */}
      {instructions.bedLabel ? (
        <Text variant="muted">{instructions.bedLabel}</Text>
      ) : null}

      {instructions.dueDate ? (
        <Text variant="caption">
          {`Due ${formatDateBoth(instructions.dueDate)}${dueLabel ? ` · ${dueLabel}` : ""}`}
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
    <Card className={`gap-2 ${needsReference ? "border-2 border-primary/50" : ""}`}>
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
      <Ionicons name="copy-outline" size={14} />
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
