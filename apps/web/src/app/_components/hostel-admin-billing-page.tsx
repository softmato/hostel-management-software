"use client";

import {
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
} from "lucide-react";
import { useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import { cn } from "@/lib/utils";
import type {
  BillingHistory,
  BillingInvoiceRow,
  BillingPaymentRow,
} from "@/modules/billing/billing-history.service";

/**
 * The hostel's own plan paperwork: what was billed, what was paid, and the
 * document behind each line.
 *
 * ## Two numbers on every row, and that is deliberate
 *
 * `SUB-0001-4F2A` is ours — the reference our emails quote and the one support
 * will be asked about. `INV-2083/84-000010` is Softmato's, carrying the fiscal
 * year and the ledger sequence, and it is the number printed on the PDF an
 * accountant will hold. Showing one and hiding the other guarantees the reader
 * is looking for the one we hid.
 *
 * ## The download is a route on this app, not a link to Softmato
 *
 * Their document URL needs our client secret in a header. Sending the owner
 * there would be handing them a 401, and putting the secret in the browser to
 * fix that would publish it. So the button points at our own endpoint, which
 * checks the reader owns the hostel and then streams the bytes.
 *
 * ## Cash rows have no document, and say so
 *
 * A cash payment is our own record: money handed to a field agent that no
 * gateway can corroborate. It carries our receipt number and no PDF, which is
 * the honest rendering — a download button that produced nothing would be
 * worse than its absence.
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
            received. Invoices and receipts are issued by Softmato, who take the
            payment — the documents below are theirs, served through us.
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
                key={payment.softmatoTransactionNo ?? payment.receiptNumber ?? index}
                payment={payment}
              />
            ))}
          </Panel>
        </>
      ) : null}
    </div>
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

          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {invoice.invoiceNumber}
            {invoice.softmatoInvoiceNo ? (
              <>
                {" · "}
                <span className="text-foreground/70">
                  {invoice.softmatoInvoiceNo}
                </span>
              </>
            ) : null}
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

        {invoice.documentUrl ? (
          <a
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-teal/40"
            href={invoice.documentUrl}
          >
            <Download className="size-3.5" />
            Invoice PDF
          </a>
        ) : (
          /*
           * Not a disabled button. The paper genuinely does not exist yet, and
           * saying which of the two situations this is spares a support thread.
           */
          <span className="text-xs text-muted-foreground">
            Document not raised yet
          </span>
        )}
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

          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {payment.receiptNumber ?? "—"}
            {payment.softmatoTransactionNo ? (
              <>
                {" · "}
                <span className="text-foreground/70">
                  {payment.softmatoTransactionNo}
                </span>
              </>
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
          <a
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-brand-teal/40"
            href={payment.documentUrl}
          >
            <Download className="size-3.5" />
            Receipt PDF
          </a>
        ) : payment.method === "CASH" ? (
          <span className="text-xs text-muted-foreground">
            Recorded by our team — no gateway document
          </span>
        ) : null}
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
