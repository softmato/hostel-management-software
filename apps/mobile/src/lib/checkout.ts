import type { IntentHandoff } from "@/lib/finance-api";

/**
 * What the app can actually do with a gateway handoff.
 *
 * ## The eSewa problem, and the relay that solves it
 *
 * `expo-web-browser` opens a **URL**. That is all it can do. eSewa's v2 checkout
 * is a `FORM_POST`: a signed set of fields that must reach the provider as a
 * POST body, in the order the adapter emitted them, because the signature covers
 * only some of them and covers them positionally. There is no way to perform
 * that from a Custom Tab or an `SFSafariViewController` — a `data:` URL carrying
 * a self-submitting form is blocked from top-level navigation by Chrome, and
 * re-signing on the client would mean shipping the merchant secret to a phone.
 *
 * The fix is server-side and landed 2026-08-17: `/pay/{reference}` on our own
 * origin re-derives the same signed fields from the stored intent and serves
 * them as a real form that submits itself. So the phone opens a URL, which is
 * the one thing it can do, and the *resident's* browser is still what arrives at
 * eSewa — which was always the requirement, and the reason the server could not
 * simply POST on their behalf.
 *
 * **The fields in hand are deliberately ignored.** They are not re-sent, encoded
 * into a query string, or hashed into the URL: the reference is the only thing
 * that travels, and the server rebuilds everything else. A signature in a URL is
 * a signature in a browser history, a server log and a referrer header.
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

/**
 * The relay page. Built here so the reference is the only thing in the URL.
 *
 * `baseUrl` is a parameter rather than an import of `API_BASE_URL`, because
 * `lib/api.ts` pulls in axios and therefore React Native — and Vitest here runs
 * node-side with no RN shim, so importing it would make this whole module
 * untestable. Same reason `lib/food-week.ts` holds its own enums.
 */
export function relayUrl(reference: string, baseUrl: string): string {
  return `${baseUrl}/pay/${encodeURIComponent(reference)}`;
}

export function planHandoff(
  handoff: IntentHandoff,
  { baseUrl, reference }: { baseUrl: string; reference: string },
): HandoffPlan {
  if (handoff.kind === "REDIRECT") {
    /*
     * Straight to the provider's own URL, never through the relay: a REDIRECT
     * is already a URL, and wrapping it would put a browser between the
     * resident and the wallet app that claims that domain — the app which
     * already holds their session, their balance and their biometric unlock.
     */
    return { kind: "OPEN_URL", url: handoff.url };
  }

  if (handoff.kind === "QR") {
    return { kind: "SHOW_QR", payload: handoff.payload };
  }

  if (handoff.kind === "FORM_POST") {
    return { kind: "OPEN_URL", url: relayUrl(reference, baseUrl) };
  }

  // An `IntentHandoff` kind this build does not know about — a provider added
  // server-side after the app shipped. Saying so beats opening nothing.
  return {
    kind: "UNSUPPORTED",
    reason:
      "This provider's checkout needs a newer version of the app. Use one of the other ways to pay below, then submit your proof.",
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
