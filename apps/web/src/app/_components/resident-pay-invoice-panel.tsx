"use client";

import {
  AlertTriangle,
  Banknote,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  QrCode,
  Smartphone,
  X,
} from "lucide-react";
import { memo, useCallback, useState } from "react";

import { currency, EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { dayMonthYear, daysLeftLabel, monthLabel } from "@/lib/format-month";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { cn } from "@/lib/utils";

/**
 * How to pay one invoice (target §11.1, plan item 3.3).
 *
 * Laid out as a checkout: **methods on the left, an order summary on the
 * right.** The previous single column asked the resident to hold the amount and
 * the reference code in their head while they scrolled down to the QR — and
 * they are typing that code into a banking app on another device, so anything
 * that scrolls off screen is something they have to remember. The summary rail
 * does not move.
 *
 * **The reference code keeps the strongest treatment on the screen.** Everything
 * downstream depends on the resident actually typing it: statement matching,
 * auto-settlement, and the owner's review queue not filling with transfers
 * nobody can attribute. It is large, monospaced, one tap to copy, and it sits in
 * the rail that stays put.
 *
 * **One method is shown at a time.** Six panels of account numbers open at once
 * is how somebody pays the right hostel from the wrong app. Picking a method
 * first mirrors how they already think — "I'll use eSewa" — and means the
 * details on screen are only ever the ones they need.
 *
 * Methods come from the server already ordered and already filtered to the ones
 * the hostel actually configured, so this renders what it is given rather than
 * deciding what counts as a payment method.
 */

type GatewayProviderName = "ESEWA" | "FONEPAY" | "KHALTI";

type PayMethod =
  | { kind: "GATEWAY"; provider: GatewayProviderName; sandbox: boolean }
  | {
      kind: "BANK";
      accountName: string | null;
      accountNumber: string;
      bankName: string | null;
    }
  | { kind: "ESEWA"; id: string }
  | { kind: "KHALTI"; id: string }
  | { kind: "QR"; assetId: string; notice: string | null };

type IntentHandoff =
  | { kind: "REDIRECT"; url: string }
  | { kind: "FORM_POST"; url: string; fields: Record<string, string> }
  | { kind: "QR"; payload: string };

const PROVIDER_LABEL: Record<GatewayProviderName, string> = {
  ESEWA: "eSewa",
  FONEPAY: "Fonepay",
  KHALTI: "Khalti",
};

type PayInstructions = {
  amountDue: number;
  bedLabel: string | null;
  credit: number;
  displayName: string | null;
  dueDate: string | null;
  instructions: string | null;
  invoiceId: string;
  methods: PayMethod[];
  period: string | null;
  referenceCode: string | null;
  status: string;
  tier: "TIER_0" | "TIER_1";
  usable: boolean;
};

/** A stable identity for a method, used as both React key and selection value. */
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

function MethodIcon({ method }: { method: PayMethod }) {
  if (method.kind === "BANK") {
    return <Building2 aria-hidden className="size-4 shrink-0" />;
  }

  if (method.kind === "QR") {
    return <QrCode aria-hidden className="size-4 shrink-0" />;
  }

  return <Smartphone aria-hidden className="size-4 shrink-0" />;
}

function CopyButton({
  label,
  size = "sm",
  value,
}: {
  label: string;
  size?: "lg" | "sm";
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // `writeText` rejects on an insecure origin and in some in-app browsers.
    // Failing silently would leave the resident tapping a button that appears
    // to do nothing, so the label simply does not flip.
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }, [value]);

  return (
    <button
      aria-label={`Copy ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border font-semibold transition",
        copied
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-border hover:bg-muted",
        size === "lg" ? "px-3 py-2 text-[12.5px]" : "px-2.5 py-1.5 text-xs",
      )}
      onClick={copy}
      type="button"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Sends the browser to the provider.
 *
 * A form POST is built and submitted rather than fetched, because the resident's
 * browser has to be the thing that arrives at eSewa — a `fetch` would put *our*
 * server in the session and the payment could never complete. The form is
 * removed either way; a navigation is starting, but a failed one should not
 * leave hidden inputs holding a signature on the page.
 */
function handOff(handoff: IntentHandoff) {
  if (handoff.kind === "REDIRECT") {
    window.location.assign(handoff.url);
    return;
  }

  if (handoff.kind !== "FORM_POST") {
    return;
  }

  const form = document.createElement("form");

  form.action = handoff.url;
  form.method = "POST";
  form.style.display = "none";

  for (const [name, value] of Object.entries(handoff.fields)) {
    const input = document.createElement("input");

    input.name = name;
    input.type = "hidden";
    input.value = value;
    form.append(input);
  }

  document.body.append(form);
  form.submit();
  form.remove();
}

function GatewayPanel({
  amount,
  invoiceId,
  method,
}: {
  amount: number;
  invoiceId: string;
  method: Extract<PayMethod, { kind: "GATEWAY" }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = PROVIDER_LABEL[method.provider];

  const start = useCallback(() => {
    setBusy(true);
    setError("");

    browserApi<{ handoff: IntentHandoff }>(residentEndpoints.checkout(invoiceId), {
      body: JSON.stringify({ provider: method.provider }),
      method: "POST",
    })
      .then((result) => handOff(result.handoff))
      .catch((cause: Error) => {
        // The navigation never started, so the resident is still here and has to
        // be told why rather than left looking at a button that did nothing.
        setError(cause.message || `Could not open ${label}. Please try again.`);
        setBusy(false);
      });
  }, [invoiceId, label, method.provider]);

  return (
    <div className="space-y-3">
      <button
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-role-resident px-4 py-3.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
        disabled={busy}
        onClick={start}
        type="button"
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Smartphone aria-hidden className="size-4" />
        )}
        {busy ? `Opening ${label}…` : `Pay ${currency(amount)} with ${label}`}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        Confirms automatically — no screenshot needed.
      </p>
      {method.sandbox ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/15 p-2.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Test mode — this is a sandbox merchant and moves no real money.
        </p>
      ) : null}
      {error ? (
        <p className="text-center text-xs font-semibold text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

/** One labelled value with its own copy button — an account number, a wallet ID. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-mono text-sm font-semibold text-foreground">
          {value}
        </p>
      </div>
      <CopyButton label={label} value={value} />
    </div>
  );
}

function MethodPanel({
  amount,
  invoiceId,
  method,
}: {
  amount: number;
  invoiceId: string;
  method: PayMethod;
}) {
  if (method.kind === "GATEWAY") {
    return <GatewayPanel amount={amount} invoiceId={invoiceId} method={method} />;
  }

  if (method.kind === "QR") {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- private asset served through our own authorizing route */}
          <img
            alt="Scan to pay"
            className="size-52 max-w-full object-contain"
            src={`/api/v1/files/${method.assetId}/url`}
          />
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <QrCode aria-hidden className="size-3.5" />
            Scan with any payment app
          </span>
        </div>
        {/* A personal wallet's daily cap. Told before they try, because the
            network's rejection afterwards explains nothing. */}
        {method.notice ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/15 p-2.5 text-xs font-semibold leading-4 text-amber-800 dark:text-amber-300">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {method.notice}
          </p>
        ) : null}
      </div>
    );
  }

  if (method.kind === "BANK") {
    return (
      <div className="space-y-2">
        {method.bankName ? (
          <p className="text-sm font-bold text-foreground">{method.bankName}</p>
        ) : null}
        {method.accountName ? (
          <DetailLine label="Account name" value={method.accountName} />
        ) : null}
        <DetailLine label="Account number" value={method.accountNumber} />
      </div>
    );
  }

  const label = method.kind === "ESEWA" ? "eSewa ID" : "Khalti ID";

  return <DetailLine label={label} value={method.id} />;
}

export const ResidentPayInvoicePanel = memo(function ResidentPayInvoicePanel({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const resource = usePortalResource<PayInstructions>(
    residentEndpoints.payInstructions(invoiceId),
    { errorMessage: "Could not load payment instructions." },
  );
  const instructions = resource.data ?? null;
  const [showOthers, setShowOthers] = useState(false);

  const methods = instructions?.methods ?? [];
  // **One primary path, everything else folded away** (target §11.1). The server
  // already ranks the methods — live checkouts, then QR, then wallet ids, then
  // bank — so the primary is simply the one it put first, and no client-side
  // opinion about which method is best can drift out of step with it. At Tier 0
  // that lands on the QR the mockup leads with; at Tier 1 it lands on the
  // gateway, which is the same argument one tier up: the shortest path that
  // settles itself goes on top.
  const primary = methods[0] ?? null;
  const others = methods.slice(1);
  // Needed unless every route on this screen settles itself. Scoping it to the
  // primary would hide the instruction from a resident who opened the fold and
  // paid by bank transfer — the one case where an unreferenced payment costs the
  // owner a manual match.
  const needsReference = methods.some((method) => method.kind !== "GATEWAY");

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h2 className="font-heading text-base font-bold text-foreground">
            Complete your payment
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {instructions?.period
              ? `Rent for ${monthLabel(instructions.period)}`
              : "This invoice"}
          </p>
        </div>
        <button
          aria-label="Close payment instructions"
          className="rounded-lg border border-border p-2 transition hover:bg-muted"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="p-5">
        {resource.state === "loading" ? <LoadingRows /> : null}
        {resource.state === "error" ? (
          <EmptyState label="Payment instructions could not be loaded." />
        ) : null}

        {instructions ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* ── Left: pay with ─────────────────────────────────────── */}
            <div className="min-w-0 space-y-4">
              {instructions.usable ? (
                <>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Pay with</h3>
                    {instructions.displayName ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Paying{" "}
                        <span className="font-semibold text-foreground">
                          {instructions.displayName}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {primary ? (
                    <div className="rounded-xl border-2 border-role-resident/40 bg-role-resident/5 p-4">
                      <MethodPanel
                        amount={instructions.amountDue}
                        invoiceId={instructions.invoiceId}
                        method={primary}
                      />
                    </div>
                  ) : null}

                  {/* Collapsed by default (§11.1). Six panels of account numbers
                      open at once is how somebody pays the right hostel from the
                      wrong app — and the resident who needs the fold already
                      knows they want it, because they came here intending to use
                      their bank. */}
                  {others.length > 0 ? (
                    <div className="rounded-xl border border-border">
                      <button
                        aria-expanded={showOthers}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[12.5px] font-semibold text-foreground"
                        onClick={() => setShowOthers((value) => !value)}
                        type="button"
                      >
                        Other ways to pay
                        <ChevronDown
                          aria-hidden
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            showOthers ? "rotate-180" : "",
                          )}
                        />
                      </button>
                      {showOthers ? (
                        <div className="space-y-4 border-t border-border/60 p-4">
                          {others.map((method) => (
                            <div key={methodKey(method)}>
                              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                <MethodIcon method={method} />
                                {methodLabel(method)}
                              </p>
                              <MethodPanel
                                amount={instructions.amountDue}
                                invoiceId={instructions.invoiceId}
                                method={method}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {instructions.instructions ? (
                    <p className="rounded-xl bg-muted/40 p-3 text-[12.5px] leading-5">
                      {instructions.instructions}
                    </p>
                  ) : null}

                  {/* Scoped to the manual methods on purpose: a gateway payment
                      settles itself, and telling a resident who just paid
                      through one to wait for approval is how they pay twice. */}
                  {needsReference ? (
                    <p className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground">
                      <Banknote aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Once you have paid, close this and tap{" "}
                        <span className="font-semibold text-foreground">
                          I&apos;ve paid — submit proof
                        </span>{" "}
                        so your hostel can confirm it.
                      </span>
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-semibold">
                    Your hostel has not set up online payment details yet.
                  </p>
                  <p className="mt-1 leading-5">
                    Ask them how to pay, then submit your payment screenshot so it
                    still reaches your record.
                  </p>
                </div>
              )}
            </div>

            {/* ── Right: the summary that does not move ──────────────── */}
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-4">
                <div>
                  {/* Above the amount, never below it (§11.1). A credit that
                      surfaces after the resident has read the number is a credit
                      they have already decided to ignore. */}
                  {instructions.credit > 0 ? (
                    <p className="mb-1.5 inline-block rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                      {currency(instructions.credit)} credit applied
                    </p>
                  ) : null}
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Amount to pay
                  </p>
                  <p className="mt-0.5 font-heading text-3xl font-bold text-foreground">
                    {currency(instructions.amountDue)}
                  </p>
                  {/* Next to the amount so they can sanity-check their own bill
                      before paying it — "is this the right rent" is answerable
                      only if the screen says what it is rent for. */}
                  {instructions.bedLabel ? (
                    <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
                      {instructions.bedLabel}
                    </p>
                  ) : null}
                </div>

                <dl className="space-y-1.5 border-t border-border/60 pt-3 text-[12.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Period</dt>
                    <dd className="font-semibold text-foreground">
                      {monthLabel(instructions.period)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Due by</dt>
                    <dd className="text-right font-semibold text-foreground">
                      {dayMonthYear(instructions.dueDate)}
                      {daysLeftLabel(instructions.dueDate) ? (
                        <span className="block text-[11px] font-medium text-muted-foreground">
                          {daysLeftLabel(instructions.dueDate)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                {/* The single most important element on the screen. It stays in
                    the rail so it is still visible while they are typing it into
                    a banking app on another device. */}
                {instructions.referenceCode ? (
                  <div
                    className={cn(
                      "rounded-xl border-2 p-3 transition",
                      needsReference
                        ? "border-role-resident/50 bg-role-resident/5"
                        : "border-border bg-card",
                    )}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {needsReference ? "Put this in the remarks" : "Your reference"}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-xl font-bold tracking-widest text-foreground">
                        {instructions.referenceCode}
                      </span>
                      <CopyButton
                        label="reference code"
                        size="lg"
                        value={instructions.referenceCode}
                      />
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                      {needsReference
                        ? "Without it your hostel has to match the payment by hand, which is slower and sometimes wrong."
                        : `Added automatically when you pay through ${primary ? methodLabel(primary) : "the app"}.`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11.5px] leading-4 text-amber-800 dark:text-amber-300">
                    This invoice has no reference code. Write your full name in the
                    remarks instead, then submit your screenshot so your hostel can
                    match it.
                  </div>
                )}
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </section>
  );
});
