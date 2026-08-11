"use client";

import {
  AlertTriangle,
  Banknote,
  Building2,
  Check,
  Copy,
  HelpCircle,
  ReceiptText,
  Upload,
  WalletCards,
  XCircle,
} from "lucide-react";
import { memo, useCallback, useState, type FormEvent } from "react";

import { currency, Input as FormInput } from "@/app/_components/shared-ui";
import { FileUploaderView, useUploader } from "@/components/uploads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, browserApi } from "@/lib/browser-api";
import { dayMonthYear, monthLabel } from "@/lib/format-month";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { cn } from "@/lib/utils";
import { field, optionalField } from "./resident-shared";
import { RoleButton, SectionCard } from "./portal-dashboard-ui";

/**
 * "I've paid — submit proof" (target §11.2, §11.3; plan item 3.4).
 *
 * Lifted out of the payments page once it stopped being a form and became a
 * screen: it now carries the reference code, a per-method guide to finding a
 * transaction id, and the two instant rejections — and none of that is about the
 * list of months it used to sit under.
 *
 * Three things carry the design:
 *
 * - **The amount is pre-filled** (§11.2). Most people pay exactly what is owed,
 *   and a typed amount is a mismatch waiting to happen. Still editable, because
 *   part payments are legitimate.
 * - **The reference code is on the form, not just on the pay screen.** By the
 *   time a resident is here they have left our screen, paid in another app, and
 *   come back — and the checkbox asking whether they used the code is the last
 *   moment anyone can catch a transfer that will land unattributable.
 * - **Rejections are a card, not a line of grey text** (§11.3). A duplicate
 *   screenshot is the single most common failed submission, and "it was
 *   submitted on 2 Jul for July rent" is the difference between a resident who
 *   goes and finds the right one and a support message.
 */

const METHODS = [
  { icon: WalletCards, label: "eSewa", value: "ESEWA" },
  { icon: WalletCards, label: "Khalti", value: "KHALTI" },
  { icon: WalletCards, label: "Fonepay", value: "FONEPAY" },
  { icon: Building2, label: "Bank", value: "BANK_TRANSFER" },
  { icon: Banknote, label: "Cash", value: "CASH" },
  { icon: ReceiptText, label: "Other", value: "OTHER" },
] as const;

/**
 * Where the transaction id actually is, per app (§11.2's `show me where`).
 *
 * The mockup calls for an annotated screenshot of each provider's history with
 * the id circled, and notes it would cut support load more than anything else on
 * the screen. Those images do not exist yet, so this is the same navigation
 * written out — it is the part that goes stale slowest, and it can ship today.
 * When the annotated images land they belong here, above the steps.
 */
const WHERE_TO_LOOK: Record<string, string[]> = {
  BANK_TRANSFER: [
    "Open your bank's app and go to your statement or transaction history.",
    "Tap the transfer you just made.",
    "The ID is the long number labelled Reference No, Transaction ID or RRN.",
  ],
  ESEWA: [
    "Open eSewa and tap the menu, then Transaction History.",
    "Tap the payment you just made.",
    "The ID sits at the top, labelled Transaction Code — it looks like 8823119471.",
  ],
  FONEPAY: [
    "Open the app you scanned the QR with and find its transaction history.",
    "Tap the payment you just made.",
    "Use the number labelled Transaction ID, Trace ID or Reference.",
  ],
  KHALTI: [
    "Open Khalti and tap Transactions at the bottom.",
    "Tap the payment you just made.",
    "The ID is shown as Transaction ID or Purchase Order ID.",
  ],
  OTHER: [
    "Find the payment in whatever app or receipt you paid with.",
    "Use whichever number it calls a transaction, reference or receipt ID.",
  ],
};

type PayInstructions = {
  bedLabel: string | null;
  referenceCode: string | null;
};

/**
 * An instant rejection (§11.3).
 *
 * These never reach the owner's queue, so this screen is the only place the
 * resident learns anything — which is why it says what collided and when, and
 * leaves them on a form they can correct rather than sending them back a step.
 */
type Rejection = {
  detail: string;
  title: string;
};

