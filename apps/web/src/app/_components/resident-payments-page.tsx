"use client";

import {
  CalendarDays,
  Check,
  Download,
  Loader2,
  ReceiptText,
  Upload,
  WalletCards,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { currency, EmptyState, LoadingRows } from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResidentClaimForm } from "@/app/_components/resident-claim-form";
import { ResidentPayInvoicePanel } from "@/app/_components/resident-pay-invoice-panel";
import { dayMonthYear, daysLeftLabel, monthLabel } from "@/lib/format-month";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { residentEndpoints } from "@/lib/resident-endpoints";
import { cn } from "@/lib/utils";
import { type Payment, type PaymentProof, Message } from "./resident-shared";
import {
  DataTable,
  EmptyInline,
  MetricCard,
  PortalPageHeader,
  RoleButton,
  SectionCard,
  SoftBadge,
  statusToneFromLabel,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./portal-dashboard-ui";

/**
 * The resident's fee and payment screen (target §11.1, §11.2).
 *
 * Rebuilt around a single question — *what do I owe right now, and how do I pay
 * it* — because that is the only reason this page gets opened. Everything else
 * is history, and history belongs below the fold.
 *
 * Three things drive the layout:
 *
 * - **One invoice is the subject.** The next open month gets a full-width focus
 *   card with the amount, the month spelled out and the days remaining. The
 *   table underneath is a record, not a to-do list; when a table is the primary
 *   surface, "which of these six rows is the one I act on" becomes the
 *   resident's problem instead of ours.
 * - **The claim form is a step, not a sidebar.** It only appears once they say
 *   they have paid, and it lives in `resident-claim-form.tsx` — it grew a
 *   reference-code check, a per-method guide to finding a transaction id and the
 *   two instant rejections (§11.3), none of which is about this list of months.
 * - **Months are written out.** "2026-07" was on every row of a rent statement.
 */

/**
 * The one invoice the resident is here about.
 *
 * Shows nothing when everything is settled — an empty focus card that says
 * "NPR 0" reads as a bill for zero rupees, which is a support question.
 */
function FocusCard({
  credit,
  onPay,
  onSubmitProof,
  payment,
  pendingClaim,
}: {
  credit: number;
  onPay: () => void;
  onSubmitProof: () => void;
  payment: Payment;
  pendingClaim: PaymentProof | undefined;
}) {
  const outstanding = Math.max(payment.dueAmount - payment.paidAmount, 0);
  const overdue = payment.status === "OVERDUE";

  return (
    <section
      className={cn(
        "rounded-2xl border-2 p-5 shadow-sm sm:p-6",
        overdue
          ? "border-rose-500/40 bg-rose-500/5"
          : "border-role-resident/40 bg-role-resident/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">
            {monthLabel(payment.month)}
          </p>
          <p className="mt-1 font-heading text-4xl font-bold text-foreground">
            {currency(outstanding)}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" />
              Due {dayMonthYear(payment.dueDate)}
            </span>
            <span
              className={cn(
                "font-semibold",
                overdue ? "text-rose-700 dark:text-rose-400" : "text-foreground",
              )}
            >
              · {daysLeftLabel(payment.dueDate)}
            </span>
          </p>
          {/* Told before the amount confuses them: a credit silently shrinking
              next month's bill is an unanswerable support question. */}
          {credit > 0 ? (
            <p className="mt-2 inline-block rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              {currency(credit)} credit will be applied
            </p>
          ) : null}
          {payment.paidAmount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {currency(payment.paidAmount)} of {currency(payment.dueAmount)} already
              received.
            </p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto">
          <RoleButton className="w-full sm:w-52" onClick={onPay} tone="resident">
            <WalletCards className="size-4" />
            Pay now
          </RoleButton>
          <Button
            className="w-full rounded-xl sm:w-52"
            onClick={onSubmitProof}
            type="button"
            variant="outline"
          >
            <Upload className="size-4" />
            I&apos;ve paid — submit proof
          </Button>
        </div>
      </div>

      {/* A resident who has already submitted and sees an unchanged "pay now"
          card is the one most likely to pay twice. */}
      {pendingClaim ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/15 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          You submitted {currency(pendingClaim.amount)} for this month. Your hostel is
          checking it — you do not need to pay again.
        </p>
      ) : null}
    </section>
  );
}

export const ResidentPaymentsPageContent = memo(function ResidentPaymentsPageContent() {
  const [actionMessage, setActionMessage] = useState("");
  const [statusTab, setStatusTab] = useState("ALL");
  // Which invoice the resident is being told how to pay (item 3.3). "" closes
  // the panel; the same id binds the claim form, so the two halves of "pay this
  // month" cannot drift onto different invoices.
  const [payingInvoiceId, setPayingInvoiceId] = useState("");
  /** Which invoice the claim form is open for. "" keeps the form collapsed. */
  const [claimInvoiceId, setClaimInvoiceId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const invalidate = useInvalidateResources();

  // Since item 2.8 the resident reads invoices and their own claims. `claims`
  // are `PaymentEvent` rows, which is why a claim knows its `invoiceId` rather
  // than a `paymentId`.
  const paymentsResource = usePortalResource<{
    claims: PaymentProof[];
    credit: number;
    invoices: Payment[];
  }>(residentEndpoints.payments, { errorMessage: "Could not load payments." });

  const payments = useMemo(
    () => paymentsResource.data?.invoices ?? [],
    [paymentsResource.data],
  );
  const proofs = useMemo(
    () => paymentsResource.data?.claims ?? [],
    [paymentsResource.data],
  );
  const credit = paymentsResource.data?.credit ?? 0;
  const state = paymentsResource.state;
  const message = actionMessage || paymentsResource.message;

  const proofByPaymentId = useMemo(
    () => new Map(proofs.map((proof) => [proof.invoiceId, proof])),
    [proofs],
  );

  const stats = useMemo(() => {
    const paid = payments.filter((p) => p.status === "PAID").length;
    const unpaid = payments.filter((p) => p.status === "UNPAID").length;
    const partial = payments.filter((p) => p.status === "PARTIAL").length;
    const overdue = payments.filter((p) => p.status === "OVERDUE").length;
    const totalDue = payments.reduce(
      (sum, p) => sum + Math.max(0, p.dueAmount - p.paidAmount),
      0,
    );
    const lastPaid = payments.find((p) => p.status === "PAID");
    // Overdue first, then the earliest open month — the one they owe longest is
    // the one that should be in front of them.
    const open = payments
      .filter(
        (p) =>
          p.status === "UNPAID" || p.status === "OVERDUE" || p.status === "PARTIAL",
      )
      .sort((left, right) => left.month.localeCompare(right.month));

    return {
      lastPaid,
      nextDue: open.find((p) => p.status === "OVERDUE") ?? open[0],
      overdue,
      paid,
      partial,
      totalDue,
      unpaid,
    };
  }, [payments]);

  const claimInvoice = useMemo(
    () => payments.find((payment) => payment.id === claimInvoiceId) ?? null,
    [claimInvoiceId, payments],
  );
  const claimOutstanding = claimInvoice
    ? Math.max(claimInvoice.dueAmount - claimInvoice.paidAmount, 0)
    : 0;

  /**
   * Fetched rather than linked so a failure shows in the page's own message line
   * instead of navigating the resident to a JSON error body.
   */
  const handleStatement = useCallback(async () => {
    setDownloading(true);

    try {
      const response = await fetch(residentEndpoints.statementPdf);

      if (!response.ok) {
        throw new Error("Statement could not be generated.");
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");

      link.download = "statement.pdf";
      link.href = url;
      link.click();
      // Revoked immediately: the click has already handed the blob to the
      // browser's download manager, and holding the object URL leaks it for the
      // lifetime of the document.
      URL.revokeObjectURL(url);
      setActionMessage("");
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Statement could not be generated.",
      );
    } finally {
      setDownloading(false);
    }
  }, []);

  const filteredPayments = useMemo(() => {
    if (statusTab === "ALL") return payments;
    return payments.filter((p) => p.status === statusTab);
  }, [payments, statusTab]);

  const openClaimFor = useCallback((invoiceId: string) => {
    setClaimInvoiceId(invoiceId);
    setPayingInvoiceId("");
  }, []);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PortalPageHeader
        breadcrumb={["Home", "Payments"]}
        description="What you owe, how to pay it, and every month you have already settled."
        title="Fees & Payments"
      />
      <Message value={message} />

      {state === "loading" ? <LoadingRows /> : null}
      {state === "error" ? <EmptyState label="Payments could not be loaded." /> : null}

      {/* ── The one thing this page is for ─────────────────────────────── */}
      {state === "ready" && stats.nextDue ? (
        <FocusCard
          credit={credit}
          onPay={() => {
            setPayingInvoiceId(stats.nextDue!.id);
            setClaimInvoiceId("");
          }}
          onSubmitProof={() => openClaimFor(stats.nextDue!.id)}
          payment={stats.nextDue}
          pendingClaim={proofByPaymentId.get(stats.nextDue.id)}
        />
      ) : null}

      {state === "ready" && !stats.nextDue ? (
        <section className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
          <Check className="mx-auto size-8 text-emerald-600" />
          <p className="mt-2 font-heading text-lg font-bold text-foreground">
            Nothing outstanding
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every month billed to you so far has been settled.
            {credit > 0
              ? ` You also have ${currency(credit)} in credit for your next invoice.`
              : ""}
          </p>
        </section>
      ) : null}

      {payingInvoiceId ? (
        <ResidentPayInvoicePanel
          invoiceId={payingInvoiceId}
          onClose={() => setPayingInvoiceId("")}
        />
      ) : null}

      {/* ── The claim form, only once they say they have paid (§11.2) ──── */}
      {claimInvoice ? (
        <ResidentClaimForm
          // Remounted per invoice, so a half-filled upload for July cannot be
          // submitted against August and a rejection card does not survive the
          // move to another month.
          key={claimInvoice.id}
          invoiceId={claimInvoice.id}
          month={claimInvoice.month}
          onCancel={() => setClaimInvoiceId("")}
          onSubmitted={(note) => {
            setClaimInvoiceId("");
            setActionMessage(note);
            invalidate(residentEndpoints.payments, residentEndpoints.dashboard);
          }}
          outstanding={claimOutstanding}
        />
      ) : null}

      {/* ── Everything else: the record ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label="Total Outstanding"
          tone={stats.totalDue > 0 ? "rose" : "green"}
          trend={stats.overdue > 0 ? `${stats.overdue} month(s) overdue` : "Nothing overdue"}
          trendDown={stats.overdue > 0}
          value={currency(stats.totalDue)}
        />
        <MetricCard
          icon={CalendarDays}
          label="Next Due Date"
          tone="blue"
          trend={stats.nextDue ? monthLabel(stats.nextDue.month) : "No open dues"}
          value={stats.nextDue ? dayMonthYear(stats.nextDue.dueDate) : "—"}
        />
        <MetricCard
          icon={ReceiptText}
          label="Last Payment"
          tone="cyan"
          trend={stats.lastPaid ? monthLabel(stats.lastPaid.month) : "No payments yet"}
          value={stats.lastPaid ? currency(stats.lastPaid.paidAmount) : "—"}
        />
        <MetricCard
          icon={Check}
          label="Months Settled"
          tone="green"
          trend={`of ${payments.length} billed`}
          value={String(stats.paid)}
        />
      </div>

      <SectionCard
        actions={
          <Button
            className="h-9 gap-2 rounded-xl"
            disabled={downloading}
            onClick={handleStatement}
            type="button"
            variant="outline"
          >
            <Download className="size-4" />
            {downloading ? "Preparing…" : "Download Statement"}
          </Button>
        }
        title="Payment History"
      >
        <Tabs className="mb-4" onValueChange={setStatusTab} value={statusTab}>
          <TabsList className="h-auto flex-wrap rounded-xl bg-muted/50 p-1">
            <TabsTrigger className="rounded-lg px-3" value="ALL">
              All {payments.length}
            </TabsTrigger>
            <TabsTrigger className="rounded-lg px-3" value="PAID">
              Paid {stats.paid}
            </TabsTrigger>
            <TabsTrigger className="rounded-lg px-3" value="UNPAID">
              Unpaid {stats.unpaid}
            </TabsTrigger>
            <TabsTrigger className="rounded-lg px-3" value="PARTIAL">
              Partial {stats.partial}
            </TabsTrigger>
            <TabsTrigger className="rounded-lg px-3" value="OVERDUE">
              Overdue {stats.overdue}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {state === "ready" && filteredPayments.length === 0 ? (
          <EmptyInline label="No payments in this filter." />
        ) : null}
        {state === "ready" && filteredPayments.length > 0 ? (
          <DataTable className="min-w-[680px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {["Month", "Amount (NPR)", "Status", "Due Date", "Paid", "Receipt"].map(
                  (heading) => (
                    <TableHead
                      className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      key={heading}
                    >
                      {heading}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayments.map((payment) => {
                const proof = proofByPaymentId.get(payment.id);
                const isOpen =
                  payment.status === "UNPAID" ||
                  payment.status === "OVERDUE" ||
                  payment.status === "PARTIAL";

                return (
                  <TableRow key={payment.id}>
                    <TableCell className="font-semibold text-foreground">
                      {monthLabel(payment.month)}
                    </TableCell>
                    <TableCell>{currency(payment.dueAmount)}</TableCell>
                    <TableCell>
                      <SoftBadge
                        tone={
                          proof?.status === "PENDING"
                            ? "amber"
                            : statusToneFromLabel(payment.status)
                        }
                      >
                        {proof?.status === "PENDING"
                          ? "AWAITING REVIEW"
                          : payment.status.replaceAll("_", " ")}
                      </SoftBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dayMonthYear(payment.dueDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {payment.paidAmount > 0 ? currency(payment.paidAmount) : "—"}
                    </TableCell>
                    <TableCell>
                      {payment.receiptId ? (
                        <a
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                          href={residentEndpoints.receiptPdf(payment.receiptId)}
                        >
                          <Download className="size-3" />
                          {payment.receiptNumber ?? "Receipt"}
                        </a>
                      ) : isOpen ? (
                        <button
                          className="rounded-full border border-role-resident/40 bg-role-resident/10 px-2.5 py-1 text-[10.5px] font-semibold text-role-resident transition hover:bg-role-resident/20"
                          onClick={() => {
                            setPayingInvoiceId(payment.id);
                            setClaimInvoiceId("");
                          }}
                          type="button"
                        >
                          Pay now
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        ) : null}
      </SectionCard>
    </div>
  );
});
