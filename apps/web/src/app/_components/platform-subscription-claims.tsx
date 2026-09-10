"use client";

import { Check, ExternalLink, ReceiptText, X } from "lucide-react";
import { useState } from "react";

import { currency, EmptyState } from "@/app/_components/shared-ui";
import { RoleButton, SoftBadge } from "@/app/_components/portal-dashboard-ui";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/browser-api";
import { platformEndpoints } from "@/lib/platform-endpoints";
import type { PlanPaymentClaim } from "@/modules/billing/subscription-claim.service";

/**
 * The manual-payment review queue, as a person actually works it.
 *
 * ## Cards, not a table row
 *
 * Every other list on Plan Billing is a table because every other list is
 * *history* — scanned, searched, occasionally downloaded. This one is a
 * worklist, and the unit of work is "look at a screenshot, decide". The
 * screenshot is the whole reason the row exists, so it is on the row at a size
 * a person can read a transaction id off, and a table cell cannot hold that.
 *
 * ## The decision is two buttons and no dialog
 *
 * Approving is the common case and it is one press. Refusing opens a note field
 * *in place* rather than a modal, because the note is the sentence the owner
 * will read in their email — it is the deliverable of a refusal, not a
 * confirmation step — and a reviewer typing it wants the proof still on screen
 * beside them.
 *
 * A refusal without a note is allowed. Insisting on one produces "n/a" and
 * teaches reviewers to type nothing useful; the email has a serviceable default
 * sentence for that case.
 *
 * ## Approving is the only place a screenshot becomes money
 *
 * Which is why the button says what it does — *Confirm payment*, not *Approve*
 * — and why nothing on this card can be pressed twice: `busy` locks the whole
 * row for the round trip, and the server refuses a second review of a claim
 * that has already been answered regardless.
 */
export function SubscriptionClaimQueue({
  claims,
  onReviewed,
}: {
  claims: PlanPaymentClaim[];
  onReviewed: () => void;
}) {
  if (claims.length === 0) {
    return (
      <EmptyState label="No hostel is waiting on a manual payment review." />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-muted-foreground">
        Hostels that paid us by QR and sent proof. Nothing here has moved a
        balance yet — confirming one records the payment, issues the receipt and
        clears the hostel&apos;s due.
      </p>

      {claims.map((claim) => (
        <ClaimCard claim={claim} key={claim.id} onReviewed={onReviewed} />
      ))}
    </div>
  );
}

/** "3 days ago", for a queue whose whole promise is a turnaround time. */
function waitingFor(value: string | null) {
  if (!value) return "just now";

  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";

  return `${days} days ago`;
}

function ClaimCard({
  claim,
  onReviewed,
}: {
  claim: PlanPaymentClaim;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const proofUrl = claim.proofAssetId
    ? `/api/v1/files/${claim.proofAssetId}/url`
    : null;

  async function review(approve: boolean) {
    setBusy(true);
    setError("");

    try {
      await browserApi(platformEndpoints.subscriptionClaimReview(claim.id), {
        body: JSON.stringify({ approve, note: note.trim() || undefined }),
        method: "POST",
      });

      onReviewed();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That did not go through.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex flex-wrap items-start gap-3">
        {/*
          The proof itself, not a link to it. A reviewer's job is to look at
          this image and compare three numbers on it with the three beside it,
          and a queue that makes them open a tab per claim is a queue that gets
          skimmed. It stays a link too — the thumbnail is rarely big enough to
          read a bank's small print.
        */}
        {proofUrl ? (
          <a
            className="group relative block size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30"
            href={proofUrl}
            rel="noreferrer noopener"
            target="_blank"
            title="Open the full proof"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={`Payment proof from ${claim.hostelName}`}
              className="size-full object-cover"
              src={proofUrl}
            />
            <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover:flex">
              <ExternalLink className="size-4" />
            </span>
          </a>
        ) : (
          <span className="flex size-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
            <ReceiptText className="size-5" />
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[13.5px] font-bold text-foreground">
              {claim.hostelName}
            </p>
            <SoftBadge tone="amber">In review</SoftBadge>
            <span className="text-[11px] text-muted-foreground">
              sent {waitingFor(claim.claimedAt)}
            </span>
          </div>

          <p className="text-[12.5px] text-foreground">
            <span className="font-semibold">{currency(claim.amount)}</span>
            <span className="text-muted-foreground"> · {claim.planName}</span>
          </p>

          <p className="font-mono text-[11px] text-muted-foreground">
            {claim.invoiceNumber}
            {claim.reference ? ` · their ref ${claim.reference}` : ""}
          </p>

          {claim.note ? (
            <p className="rounded-md bg-muted/40 px-2 py-1 text-[11.5px] italic text-muted-foreground">
              “{claim.note}”
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <RoleButton
            disabled={busy}
            onClick={() => setRefusing((open) => !open)}
            tone="platform"
            variant="outline"
          >
            <X className="size-3.5" />
            Not confirmed
          </RoleButton>
          <RoleButton
            disabled={busy}
            onClick={() => void review(true)}
            tone="platform"
          >
            <Check className="size-3.5" />
            Confirm payment
          </RoleButton>
        </div>
      </div>

      {refusing ? (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
          <label
            className="text-[11.5px] font-semibold text-foreground"
            htmlFor={`note-${claim.id}`}
          >
            What should we tell them?
          </label>
          <Textarea
            className="min-h-16 text-[12.5px]"
            id={`note-${claim.id}`}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. The screenshot shows Rs 1,200, but the invoice is for Rs 3,600."
            value={note}
          />
          <div className="flex justify-end">
            <RoleButton
              disabled={busy}
              onClick={() => void review(false)}
              tone="platform"
              variant="outline"
            >
              Send &amp; mark unconfirmed
            </RoleButton>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-[11.5px] font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
