"use client";

import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Info,
  Loader2,
  QrCode,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { downloadFile } from "@/lib/downloads/downloader";
import { usePortalResource } from "@/lib/portal-query";
import { toast } from "@/stores/toast-store";
import { uploadFile } from "@/lib/uploads/uploader";
import type { PlanPaymentInstructions } from "@/modules/billing/subscription-claim.service";

/**
 * Paying the platform from the portal — the web half of the manual lane.
 *
 * The phone has `manage/pay-plan.tsx` and this is the same flow for the owner
 * who is at a desk: our QR, then their proof. It is the **same two endpoints**,
 * so there is exactly one definition of what a claim is and one place a claim
 * is turned into money; only the chrome differs, which is the parity rule this
 * product holds itself to.
 *
 * ## It renders nothing unless something is owed
 *
 * Most owners are paid up, and a payment panel on a settled account is an
 * invitation to pay twice. The panel appears when there is an outstanding
 * balance, and collapses to a single "we are checking it" line the moment a
 * claim is in review — for the same reason the phone hides its QR and its
 * submit button in that state.
 *
 * ## Why there is no *Pay* button on it
 *
 * Because nothing on a client may record a payment. The banner this replaced
 * had one: it posted an `open`/`confirm` pair at a route whose `action` branch
 * no longer existed, and reported success for money nobody had received. The
 * proof form is the honest version of that button.
 */

const rupees = (value: number) => `NPR ${value.toLocaleString("en-IN")}`;

export function PayPlanPanel({ onPaid }: { onPaid?: () => void }) {
  const [proofAssetId, setProofAssetId] = useState<string | null>(null);
  const [proofName, setProofName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  /*
   * The portal's own resource hook rather than a `useEffect` that fetches. It
   * is what every other panel in this portal uses, it caches and revalidates,
   * and it keeps a `setState` out of an effect body — which the React compiler
   * rejects outright as a cascading render.
   */
  const resource = usePortalResource<{ instructions: PlanPaymentInstructions }>(
    "/api/v1/hostel-admin/billing/pay-instructions",
  );

  const data = resource.data?.instructions ?? null;

  /*
   * Nothing owed, nothing loaded, nothing to say. Silent on failure too: this
   * panel is an addition to a page that already works, and an error card here
   * would be the loudest thing on a screen that is otherwise fine.
   */
  if (!data || !data.invoice || data.amountDue <= 0) {
    return null;
  }

  async function attach(file: File) {
    setUploading(true);

    try {
      const result = await uploadFile(file, {
        accessLevel: "PRIVATE",
        assetKind: "PAYMENT_PROOF",
        kind: "image",
        label: "Payment proof",
        silent: true,
      });

      if (!result?.assetId) {
        throw new Error("Upload failed");
      }

      setProofAssetId(result.assetId);
      setProofName(file.name);
    } catch {
      setProofAssetId(null);
      setProofName("");
      toast.error({
        description: "Please try attaching the screenshot again.",
        title: "That did not upload",
      });
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!proofAssetId) return;

    setSending(true);

    try {
      await browserApi("/api/v1/hostel-admin/billing/claim", {
        body: JSON.stringify({
          note: note.trim() || undefined,
          proofAssetId,
          reference: reference.trim() || undefined,
        }),
        method: "POST",
      });

      toast.success({
        description: "We will email you as soon as it is verified.",
        title: "Proof sent",
      });

      setProofAssetId(null);
      setProofName("");
      setReference("");
      setNote("");
      await resource.refreshAsync();
      onPaid?.();
    } catch (error) {
      toast.error({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Could not send it",
      });
    } finally {
      setSending(false);
    }
  }

  if (data.claim) {
    return (
      <section className="rounded-xl border border-warning/40 bg-warning/5 p-5">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-foreground">
              We are checking your payment
            </h2>
            <p className="text-sm text-muted-foreground">
              You sent us proof of{" "}
              <strong className="text-foreground">
                {rupees(data.claim.amount)}
              </strong>
              . Our team verifies it within 1–2 working days and emails you
              either way. Your plan keeps working and your listing stays live in
              the meantime — there is nothing more to pay.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Pay your plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {rupees(data.amountDue)} outstanding on {data.invoice.planName}
            {data.dueBy
              ? data.overdue
                ? " — the deadline has passed."
                : "."
              : "."}
          </p>
        </div>

        {data.reference ? (
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 font-mono text-xs font-semibold text-foreground transition hover:border-brand-teal/40"
            onClick={() => {
              void navigator.clipboard.writeText(data.reference as string);
              toast.success({ title: "Invoice number copied" });
            }}
            title="Copy the invoice number to put in your payment remarks"
            type="button"
          >
            <Copy className="size-3.5" />
            {data.reference}
          </button>
        ) : null}
      </div>

      <div className="grid gap-5 md:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          {data.qr ? (
            <>
              <div className="flex size-44 items-center justify-center rounded-xl border border-border bg-white p-2">
                <Image
                  alt="Payment QR"
                  height={160}
                  src={data.qr.url}
                  unoptimized
                  width={160}
                />
              </div>
              <p className="max-w-44 text-center text-[11px] font-semibold text-foreground">
                {data.qr.label}
              </p>
              <button
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
                onClick={() =>
                  void downloadFile({
                    fileName: "payment-qr.png",
                    label: "Payment QR",
                    mimeType: "image/png",
                    url: (data.qr as { url: string }).url,
                  })
                }
                type="button"
              >
                <Download className="size-3.5" />
                Save the QR
              </button>
            </>
          ) : (
            <div className="flex size-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground">
              <QrCode className="size-7 opacity-40" />
              <p className="px-3 text-center text-[11px]">
                No QR published yet — contact us for the account details.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-xs leading-5 text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            Automatic payment is coming soon. Until it is ready, plan payments
            reach us this way — scan, pay, then send us the proof. Thank you for
            bearing with the extra step.
          </p>

          {proofAssetId ? (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                {proofName}
              </span>
              <button
                className="text-muted-foreground transition hover:text-destructive"
                onClick={() => {
                  setProofAssetId(null);
                  setProofName("");
                }}
                title="Remove"
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs font-semibold text-muted-foreground transition hover:border-brand-teal/40 hover:text-foreground">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploading
                ? "Uploading…"
                : "Attach your payment screenshot or receipt"}
              <input
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];

                  if (file) void attach(file);

                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-brand-teal/50"
              onChange={(event) => setReference(event.target.value)}
              placeholder="Transaction reference (optional)"
              value={reference}
            />
            <input
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-brand-teal/50"
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for our team (optional)"
              value={note}
            />
          </div>

          {/*
            Mounted only once there is a claim to send, exactly as the phone
            does it. A permanently disabled button spends a row narrating its
            own unavailability.
          */}
          {proofAssetId ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
              disabled={sending}
              onClick={() => void submit()}
              type="button"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Submit payment proof
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
