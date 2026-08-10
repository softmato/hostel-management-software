/**
 * The interface every payment provider implements (target §6.5, plan §4.2).
 *
 * Written before any provider exists, and that is deliberate: Fonepay, eSewa and
 * Khalti all follow the same shape — merchant code plus shared secret, initiate
 * → redirect or QR → **server-side lookup** — and fixing the shape first is what
 * stops the second integration from being a copy of the first with the names
 * changed.
 *
 * Three rules are encoded in the types rather than left to each implementation:
 *
 * 1. **`verify` is not optional.** Target §6.5 step 7c: never trust the webhook
 *    body alone. A provider that cannot be independently asked "did this
 *    transaction really happen, for this amount" cannot be integrated, because
 *    the alternative is settling money on the word of an unauthenticated POST.
 * 2. **`parseWebhook` returns a reference, never a settlement.** It says what the
 *    payload *claims*; `verify` says what is true. Keeping them separate is what
 *    makes the rule above impossible to skip by accident.
 * 3. **The return URL is absent from this interface entirely.** It is guessable
 *    and carries no authority, and its only job is to show a "checking…" state.
 *    Giving it no seam here means no provider can grow one.
 */

export type GatewayProviderName = "ESEWA" | "FONEPAY" | "KHALTI";

/** Resolved per hostel by `secret-store.ts`. Never logged, never serialised. */
export type GatewayCredentials = {
  merchantCode: string;
  /** Signs our requests and verifies their callbacks. */
  secret: string;
  /**
   * Separate webhook secret where the provider issues one. Falls back to
   * `secret` for providers that sign with a single shared key.
   */
  webhookSecret: string;
  /** True while the sandbox credentials are in use — surfaced in the UI. */
  sandbox: boolean;
};

/** What we ask the provider to collect. */
export type PaymentIntentRequest = {
  amount: number;
  credentials: GatewayCredentials;
  /** Where the provider should POST its callback. Ours, registered with them. */
  callbackUrl: string;
  invoiceId: string;
  /** Our reference code (target §5) — the merchant transaction reference. */
  referenceCode: string;
  /** Distinguishes retries of the same invoice; part of the idempotency key. */
  attempt: number;
};

export type PaymentIntent = {
  /** When this intent stops being payable. Drives the countdown and the sweep. */
  expiresAt: Date;
  /** Deep links into wallet apps, where the provider offers them. */
  deeplinks?: { label: string; url: string }[];
  /** The provider's own transaction id for this attempt, if issued up front. */
  providerRef: string | null;
  /** QR payload to render. A string we encode ourselves — never a remote image. */
  qrPayload: string;
};

/**
 * What a webhook body claims, once its signature has verified.
 *
 * Deliberately thin. Anything richer would invite a caller to settle from it,
 * which is the one thing target §6.5 forbids.
 */
export type WebhookClaim = {
  amount: number;
  providerTxnId: string;
  /** Our reference code, echoed back by the provider. */
  referenceCode: string | null;
};

/** The provider's own answer, obtained by calling them. This is what settles. */
export type VerificationResult = {
  amount: number;
  providerTxnId: string;
  /** Only `SUCCESS` may settle. Anything else is recorded and left pending. */
  status: "FAILED" | "PENDING" | "SUCCESS";
};

export type SettlementRecord = {
  amount: number;
  providerTxnId: string;
  settledAt: Date;
};

export type GatewayProvider = {
  name: GatewayProviderName;

  /** Creates a payment attempt and returns what the resident's screen renders. */
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntent>;

  /**
   * Verifies the callback's signature and extracts its claim.
   *
   * Returns null for anything that does not verify — an unsigned body, a bad
   * signature, an unparseable payload. The caller's only correct response to
   * null is to reject the request, so there is nothing else to distinguish.
   */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string>,
    credentials: GatewayCredentials,
  ): WebhookClaim | null;

  /**
   * Asks the provider directly what happened. **This is what settles money.**
   *
   * Called even when the webhook signature verified, because a valid signature
   * proves the message came from the provider — not that the payment succeeded,
   * nor that the amount in the body is the amount that moved.
   */
  verify(
    providerTxnId: string,
    referenceCode: string,
    credentials: GatewayCredentials,
  ): Promise<VerificationResult>;

  /**
   * The provider's settlement report for a date range (target §10.2).
   *
   * The only thing that catches a webhook endpoint quietly returning 500 for a
   * week — every other signal looks identical to "nobody paid".
   */
  listSettlements?(
    range: { from: Date; to: Date },
    credentials: GatewayCredentials,
  ): Promise<SettlementRecord[]>;
};
