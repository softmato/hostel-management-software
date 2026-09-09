"use client";

import { AlertTriangle, Loader2, QrCode, X } from "lucide-react";
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
 * something else, which is the top of every screen, and it has to be payable
 * from where it appears rather than sending them off to find a billing page.
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
  const [charge, setCharge] = useState<{ mocked: boolean; paymentId: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [hostelId, setHostelId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const result = await browserApi<{
          state: (State & { subscription: { id: string } }) | null;
        }>("/api/v1/hostel-admin/subscription");

        setState(result.state);

        const me = await browserApi<{ user: { hostelIds?: string[] } }>(
          "/api/v1/auth/me",
        );

        setHostelId(me.user.hostelIds?.[0] ?? null);
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
    !hostelId ||
    state.subscription.status !== "PAST_DUE" ||
    state.outstanding <= 0
  ) {
    return null;
  }

  const remaining = state.subscription.dueBy ? daysUntil(state.subscription.dueBy) : null;
  const overdue = remaining !== null && remaining < 0;

  async function pay() {
    setWorking(true);

    try {
      if (!charge) {
        const opened = await browserApi<{
          mocked: boolean;
          payment: { id: string };
        }>(`/api/v1/hostel-registration/${hostelId}/pay`, {
          body: JSON.stringify({ action: "open", amount: state!.outstanding }),
          method: "POST",
        });

        setCharge({ mocked: opened.mocked, paymentId: opened.payment.id });

        return;
      }

      await browserApi(`/api/v1/hostel-registration/${hostelId}/pay`, {
        body: JSON.stringify({ action: "confirm", paymentId: charge.paymentId }),
        method: "POST",
      });

      setState(null);
    } catch {
      setCharge(null);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle className="size-4 shrink-0 text-warning" />

        <p className="min-w-0 flex-1 text-sm text-foreground">
          <strong className="font-semibold">
            {rupees(state.outstanding)} is due for your{" "}
            {state.subscription.planName ?? "plan"}
          </strong>
          {remaining === null
            ? "."
            : overdue
              ? ` — it was due ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "day" : "days"} ago.`
              : ` — please pay within ${remaining} ${remaining === 1 ? "day" : "days"}.`}{" "}
          <span className="text-muted-foreground">
            Your listing stays live in the meantime.
          </span>
        </p>

        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-60"
          disabled={working}
          onClick={pay}
          type="button"
        >
          {working ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <QrCode className="size-3.5" />
          )}
          {charge ? `Confirm ${rupees(state.outstanding)}` : "Pay now"}
        </button>

        <button
          aria-label="Hide until next visit"
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-foreground"
          onClick={() => setDismissed(true)}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      {charge?.mocked ? (
        <p className="mt-2 pl-7 text-xs text-warning">
          Fonepay is not connected yet — confirming records the payment so your balance
          is correct.
        </p>
      ) : null}
    </div>
  );
}
