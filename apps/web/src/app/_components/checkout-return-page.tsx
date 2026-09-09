"use client";

import { CheckCircle2, Clock3, Loader2, RotateCcw, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";
import type { ReturnState } from "@/modules/billing/checkout-return.service";

/**
 * Where the owner lands after paying — or after not paying.
 *
 * ## Five outcomes, and three of them are not "paid"
 *
 * This page exists because a payment has more endings than a redirect can
 * express. Pending, under review, cancelled and expired are all real, and each
 * one wants a different sentence. Forwarding everybody straight back to their
 * dashboard would rush a reader past the one line that matters most:
 * *this payment is being checked, please do not pay again.*
 *
 * ## Nothing on this page is read from the URL
 *
 * The address carries our own invoice number and nothing else. It is a
 * navigation hint — *which purchase are you asking about* — and the answer
 * comes from a server-side call to Softmato, made after the invoice has been
 * checked against what this reader owns. There is no payment status in that
 * URL: Softmato does not put one there, and anything resembling one did not
 * come from them.
 *
 * ## It refreshes, because the webhook is the slower of the two paths
 *
 * The browser usually beats the server-to-server delivery home. So a reader who
 * arrives to `paid` may find their plan not yet activated, and the honest thing
 * is to say the money arrived and we are turning things on — then check again
 * shortly, rather than show a finished screen for an unfinished state.
 */

const POLL_MS = 4_000;
const POLL_LIMIT = 8;

export function CheckoutReturnPage() {
  const params = useSearchParams();
  const invoiceNumber = params.get("invoice") ?? "";

  const [state, setState] = useState<ReturnState | null>(null);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await browserApi<{ state: ReturnState }>(
        `/api/v1/hostel-registration/return?invoice=${encodeURIComponent(invoiceNumber)}`,
      );

      setState(result.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the payment.");
    }
  }, [invoiceNumber]);

  /*
   * The no-invoice case is decided from the URL rather than inside the effect,
   * so nothing calls `setState` synchronously on mount. There is no request to
   * make when the address names no invoice, and starting one to discover that
   * would be an effect whose only job is to set state immediately.
   */
  const missing = invoiceNumber === "";

  useEffect(() => {
    if (missing) return;

    let cancelled = false;

    void (async () => {
      try {
        const result = await browserApi<{ state: ReturnState }>(
          `/api/v1/hostel-registration/return?invoice=${encodeURIComponent(invoiceNumber)}`,
        );

        if (!cancelled) setState(result.state);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not check the payment.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoiceNumber, missing]);

  /*
   * Poll only while the answer can still change, and only for a while. An
   * invoice that is paid or void is finished; one that is unpaid is finished
   * for now, and a reader staring at a spinner for an outcome that needs them
   * to act is worse served than one given a button.
   */
  useEffect(() => {
    if (!state) return;
    if (state.kind !== "pending_document") return;
    if (attempts >= POLL_LIMIT) return;

    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      void load();
    }, POLL_MS);

    return () => clearTimeout(timer);
  }, [attempts, load, state]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col justify-center px-5 py-16">
      <div className="rounded-2xl border border-border bg-surface p-7 shadow-sm">
        {error ? (
          <Outcome
            body={error}
            icon={<XCircle className="size-8 text-destructive" />}
            title="We could not check that payment"
          />
        ) : missing ? (
          <Outcome
            body="This address does not name a payment. Open your registration page to see where things stand."
            icon={<XCircle className="size-8 text-muted-foreground" />}
            title="Nothing to show"
          />
        ) : !state ? (
          <Outcome
            body="Asking Softmato what happened."
            icon={<Loader2 className="size-8 animate-spin text-brand-teal" />}
            title="Checking your payment"
          />
        ) : (
          <Rendered state={state} />
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-teal/90"
            href="/register-hostel"
          >
            Back to my registration
          </Link>

          {state?.kind === "unpaid" || state?.kind === "partial" ? (
            <Link
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-brand-teal/40"
              href="/register-hostel"
            >
              <RotateCcw className="size-4" />
              Try the payment again
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Rendered({ state }: { state: ReturnState }) {
  switch (state.kind) {
    case "paid":
      return (
        <Outcome
          body={`We have your payment for ${state.planName}. Softmato has emailed your receipt with the PDF attached. Your plan activates as soon as their confirmation reaches us — usually within a few seconds.`}
          icon={<CheckCircle2 className="size-8 text-success" />}
          title="Payment received"
        />
      );

    case "partial":
      return (
        <Outcome
          body={`Part of this invoice has been paid. NPR ${state.balance.toLocaleString("en-IN")} is still outstanding on ${state.planName}.`}
          icon={<Clock3 className="size-8 text-warning" />}
          title="Partly paid"
        />
      );

    case "unpaid":
      return (
        <Outcome
          /*
           * Not "your payment failed". The commonest way to reach this is
           * pressing cancel at the wallet, which is a decision rather than an
           * error, and telling somebody their payment failed when they chose
           * not to make one is how a support thread starts.
           */
          body={`This invoice is still open, so nothing has been charged. You can pay it whenever you are ready — the amount and the plan are unchanged.`}
          icon={<Clock3 className="size-8 text-muted-foreground" />}
          title="Not completed"
        />
      );

    case "void":
      return (
        <Outcome
          body="This invoice was withdrawn, so there is nothing to pay against it. If that is unexpected, get in touch and we will look."
          icon={<XCircle className="size-8 text-muted-foreground" />}
          title="Invoice withdrawn"
        />
      );

    case "pending_document":
      return (
        <Outcome
          body="We are waiting on Softmato to confirm this one. Nothing is lost — if you have paid, it will show here and on your billing page shortly."
          icon={<Loader2 className="size-8 animate-spin text-brand-teal" />}
          title="Still checking"
        />
      );

    default:
      return (
        <Outcome
          body="We could not find a payment under that reference for your account. If you have just paid, give it a moment and reload."
          icon={<XCircle className="size-8 text-muted-foreground" />}
          title="Nothing to show"
        />
      );
  }
}

function Outcome({
  body,
  icon,
  title,
}: {
  body: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted/60">
        {icon}
      </div>
      <h1 className="mt-4 text-xl font-bold text-foreground">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