/**
 * Turns the server's error into the card, or into null when it is an ordinary
 * failure that belongs in the page's message line.
 *
 * Branching on `errorCode`, never on the message text: the codes are the stable
 * contract (§5.1) and the copy is not.
 */
function rejectionFrom(error: unknown): Rejection | null {
  if (!(error instanceof ApiRequestError)) {
    return null;
  }

  const details = (error.details ?? {}) as {
    priorPeriod?: string | null;
    priorSubmittedAt?: string | null;
    transactionCode?: string | null;
  };
  const when = details.priorSubmittedAt
    ? `It was submitted on ${dayMonthYear(details.priorSubmittedAt)}`
    : "It was already submitted";
  const forWhat = details.priorPeriod
    ? ` for ${monthLabel(details.priorPeriod)} rent.`
    : ".";

  if (error.errorCode === "EVIDENCE_ALREADY_USED") {
    return {
      detail: `${when}${forWhat} Please upload the screenshot for THIS payment. If you think this is a mistake, contact your hostel admin.`,
      title: "This screenshot was already used",
    };
  }

  if (error.errorCode === "TXN_ID_ALREADY_CLAIMED") {
    return {
      detail: `${details.transactionCode ?? "That ID"} was ${
        details.priorPeriod ? `used for ${monthLabel(details.priorPeriod)} rent` : "already recorded"
      }. Each payment has its own ID.`,
      title: "Transaction ID already recorded",
    };
  }

  return null;
}

