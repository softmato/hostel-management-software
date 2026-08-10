"use client";

import { Building2, Check, Copy, QrCode, Smartphone, X } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { currency, EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { SectionCard, SoftBadge } from "@/app/_components/portal-dashboard-ui";
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

type PayMethod =
  | {
      kind: "BANK";
      accountName: string | null;
      accountNumber: string;
      bankName: string | null;
    }
  | { kind: "ESEWA"; id: string }
  | { kind: "KHALTI"; id: string }
  | { kind: "QR"; assetId: string };

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

function MethodRow({ method }: { method: PayMethod }) {
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
                  <MethodRow key={method.kind} method={method} />
                ))}
              </div>
              {instructions.instructions ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm">
                  {instructions.instructions}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                After paying, upload the screenshot below. Your hostel confirms it and
                you get a receipt — the payment is not recorded until they do.
              </p>
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

          {instructions.tier === "TIER_1" ? (
            <SoftBadge tone="green">Online checkout available</SoftBadge>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
});
