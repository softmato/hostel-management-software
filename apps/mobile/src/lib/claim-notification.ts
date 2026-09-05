/**
 * What the system notification for a payment claim should say. Decisions only.
 *
 * The `expo-notifications` half is `lib/claim-notifier.ts`, which is verified on
 * a device. Everything with a rule in it lives here so it can be tested on node,
 * the same split `lib/upload-notification.ts` keeps against its own notifier.
 *
 * ## Why this screen posts notifications at all
 *
 * Submitting proof of a rent payment is the one flow in this app where the
 * resident is **waiting on the server to think**. The read takes seconds — an
 * upload over mobile data plus recognition over a full receipt — and a resident
 * who switches to their wallet app to copy a transaction ID, or simply locks the
 * phone, has until now come back to a screen whose answer they missed and whose
 * toast is long gone.
 *
 * Notifications close that. The rule for which events qualify follows from it:
 * **conclusions, never progress.** "Opening your receipt…" is already on the
 * screen with a spinner beside it and would be noise in the shade; "that file
 * cannot be used as proof" is a fact the resident has to act on and may well be
 * somewhere else when it lands.
 *
 * ## Nothing sensitive in the body
 *
 * A notification renders on a **locked screen**, which is not a private surface —
 * a receipt is a financial document and the shade is read over shoulders. So the
 * body carries what the resident must do next, never what we read off their
 * receipt: no amount, no transaction id, no account name, no payee. The reason a
 * file was refused is a category, not a quotation.
 */

/** Android channel for claim outcomes. */
export const CLAIM_CHANNEL = "payment-claims";

/** What the user sees this channel called in system settings. */
export const CLAIM_CHANNEL_NAME = "Payment proof";

/** Marks a claim notification, so a tap can be routed and tests can assert it. */
export const CLAIM_NOTIFICATION_TYPE = "payment-claim";

/**
 * How loud, and in which direction.
 *
 * `failure` is every refusal — a file that cannot be used, an upload that did
 * not arrive, a submit the server turned away. `success` is the one good ending.
 * There is deliberately no `warning`: the two non-blocking warnings this screen
 * shows (a statement rather than a receipt, a file that does not look like a
 * receipt) let the resident submit anyway, so they are advice on a form the
 * resident is still filling in — not a conclusion worth interrupting them for.
 */
export type ClaimOutcomeTone = "failure" | "success";

export type ClaimOutcome = {
  /** One line, ≤ ~80 chars. What to do next, never what was on the receipt. */
  body: string;
  tone: ClaimOutcomeTone;
  /** The heading in the shade. */
  title: string;
};

export type ClaimNotice = {
  body: string;
  /** Routed by `resolvePushPath`, which already understands `/invoice/{id}`. */
  path: string;
  title: string;
  tone: ClaimOutcomeTone;
};

/**
 * The longest a notification body may be before the shade truncates it mid-word.
 *
 * The server's refusals are written for a form — up to two sentences naming the
 * account or the direction it read — and pasted into a notification they are cut
 * off at an arbitrary point, which is how a resident ends up reading half a
 * sentence about their own money. Anything over this is replaced rather than
 * clipped, by {@link claimNotice}'s caller passing a short body.
 */
export const CLAIM_BODY_LIMIT = 120;

/**
 * Trims a body to something a notification can show whole.
 *
 * Cuts at a sentence end where there is one inside the limit, because the first
 * sentence of every refusal on this screen is the one that names the problem and
 * the rest is the remedy — which is on the screen the tap leads to anyway.
 */
export function claimBody(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");

  if (clean.length <= CLAIM_BODY_LIMIT) {
    return clean;
  }

  const firstSentence = /^(.{20,}?[.!?])\s/.exec(clean);

  if (firstSentence && firstSentence[1]!.length <= CLAIM_BODY_LIMIT) {
    return firstSentence[1]!;
  }

  // No sentence break to use, so cut on a word and mark it as cut.
  const cut = clean.slice(0, CLAIM_BODY_LIMIT - 1);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The notification for one claim outcome, or null when there is nothing to post.
 *
 * Null on a missing invoice id rather than posting an unroutable notification: a
 * notification that does nothing when tapped is worse than none, because it
 * teaches the resident that ours are not worth tapping.
 */
export function claimNotice(
  outcome: ClaimOutcome,
  invoiceId: string | null | undefined,
): ClaimNotice | null {
  const id = (invoiceId ?? "").trim();

  if (!id) {
    return null;
  }

  return {
    body: claimBody(outcome.body),
    path: `/invoice/${id}`,
    title: outcome.title.trim(),
    tone: outcome.tone,
  };
}
