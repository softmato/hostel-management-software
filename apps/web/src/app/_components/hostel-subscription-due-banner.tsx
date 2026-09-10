"use client";

import { AlertTriangle, Clock, QrCode, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { browserApi } from "@/lib/browser-api";

/**
 * "Please pay this much within N days" — the due a team registration leaves
 * behind.
 *
 * ## Why it is a banner and not a page
 *
 * A hostel in this state is **live**. Its listing is up, students can find it,
 * and it is being run day to day by somebody who did not necessarily make the
 * payment arrangement — the owner met an agent once and an amount was agreed.
 * So the reminder has to be somewhere they cannot miss on the way to doing
 * something else, which is the top of every screen.
 *
 * ## The button navigates; it does not pay
 *
 * It used to. `Pay now` posted `{ action: "open" }` and then, on a second
 * press, `{ action: "confirm" }` — and the route behind it had dropped both
 * branches when settlement moved to a verified webhook, so the pair opened two
 * checkouts and told the owner their payment was recorded. **A browser cannot
 * record a payment.** The banner is a reminder now and nothing more: it points
 * at Plan billing, where the QR and the proof form live.
 *
 * ## It knows when a claim is already in review
 *
 * A balance stays outstanding while we are checking a proof, so without this
 * the banner would keep asking an owner who paid this morning to pay again.
 *
 * ## Why it cannot be dismissed permanently
 *
 * Closing it hides it for the session and no longer. A due with a deadline that
 * a hostel could switch off is a due nobody pays; the dismissal exists so
 * somebody can get through one piece of work without it in the way, not so they
 * can decide never to see it.
 *
 * ## It renders nothing in every other state
 *
 * A hostel that paid in full, one that predates plan billing, one whose
 * registration is still public and unpublished — all of them get no banner at
 * all. Only `PAST_DUE` with money actually outstanding produces one.
 */

type State = {
  invoice: { id: string; invoiceNumber: string } | null;
  outstanding: number;
  /** Every attempt against the plan. Read for one thing: an `IN_REVIEW` row. */
  payments?: { status: string }[];
  subscription: { dueBy: string | null; planName: string | null; status: string };
};

function rupees(amount: number) {
  return `Rs ${amount.toLocaleString("en-IN")}`;
}

/** Whole days from now until the deadline. Negative once it has passed. */
function daysUntil(iso: string) {
  const target = new Date(iso).getTime();

  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
}

export function HostelSubscriptionDueBanner() {
  const [state, setState] = useState<State | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const result = await browserApi<{
          state: (State & { subscription: { id: string } }) | null;
        }>("/api/v1/hostel-admin/subscription");

        setState(result.state);
      } catch {
        // A banner that cannot load its own data shows nothing. It is a
        // reminder, not a gate — failing loudly here would put an error across
        // the top of every screen in the portal.
        setState(null);
      }
    }

    void load();
  }, []);

  if (
    dismissed ||
    !state ||
    state.subscription.status !== "PAST_DUE" ||
    state.outstanding <= 0
  ) {
    return null;
  }

  const remaining = state.subscription.dueBy ? daysUntil(state.subscription.dueBy) : null;
  const overdue = remaining !== null && remaining < 0;
  const reviewing = Boolean(
    state.payments?.some((payment) => payment.status === "IN_REVIEW"),
  );

  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle className="size-4 shrink-0 text-warning" />

        <p className="min-w-0 flex-1 text-sm text-foreground">
          <strong className="font-semibold">
            {rupees(state.outstanding)} is due for your{" "}
            {state.subscription.planName ?? "plan"}
          </strong>
          {reviewing
            ? " — we have your proof and are checking it."
            : remaining === null
              ? "."
              : overdue
                ? ` — it was due ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "day" : "days"} ago.`
                : ` — please pay within ${remaining} ${remaining === 1 ? "day" : "days"}.`}{" "}
          <span className="text-muted-foreground">
            {reviewing
              ? "We will email you within 1–2 working days. Your listing stays live."
              : "Your listing stays live in the meantime."}
          </span>
        </p>

        {/*
          A link, not a form. Paying is four steps — read the amount, scan our
          QR, pay in another app, send the proof back — and a banner is the
          wrong object to carry any of them. Plan billing already holds all
          four, so this is the shortest honest route to them.
        */}
        <Link
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
          href="/hostel-admin/billing"
        >
          {reviewing ? (
            <Clock className="size-3.5" />
          ) : (
            <QrCode className="size-3.5" />
          )}
          {reviewing ? "See the status" : "Pay now"}
        </Link>

        <button
          aria-label="Hide until next visit"
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-foreground"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

    </div>
  );
}
