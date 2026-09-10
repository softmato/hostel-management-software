"use client";

import {
  BookOpen,
  CalendarClock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
} from "lucide-react";
import { useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { downloadFile } from "@/lib/downloads/downloader";
import { cn } from "@/lib/utils";
import type {
  BillingHistory,
  BillingInvoiceRow,
  BillingPaymentRow,
  BillingPlan,
} from "@/modules/billing/billing-history.service";

/**
 * The hostel's own plan paperwork: what was billed, what was paid, and the
 * document behind each line.
 *
 * ## Two numbers on every row, and that is deliberate
 *
 * `SUB-0001-4F2A` is ours — the reference our emails quote and the one support
 * will be asked about. The other is what is *printed on the document*:
 * `INV-2083/84-000010` when Softmato raised it, `HH-INV-2083/84-000012` when
 * we did. The printed one leads, because it is what the owner is reading off
 * their copy; ours sits beside it, because showing one and hiding the other
 * guarantees the reader is looking for the one we hid.
 *
 * ## The download is a route on this app, not a link to Softmato
 *
 * Their document URL needs our client secret in a header. Sending the owner
 * there would be handing them a 401, and putting the secret in the browser to
 * fix that would publish it. So the button points at our own endpoint, which
 * checks the reader owns the hostel and then streams the bytes.
 *
 * ## Every settled row has a document now
 *
 * This screen used to say "document not raised yet" on an invoice Softmato had
 * not managed to raise, and "no gateway document" on a cash payment. Neither
 * state exists any more: when Softmato cannot be reached we issue the paper
 * ourselves, and a cash payment gets our receipt rather than nothing, because
 * money that was genuinely handed over deserves a document saying so.
 *
 * What still has no document is a payment that has not **settled** — and that
 * is not a gap. A receipt asserts that a sum was received, and one for money
 * still in flight would be a document stating something that may never be true.
 */

const STATUS_TONE: Record<string, string> = {
  OPEN: "border-warning/40 bg-warning/10 text-warning",
  PAID: "border-success/40 bg-success/10 text-success",
  PARTIAL: "border-warning/40 bg-warning/10 text-warning",
  PENDING: "border-border bg-muted/40 text-muted-foreground",
  SETTLED: "border-success/40 bg-success/10 text-success",
  VOID: "border-border bg-muted/40 text-muted-foreground",
};

const rupees = (value: number) => `NPR ${value.toLocaleString("en-IN")}`;

/**
 * The download is a fetch, not a link.
 *
 * The document route authenticates the reader and streams bytes; a plain
 * `<a href>` would send the browser off without the session this portal keeps
 * in memory, and the owner would get a login page where they expected a PDF.
 * `downloadFile` carries the credentials, shows the transfer in the global
 * toaster and never throws — the same path every other file in this portal
 * takes.
 */
function grabDocument(url: string, number: string, label: string) {
  void downloadFile({
    fileName: `${number.replace(/\//g, "-")}.pdf`,
    label,
    mimeType: "application/pdf",
    url,
  });
}

const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

export function HostelAdminBillingPageContent() {
  const [history, setHistory] = useState<BillingHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await browserApi<{ history: BillingHistory }>(
          "/api/v1/hostel-admin/billing",
        );

        if (!cancelled) setHistory(result.history);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load billing.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Plan billing</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What this hostel has been billed for its plan, and what has been
            received. Every invoice and receipt below can be downloaded — issued
            by Softmato, who take the payment, or by us directly when they
            cannot be reached.
          </p>
        </div>

        {history?.docsUrl ? (
          <a
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:border-brand-teal/40 hover:text-foreground"
            href={history.docsUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            <BookOpen className="size-4" />
            Payment documentation
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading your billing history.
        </p>
      ) : null}

      {history?.plan ? <PlanCard plan={history.plan} /> : null}

      {history ? (
        <>
          <Panel
            empty="No plan invoice has been raised for this hostel yet."
            icon={<FileText className="size-4" />}
            title="Invoices"
          >
            {history.invoices.map((invoice) => (
              <InvoiceRow invoice={invoice} key={invoice.invoiceNumber} />
            ))}
          </Panel>

          <Panel
            empty="No payment has been received yet."
            icon={<Receipt className="size-4" />}
            title="Receipts"
          >
            {history.payments.map((payment, index) => (
              <PaymentRow
                key={payment.printedNumber ?? payment.receiptNumber ?? index}
                payment={payment}
              />
            ))}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

/**
 * The plan, and how long is left on it.
 *
 * First on the page because it is the only thing here an owner opens this
 * screen to *decide* something about. The invoice list below is a record; this
 * is the question "am I about to lose the app".
 *
 * ## Days, and the date underneath it
 *
 * Both, and neither on its own. "17 days left" is what makes an owner act and
 * is useless for arranging a payment; "ends 14 December" is what they need to
 * put in a diary and does not convey urgency. The count leads and the date
 * qualifies it.
 *
 * The number is computed on the server (`daysUntil`) so the app and this screen
 * cannot disagree about a part-day. Rendering it here from `currentPeriodEnd`
 * would have put a second implementation of the same rounding in the browser.
 *
 * ## The tone changes once, and late
 *
 * Amber inside a fortnight, and never red. A plan approaching renewal is not a
 * fault — it is the product working — and a hostel that has paid us every year
 * does not need its billing screen shouting at it. Zero days is the state that
 * has actually gone wrong, and it says so in words rather than by turning a
 * card a colour.
 */
function PlanCard({ plan }: { plan: BillingPlan }) {
  const days = plan.daysRemaining;
  const expiring = days !== null && days <= 14;
  const expired = days === 0;

  return (
    <section
      className={cn(
        "rounded-2xl border p-5",
        expiring ? "border-warning/40 bg-warning/5" : "border-border bg-surface",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current plan
          </p>
          <p className="mt-1 text-lg font-bold text-foreground">
            {plan.planName ?? "No plan chosen yet"}
            {plan.cycleLabel ? (
              <span className="font-normal text-muted-foreground">
                {" \u00b7 "}
                {plan.cycleLabel}
              </span>
            ) : null}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge status={plan.status.replaceAll("_", " ")} />
            {plan.price ? (
              <span className="text-xs text-muted-foreground">
                {rupees(plan.price)} per cycle
              </span>
            ) : null}
          </div>
        </div>

        {days !== null ? (
          <div className="text-right">
            <p
              className={cn(
                "text-3xl font-bold tabular-nums",
                expiring ? "text-warning" : "text-foreground",
              )}
            >
              {days}
            </p>
            <p className="text-xs font-semibold text-muted-foreground">
              {days === 1 ? "day left" : "days left"}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        {expired ? (
          <span className="font-semibold text-warning">
            This plan has reached the end of its paid period.
          </span>
        ) : plan.currentPeriodEnd ? (
          <span>Paid through {shortDate(plan.currentPeriodEnd)}</span>
        ) : (
          <span>Nothing has been paid for yet.</span>
        )}
        {plan.dueBy ? (
          <span className="font-semibold text-warning">
            Balance due by {shortDate(plan.dueBy)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Panel({
  children,
  empty,
  icon,
  title,
}: {
  children: React.ReactNode[];
  empty: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
        {icon}
        {title}
      </h2>

      {children.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">{children}</ul>
      )}
    </section>
  );
}

function InvoiceRow({ invoice }: { invoice: BillingInvoiceRow }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {invoice.planName}{" "}
            <span className="font-normal text-muted-foreground">
              · {invoice.cycleLabel}
            </span>
          </p>

          {/*
            The number printed on the page leads, because that is what the owner
            is reading off their copy when they ring us. Ours sits beside it in
            the muted ink — it is the one every other screen in this portal
            indexes by, and showing only one guarantees they are holding the
            other.
          */}
          <p className="mt-1 font-mono text-xs text-foreground/70">
            {invoice.printedNumber}
            {invoice.printedNumber === invoice.invoiceNumber ? null : (
              <span className="text-muted-foreground">
                {" · "}
                {invoice.invoiceNumber}
              </span>
            )}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Issued {shortDate(invoice.issuedAt)}
            {invoice.dueAt ? ` · due ${shortDate(invoice.dueAt)}` : ""}
          </p>
        </div>

        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-foreground">
            {rupees(invoice.amount)}
          </p>
          {invoice.outstanding > 0 ? (
            <p className="text-xs font-semibold text-warning">
              {rupees(invoice.outstanding)} outstanding
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge status={invoice.status} />

        {/*
          Always offered. There used to be a "document not raised yet" state
          here, for an invoice Softmato had not managed to raise — that state no
          longer exists, because we issue the document ourselves when they
          cannot, and the route resolves whichever one there is.
        */}
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-teal/40"
          onClick={() =>
            grabDocument(invoice.documentUrl, invoice.printedNumber, "Invoice")
          }
          type="button"
        >
          <Download className="size-3.5" />
          Invoice PDF
        </button>
      </div>
    </li>
  );
}

function PaymentRow({ payment }: { payment: BillingPaymentRow }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {payment.method === "CASH"
              ? "Cash, collected in person"
              : (payment.provider ?? "Online payment")}
          </p>

          <p className="mt-1 font-mono text-xs text-foreground/70">
            {payment.printedNumber ?? payment.receiptNumber ?? "—"}
            {payment.receiptNumber &&
            payment.printedNumber !== payment.receiptNumber ? (
              <span className="text-muted-foreground">
                {" · "}
                {payment.receiptNumber}
              </span>
            ) : null}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            {shortDate(payment.paidAt)}
            {payment.providerRef ? ` · ref ${payment.providerRef}` : ""}
          </p>
        </div>

        <p className="text-lg font-bold tabular-nums text-foreground">
          {rupees(payment.amount)}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge status={payment.status} />

        {payment.documentUrl ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-teal/40"
            onClick={() =>
              grabDocument(
                payment.documentUrl as string,
                payment.printedNumber ?? payment.receiptNumber ?? "receipt",
                "Receipt",
              )
            }
            type="button"
          >
            <Download className="size-3.5" />
            Receipt PDF
          </button>
        ) : (
          /*
           * A receipt exists only for money that arrived. A pending or failed
           * attempt has none — not because we could not produce one, but
           * because it would assert something untrue.
           */
          <span className="text-xs text-muted-foreground">
            No receipt until this payment settles
          </span>
        )}
      </div>
    </li>
  );
}

function Badge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status] ?? "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}
