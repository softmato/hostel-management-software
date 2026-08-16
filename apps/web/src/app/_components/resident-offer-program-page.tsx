"use client";

import React, { useCallback, useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, Check, Copy, Download, Sparkles } from "lucide-react";
import Link from "next/link";

import {
  EmptyState,
  LoadingRows,
  Panel,
  StatusBadge,
  currency,
} from "@/app/_components/shared-ui";
import { usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { Message, PageHeader } from "./portal-shared";

/**
 * The resident's own view of the Resident Offer Program.
 *
 * **Why a page and not a section of Fees & Payments.** That page answers "what
 * do I owe and how do I pay it", and everything on it is arranged around a due
 * date. The questions this one answers are different in kind — *which code is
 * live for me right now*, *how much of what I have paid was matched
 * automatically*, *where are my certified receipts* — and they are asked at
 * different moments, usually not while money is due. Folding them into the
 * payments screen buried them under a balance.
 *
 * **It reads the payments endpoint, not one of its own.** Everything here is a
 * different arrangement of facts that endpoint already returns: invoices carry
 * their reference code, settled months carry their receipts, and pending claims
 * come back with them. A second endpoint would be a second chance for the two
 * screens to disagree about the same resident's money, which is the failure this
 * product can least afford.
 */

type Receipt = {
  amount: number;
  id: string;
  issuedAt: string | null;
  number: string;
};

type Invoice = {
  dueAmount: number;
  id: string;
  month: string;
  paidAmount: number;
  receipts: Receipt[];
  referenceCode: string | null;
  status: string;
};

type Claim = {
  amount: number;
  eventId: string;
  period: string | null;
  status: string;
};

type FinanceView = {
  claims: Claim[];
  credit: number;
  invoices: Invoice[];
};

/** Months a code is still worth quoting — anything with money left on it. */
const OPEN_STATUSES = new Set(["OPEN", "PARTIAL", "OVERDUE"]);

function StatTile({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * A reference code with a copy button.
 *
 * Copying matters more here than anywhere else in the portal: the code has to be
 * pasted into a bank's remarks field on the same phone, and a resident retyping
 * `RUP-4821-K` by eye is how a payment ends up quoting a code that does not
 * validate. The check character catches the typo — but only after the money has
 * already moved.
 */
function ReferenceCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <button
      className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm font-semibold tracking-wider text-role-resident transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-resident"
      onClick={handleCopy}
      type="button"
    >
      {code}
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only">{copied ? "Copied" : "Copy reference code"}</span>
    </button>
  );
}

export const ResidentOfferProgramPageContent = React.memo(
  function ResidentOfferProgramPageContent() {
    const resource = usePortalResource<FinanceView>(residentEndpoints.payments, {
      errorMessage: "Could not load your Offer Program details.",
    });

    const invoices = useMemo(
      () => resource.data?.invoices ?? [],
      [resource.data],
    );
    const claims = useMemo(() => resource.data?.claims ?? [], [resource.data]);

    /** Months still owing something, so their code is still the one to quote. */
    const activeCodes = useMemo(
      () =>
        invoices.filter(
          (invoice) => invoice.referenceCode && OPEN_STATUSES.has(invoice.status),
        ),
      [invoices],
    );

    const receipts = useMemo(
      () =>
        invoices
          .flatMap((invoice) =>
            invoice.receipts.map((receipt) => ({ ...receipt, month: invoice.month })),
          )
          .sort((a, b) => (a.issuedAt ?? "") < (b.issuedAt ?? "") ? 1 : -1),
      [invoices],
    );

    const certifiedTotal = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const pendingClaims = claims.filter((claim) => claim.status === "PENDING");

    return (
      <div className="mx-auto max-w-[900px] space-y-6">
        <PageHeader
          description="Your reference codes, your certified receipts, and what the programme has matched for you so far."
          icon={Sparkles}
          title="Resident Offer Program"
        />
        <Message value={resource.message} />

        {/* Membership — stated plainly, because "am I actually in this?" is the
            first question and no other panel answers it. */}
        <Panel title="Your membership">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-role-resident/10">
                <BadgeCheck className="size-4.5 text-role-resident" />
              </span>
              <div>
                <p className="font-semibold text-foreground">Active</p>
                <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                  Quote your reference code when you pay and your payment is matched
                  to the right month automatically. Every verified payment is
                  receipted under the programme.
                </p>
              </div>
            </div>
            <Link
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-resident"
              href="/resident-offer-program"
            >
              Programme rules
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            hint="Payments verified and receipted"
            label="Certified"
            value={String(receipts.length)}
          />
          <StatTile
            hint="Total certified under the programme"
            label="Amount"
            value={currency(certifiedTotal)}
          />
          <StatTile
            hint="Proofs your hostel is still checking"
            label="Awaiting review"
            value={String(pendingClaims.length)}
          />
        </div>

        <Panel title="Your active reference codes">
          {resource.state === "loading" ? (
            <LoadingRows />
          ) : activeCodes.length === 0 ? (
            <EmptyState label="Nothing is due right now, so there is no code to quote." />
          ) : (
            <div className="space-y-3">
              {activeCodes.map((invoice) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  key={invoice.id}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {invoice.month}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {currency(invoice.dueAmount - invoice.paidAmount)} outstanding
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge>{invoice.status}</StatusBadge>
                    <ReferenceCode code={invoice.referenceCode!} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Paste the code into the remarks or purpose field when you transfer.
                If your bank has no such field, pay as normal — your rent still
                counts.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Your certified receipts">
          {resource.state === "loading" ? (
            <LoadingRows />
          ) : receipts.length === 0 ? (
            <EmptyState label="No receipts yet. One is issued each time your hostel verifies a payment." />
          ) : (
            <div className="space-y-2">
              {receipts.map((receipt) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                  key={receipt.id}
                >
                  <div className="min-w-0">
                    {/* The number, not the month, is the identifier: there is one
                        receipt per *payment*, so a month a resident part-paid has
                        several and only the number tells them apart. */}
                    <p className="truncate font-mono text-sm font-medium text-foreground">
                      {receipt.number}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {receipt.month} · {currency(receipt.amount)}
                      {receipt.issuedAt
                        ? ` · issued ${receipt.issuedAt.slice(0, 10)}`
                        : ""}
                    </p>
                  </div>
                  <a
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-role-resident"
                    href={residentEndpoints.receiptPdf(receipt.id)}
                  >
                    <Download className="size-3.5" />
                    PDF
                  </a>
                </div>
              ))}
              {/* Said here as well as on the public page, because this is the
                  screen the receipt is downloaded from — which is the moment
                  somebody is most likely to re-upload one as proof. */}
              <p className="text-xs text-muted-foreground">
                A receipt is your hostel&rsquo;s record that they were paid. It cannot
                be uploaded back as proof of a payment — for that, use the
                confirmation from the app or bank you paid with.
              </p>
            </div>
          )}
        </Panel>
      </div>
    );
  },
);
