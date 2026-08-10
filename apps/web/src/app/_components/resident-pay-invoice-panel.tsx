"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Loader2,
  QrCode,
  Smartphone,
  X,
} from "lucide-react";
import { memo, useCallback, useState } from "react";

import { currency, EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { SectionCard } from "@/app/_components/portal-dashboard-ui";
import { browserApi } from "@/lib/browser-api";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";

/**
 * How to pay one invoice (target §11.1, plan item 3.3).
 *
 * **The reference code gets the strongest treatment on the screen**, because
 * everything downstream depends on the resident actually typing it: statement
 * matching (Block 4), auto-settlement, and the owner's review queue not filling
 * with transfers nobody can attribute. It is large, monospaced, and one tap to
 * copy — the three things that decide whether it reaches the bank's remark box.
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

function CopyButton({ label, value }: { label: string; value: string }) {
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
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold transition hover:bg-muted"
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

function GatewayButton({
  invoiceId,
  method,
}: {
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
    <div className="rounded-lg border-2 border-role-resident/40 bg-role-resident/5 p-3">
      <button
        className="flex w-full items-center justify-center gap-2 rounded-md bg-role-resident px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
        disabled={busy}
        onClick={start}
        type="button"
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Smartphone aria-hidden="true" className="size-4" />
        )}
        {busy ? `Opening ${label}…` : `Pay with ${label}`}
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Settles automatically — no screenshot needed.
      </p>
      {method.sandbox ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/15 p-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Test mode — this is a sandbox merchant and moves no real money.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-center text-xs font-semibold text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function MethodRow({ invoiceId, method }: { invoiceId: string; method: PayMethod }) {
  if (method.kind === "GATEWAY") {
    return <GatewayButton invoiceId={invoiceId} method={method} />;
  }

  if (method.kind === "QR") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- private asset served through our own authorizing route */}
        <img
          alt="Scan to pay"
          className="size-44 object-contain"
          src={`/api/v1/files/${method.assetId}/url`}
        />
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <QrCode aria-hidden="true" className="size-3.5" />
          Scan with any payment app
        </span>
        {/* A personal wallet's daily cap. Told before they try, because the
            network's rejection afterwards explains nothing. */}
        {method.notice ? (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-500/15 p-2 text-xs font-semibold leading-4 text-amber-800 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {method.notice}
          </p>
        ) : null}
      </div>
    );
  }

  if (method.kind === "BANK") {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Building2 aria-hidden="true" className="size-3.5" />
          Bank transfer
        </p>
        <div className="mt-2 space-y-1 text-sm">
          {method.bankName ? <p className="font-semibold">{method.bankName}</p> : null}
          {method.accountName ? (
            <p className="text-muted-foreground">{method.accountName}</p>
          ) : null}
          <p className="flex items-center gap-2 font-mono font-semibold">
            {method.accountNumber}
            <CopyButton label="account number" value={method.accountNumber} />
          </p>
        </div>
      </div>
    );
  }

  const label = method.kind === "ESEWA" ? "eSewa" : "Khalti";

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Smartphone aria-hidden="true" className="size-3.5" />
        {label}
      </p>
      <p className="mt-2 flex items-center gap-2 font-mono text-sm font-semibold">
        {method.id}
        <CopyButton label={`${label} ID`} value={method.id} />
      </p>
    </div>
  );
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

  return (
    <SectionCard
      actions={
        <button
          aria-label="Close payment instructions"
          className="rounded-md border border-border p-1.5 transition hover:bg-muted"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      }
      description={
        instructions?.period
          ? `Rent for ${instructions.period}`
          : "This invoice"
      }
      title="How to pay"
    >
      {resource.state === "loading" ? <LoadingRows /> : null}
      {resource.state === "error" ? (
        <EmptyState label="Payment instructions could not be loaded." />
      ) : null}

      {instructions ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Amount to pay
              </p>
              <p className="text-2xl font-bold">{currency(instructions.amountDue)}</p>
            </div>
            {instructions.dueDate ? (
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Due
                </p>
                <p className="text-sm font-semibold">
                  {new Date(instructions.dueDate).toLocaleDateString()}
                </p>
              </div>
            ) : null}
          </div>

          {instructions.referenceCode ? (
            <div className="rounded-lg border-2 border-role-resident/40 bg-role-resident/5 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Write this reference in the remarks
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-mono text-2xl font-bold tracking-widest">
                  {instructions.referenceCode}
                </span>
                <CopyButton
                  label="reference code"
                  value={instructions.referenceCode}
                />
              </div>
              <p className="mt-2 text-xs leading-4 text-muted-foreground">
                Without it your hostel has to match the payment by hand, which is
                slower and sometimes wrong.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
              This invoice has no reference code. Write your name and room number in
              the remarks instead, and upload the screenshot below.
            </div>
          )}

          {instructions.usable ? (
            <>
              {instructions.displayName ? (
                <p className="text-sm">
                  Pay <span className="font-semibold">{instructions.displayName}</span>{" "}
                  using any of these:
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {instructions.methods.map((method) => (
                  <MethodRow
                    invoiceId={instructions.invoiceId}
                    key={
                      method.kind === "GATEWAY"
                        ? `GATEWAY:${method.provider}`
                        : method.kind
                    }
                    method={method}
                  />
                ))}
              </div>
              {instructions.instructions ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm">
                  {instructions.instructions}
                </p>
              ) : null}
              {/* Scoped to the manual methods on purpose: a gateway payment
                  settles itself, and telling a resident who just paid through
                  one to wait for approval is how they end up paying twice. */}
              {instructions.methods.some((method) => method.kind !== "GATEWAY") ? (
                <p className="text-xs text-muted-foreground">
                  If you paid by QR, wallet or bank transfer, upload the screenshot
                  below — those are confirmed by your hostel before they count.
                </p>
              ) : null}
            </>
          ) : (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <p className="font-semibold">
                Your hostel has not set up online payment details yet.
              </p>
              <p className="mt-1 leading-5">
                Ask them how to pay, then upload your payment screenshot below so it
                still reaches your record.
              </p>
            </div>
          )}

        </div>
      ) : null}
    </SectionCard>
  );
});
