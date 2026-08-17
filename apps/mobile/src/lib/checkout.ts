import type { IntentHandoff } from "@/lib/finance-api";

/**
 * What the app can actually do with a gateway handoff.
 *
 * ## The eSewa problem, stated plainly
 *
 * `expo-web-browser` opens a **URL**. That is all it can do. eSewa's v2 checkout
 * is a `FORM_POST`: a signed set of fields that must reach the provider as a
 * POST body, in the order the adapter emitted them, because the signature
 * covers only some of them and covers them positionally. There is no way to
 * perform that from a Custom Tab or an `SFSafariViewController` — a `data:` URL
 * carrying a self-submitting form is blocked from top-level navigation by
 * Chrome, and re-signing on the client would mean shipping the merchant secret
 * to a phone.
 *
 * So this returns an honest verdict rather than opening something that will
 * fail after the resident has committed to paying. The web app has the same
 * intent and no such limit (it builds and submits a real form), which is why
 * nothing about the server needs to change for the *web* to work — and why it
 * does need to change for mobile. The fix is server-side: a page that accepts
 * the reference and performs the POST itself, or a provider-hosted URL. Logged
 * as a gap in docs/MOBILE_APP_PHASES.md §M3.
 *
 * ## Why the return trip is polled, not deep-linked
 *
 * The intent's `returnUrl` is built server-side as
 * `{siteUrl}/resident/payments/checkout/{reference}` — a web page, with no
 * mobile scheme anywhere in it. The browser therefore lands back on the website
 * and never redirects to `hostelhub://`, so `openAuthSessionAsync` would wait
 * forever. The app opens a plain browser instead and asks
 * `GET /resident/finance/checkout/{reference}` who actually paid — which is the
 * authority regardless, since the return URL settles nothing by being visited.
 */

export type HandoffPlan =
  | { kind: "OPEN_URL"; url: string }
  | { kind: "SHOW_QR"; payload: string }
  | { kind: "UNSUPPORTED"; reason: string };

export function planHandoff(handoff: IntentHandoff): HandoffPlan {
  if (handoff.kind === "REDIRECT") {
    return { kind: "OPEN_URL", url: handoff.url };
  }

  if (handoff.kind === "QR") {
    return { kind: "SHOW_QR", payload: handoff.payload };
  }

  return {
    kind: "UNSUPPORTED",
    reason:
      "This provider's checkout can't be opened from the app yet. Use one of the other ways to pay below, then submit your proof.",
  };
}

/**
 * When to stop polling a checkout.
 *
 * `settled` is the only field that means the money landed — a `status` of
 * `CREATED` with a provider that has not been reached yet says nothing. An
 * expired intent is terminal too: it stops being payable, and polling a dead
 * reference forever drains a phone that has been left on the screen.
 */
export function isCheckoutFinished(
  status: { expiresAt: string; settled: boolean; status: string },
  now: Date = new Date(),
): boolean {
  if (status.settled) {
    return true;
  }

  if (["CANCELLED", "EXPIRED", "FAILED"].includes(status.status)) {
    return true;
  }

  const expiresAt = Date.parse(status.expiresAt);

  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}