function ReferenceCheck({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }, [code]);

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      {/* Informational, not a gate (§11.2). A resident who forgot the code has
          still paid, and blocking the claim would leave real money with no way
          to be reported — it costs the owner a manual match, which is exactly
          what the owner's queue is for. */}
      <label className="flex items-start gap-2.5 text-[12.5px] leading-5 text-foreground">
        <input
          className="mt-0.5 size-4 shrink-0 accent-role-resident"
          name="referenceUsed"
          type="checkbox"
        />
        <span>
          I entered{" "}
          <span className="font-mono font-bold tracking-wide">{code}</span> in the
          remarks
        </span>
      </label>
      <div className="mt-2 flex items-center justify-between gap-2 pl-6">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Did not use it? Submit anyway — your hostel will match it by hand.
        </p>
        <button
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition",
            copied
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border hover:bg-muted",
          )}
          onClick={copy}
          type="button"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export const ResidentClaimForm = memo(function ResidentClaimForm({
  invoiceId,
  month,
  onCancel,
  onSubmitted,
  outstanding,
}: {
  invoiceId: string;
  month: string;
  onCancel: () => void;
  onSubmitted: (message: string) => void;
  outstanding: number;
}) {
  const [method, setMethod] = useState<string>("ESEWA");
  const [showWhere, setShowWhere] = useState(false);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [error, setError] = useState("");
  // The same endpoint the pay screen reads, for the same invoice — so the code
  // on this form cannot disagree with the one they were just shown.
  const instructions = usePortalResource<PayInstructions>(
    residentEndpoints.payInstructions(invoiceId),
    { errorMessage: "" },
  );
  const referenceCode = instructions.data?.referenceCode ?? "";
  // Progress and upload errors surface in the global toaster; this only holds
  // the resulting asset id for the form submit.
  const proofUpload = useUploader({
    accept: "image/jpeg,image/png,image/webp,application/pdf",
    accessLevel: "PRIVATE",
    assetKind: "PAYMENT_PROOF",
    kind: "document",
    label: "Payment proof",
    optimizeImage: true,
  });
  const proofAssetId = proofUpload.files[0]?.assetId ?? "";
  const { clear: clearProof } = proofUpload;

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

      if (!proofAssetId) {
        setError("Please upload a proof image first.");
        return;
      }

      setError("");
      setRejection(null);

      try {
        await browserApi(`${residentEndpoints.payments}/${invoiceId}/claims`, {
          body: JSON.stringify({
            amount: Number(field(form, "amount")),
            paymentMethod: method,
            proofImageAssetId: proofAssetId,
            referenceNote: optionalField(form, "referenceNote"),
            transactionCode: optionalField(form, "transactionCode"),
          }),
          method: "POST",
        });
        formElement.reset();
        clearProof();
        onSubmitted(
          "Proof submitted. Your hostel will confirm it and email you a receipt.",
        );
      } catch (cause) {
        const instant = rejectionFrom(cause);

        if (instant) {
          // The screenshot is the thing that has to change, so it goes — the
          // resident is one upload away from a valid claim rather than back at
          // the start of the form.
          clearProof();
          setRejection(instant);
          return;
        }

        setError(cause instanceof Error ? cause.message : "Could not submit proof.");
      }
    },
    [clearProof, invoiceId, method, onSubmitted, proofAssetId],
  );

  if (rejection) {
    return (
      <SectionCard title="Submit payment proof">
        <div className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-4">
          <p className="flex items-center gap-2 font-heading text-base font-bold text-destructive">
            <XCircle aria-hidden className="size-5 shrink-0" />
            {rejection.title}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-foreground">
            {rejection.detail}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <RoleButton onClick={() => setRejection(null)} tone="resident" type="button">
              Try again
            </RoleButton>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </SectionCard>
    );
  }

  const steps = WHERE_TO_LOOK[method] ?? WHERE_TO_LOOK.OTHER;

  return (
    <SectionCard
      actions={
        <Button
          className="h-8 rounded-lg"
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      }
      description={`For ${monthLabel(month)} · ${currency(outstanding)} outstanding${
        instructions.data?.bedLabel ? ` · ${instructions.data.bedLabel}` : ""
      }`}
      title="Submit payment proof"
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <label className="text-sm font-semibold text-foreground">
            Screenshot or receipt
          </label>
          <FileUploaderView
            label="Upload receipt"
            size="lg"
            tone="resident"
            uploader={proofUpload}
          />
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold text-foreground">
            How did you pay?
          </legend>
          {/* Chips, not a dropdown: six options that fit on screen are a
              choice, and a `<select>` hides five of them behind a tap. */}
          <div className="flex flex-wrap gap-2">
            {METHODS.map((option) => (
              <button
                aria-pressed={method === option.value}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition",
                  method === option.value
                    ? "border-role-resident bg-role-resident/10 text-role-resident"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
                key={option.value}
                onClick={() => {
                  setMethod(option.value);
                  setShowWhere(false);
                }}
                type="button"
              >
                <option.icon className="size-3.5" />
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Pre-filled with what is owed (§11.2). Still editable — part
              payments are legitimate and common — but the default is the
              number that will not trip the amount check. */}
          <FormInput
            defaultValue={outstanding || undefined}
            key={invoiceId}
            label="Amount paid (NPR)"
            min="1"
            name="amount"
            required
            step="0.01"
            type="number"
          />
          <div>
            <FormInput
              label={
                method === "CASH" ? "Who did you give the cash to?" : "Transaction ID"
              }
              name="transactionCode"
              required={method !== "CASH"}
            />
            {/* Cash has no transaction id to hunt for, so the helper would be
                pointing at a screen that does not exist. */}
            {method === "CASH" ? null : (
              <button
                aria-expanded={showWhere}
                className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-role-resident underline-offset-2 hover:underline"
                onClick={() => setShowWhere((value) => !value)}
                type="button"
              >
                <HelpCircle aria-hidden className="size-3.5" />
                Show me where to find this
              </button>
            )}
          </div>
        </div>

        {showWhere && method !== "CASH" ? (
          <ol className="grid list-decimal gap-1.5 rounded-xl border border-border bg-muted/20 py-3 pl-9 pr-4 text-[12.5px] leading-5 text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}

        {referenceCode ? <ReferenceCheck code={referenceCode} /> : null}

        <div className="grid gap-1.5">
          <label className="text-sm font-semibold text-foreground">
            Anything your hostel should know? (optional)
          </label>
          <Textarea
            className="min-h-20 rounded-xl"
            maxLength={200}
            name="referenceNote"
            placeholder="Paid from my brother's eSewa, etc."
          />
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/15 p-3 text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <RoleButton
          className="w-full sm:w-auto"
          disabled={proofUpload.isUploading || !proofAssetId}
          tone="resident"
          type="submit"
        >
          <Upload className="size-4" />
          Submit
        </RoleButton>
      </form>
    </SectionCard>
  );
});
