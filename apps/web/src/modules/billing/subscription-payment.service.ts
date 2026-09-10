import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import {
  openCheckoutSession,
  documentDownloadUrl,
  readSettledReceipt,
} from "@/modules/billing/billing-gateway";
import {
  SubscriptionError,
  ensureInvoiceRaised,
  getSubscriptionState,
  outstandingFor,
  type InvoiceRecord as SubscriptionInvoiceRecord,
} from "@/modules/billing/subscription.service";
import { ensureLocalReceiptNumber } from "@/modules/billing/documents/issue";
import { onPaymentSettled } from "@/modules/hostels/hostel-registration.events";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelSubscriptionModel } from "@hostel/db/models/HostelSubscription";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";

/**
 * Taking money for a plan, and what happens the moment it lands.
 *
 * Settling a payment is the one operation in the whole flow with consequences
 * outside its own collection: it issues a receipt, may activate a subscription,
 * and may publish a hostel to the public directory. Those all live in
 * `settlePayment` rather than being left to the caller, because a caller that
 * forgot one would leave a hostel that has paid in full sitting unpublished
 * with no error anywhere to explain it.
 */

/**
 * The same shape `subscription.service` reads, because `ensureInvoiceRaised`
 * takes one of these and a narrower local copy would only be a copy that
 * drifts — it already had, by two fields.
 */
type InvoiceRecord = SubscriptionInvoiceRecord;

async function loadInvoice(invoiceId: string) {
  const invoice = await SubscriptionInvoiceModel.findById(
    invoiceId,
  ).lean<InvoiceRecord | null>();

  if (!invoice) {
    throw new SubscriptionError("Invoice not found.", "INVOICE_NOT_FOUND", 404);
  }

  if (invoice.status === "VOID") {
    throw new SubscriptionError(
      "That invoice was voided, so it cannot take a payment.",
      "INVOICE_VOID",
      409,
    );
  }

  return invoice;
}

/* -- Opening a checkout ------------------------------------------------- */

/**
 * Opens a Softmato checkout for what is still owed, and returns where to send
 * the payer.
 *
 * ## The amount is not negotiable here
 *
 * `POST /v1/checkout` has no amount parameter -- Softmato reads it from the
 * invoice -- so an online payment settles the invoice in full. That is why this
 * takes no `amount` from the caller: there is nowhere to put one, and a client
 * that could choose its own price would be the vulnerability the API is shaped
 * to prevent.
 *
 * A part-paid invoice therefore cannot be finished online against the same
 * document. The team desk collects partials in cash; if that ever needs an
 * online tail, the balance gets its own invoice rather than a checkout that
 * quietly underpays this one.
 *
 * ## A session is minted per attempt, never stored
 *
 * It lives thirty minutes and it is closer to a cheque than to a link --
 * forwarded, reused, or paid after the price changed. So this runs every time
 * the owner presses Pay, including retries, and nothing persists the URL.
 *
 * The `PENDING` row is written first so an abandoned attempt still leaves a
 * trace. It is worth nothing until it settles: `outstandingFor` sums only
 * `SETTLED` rows, so writing one early cannot publish a hostel by accident.
 */
export async function openSubscriptionCheckout(
  invoiceId: string,
  actorId: string,
) {
  await connectToDatabase();

  const loaded = await loadInvoice(invoiceId);
  const { outstanding } = await outstandingFor(loaded);

  if (outstanding <= 0) {
    throw new SubscriptionError(
      "This invoice is already settled in full.",
      "ALREADY_SETTLED",
      409,
    );
  }

  if (outstanding !== loaded.amount) {
    throw new SubscriptionError(
      "Part of this invoice has already been paid, so it cannot be settled online. Ask the platform team to raise the balance as its own invoice.",
      "PARTIALLY_PAID_ONLINE",
      409,
    );
  }

  /*
   * Required here, unlike at issue time: a checkout is addressed by Softmato's
   * invoice id and reads the amount from it, so without the document there is
   * nothing to check out against.
   */
  const invoice = await ensureInvoiceRaised(loaded, { required: true });

  if (!invoice.softmatoInvoiceId) {
    throw new SubscriptionError(
      "This invoice has no payment document yet. Try again in a moment.",
      "INVOICE_NOT_RAISED",
      503,
    );
  }

  const session = await openCheckoutSession({
    invoiceNumber: invoice.invoiceNumber,
    softmatoInvoiceId: invoice.softmatoInvoiceId,
  });

  const payment = await SubscriptionPaymentModel.create({
    amount: outstanding,
    hostelId: invoice.hostelId,
    invoiceId: invoice._id,
    method: "SOFTMATO",
    recordedBy: actorId,
    softmatoSessionId: session.sessionId,
    status: "PENDING",
    subscriptionId: invoice.subscriptionId,
  });

  return {
    allowedProviders: session.allowedProviders,
    checkoutUrl: session.checkoutUrl,
    expiresAt: session.expiresAt,
    payment: { amount: outstanding, id: String(payment._id) },
  };
}

/* ── Cash ──────────────────────────────────────────────────────────────── */

/**
 * Records money an agent took in the field, already settled.
 *
 * Two methods arrive here and they differ only in who is holding the money
 * afterwards. `CASH` is notes in the agent's hand. `SOFTMATO` is the owner
 * scanning a QR while the agent watches — the funds go to the platform's
 * account rather than the agent's pocket, so nothing is owed back, but the
 * *claim* that it happened comes from the same person either way.
 *
 * ## Why a QR payment settles here rather than waiting for a webhook
 *
 * Because there is no webhook yet. The gateway is mocked, so the alternative is
 * a `PENDING` row that nothing will ever confirm and an owner who paid staring
 * at an unpaid invoice. An honest manual entry beats a promise the system
 * cannot keep — and `isMocked` is written on the row so it can never later be
 * mistaken for a reconciled settlement. When a real merchant account lands,
 * this branch narrows back to cash and the QR returns to the rail.
 *
 * `collectedBy` is required on both and is the field the team roster reads to
 * answer "who collected how much": a row without one would be money the
 * platform received from nobody.
 */
export async function recordFieldCollection(
  invoiceId: string,
  input: { amount: number; method: "CASH" | "SOFTMATO"; reference?: string },
  agentId: string,
) {
  await connectToDatabase();

  if (!agentId) {
    throw new SubscriptionError(
      "A field collection has to be attributed to the person who took it.",
      "COLLECTOR_REQUIRED",
      422,
    );
  }

  const invoice = await loadInvoice(invoiceId);
  const { outstanding } = await outstandingFor(invoice);

  if (input.amount > outstanding) {
    throw new SubscriptionError(
      `That is more than the ${outstanding} still owed on this invoice.`,
      "AMOUNT_EXCEEDS_OUTSTANDING",
      422,
    );
  }

  const payment = await SubscriptionPaymentModel.create({
    amount: input.amount,
    collectedBy: agentId,
    hostelId: invoice.hostelId,
    invoiceId: invoice._id,
    /*
     * A QR collection is mocked money until there is a gateway to corroborate
     * it. Cash never claims to be on a rail in the first place, so it is not
     * marked — `isMocked` means "this asserts a gateway settlement that did not
     * go through a gateway", which is true of exactly one of these two.
     */
    isMocked: input.method === "SOFTMATO",
    method: input.method,
    recordedBy: agentId,
    status: "PENDING",
    subscriptionId: invoice.subscriptionId,
  });

  return settlePayment(String(payment._id), {
    actorId: agentId,
    gatewayReference: input.reference,
  });
}

/* ── Settling ──────────────────────────────────────────────────────────── */

/**
 * Marks a payment received, then applies everything that follows from it.
 *
 * In order, and all of it here rather than at the call site:
 *
 * 1. the payment settles and gets its receipt number and document;
 * 2. the invoice moves to `PAID` or `PARTIAL` from the recomputed balance;
 * 3. the subscription activates if nothing is left owed, or carries a due if
 *    money is still outstanding on a team-filed registration;
 * 4. the hostel publishes, if the rules for its source now allow it.
 *
 * Step 4 is where the two desks finally diverge, and it is the only branch:
 * **a public hostel publishes when it has paid in full; a team-filed hostel is
 * already published and stays that way while it owes.**
 */
export async function settlePayment(
  paymentId: string,
  options: {
    actorId?: string;
    /**
     * When present, the payment must belong to this hostel or the call is
     * refused.
     *
     * Callers that reached here from an owner-scoped route have authorised a
     * *hostel*, not a payment id, and the id then arrives in the request body.
     * Without this check, an owner of one hostel could authorise against their
     * own and then post somebody else's payment id — settling a stranger's
     * invoice and publishing a hostel that had not paid. The gateway callback,
     * which is authorised by the gateway rather than by a session, passes
     * nothing here and is unaffected.
     */
    expectedHostelId?: string;
    gatewayReference?: string;
  } = {},
) {
  await connectToDatabase();

  const payment = await SubscriptionPaymentModel.findById(paymentId).lean<{
    _id: Types.ObjectId;
    amount: number;
    hostelId: Types.ObjectId;
    invoiceId: Types.ObjectId;
    isMocked?: boolean;
    method: string;
    softmatoTransactionNo?: string | null;
    status: string;
    subscriptionId: Types.ObjectId;
  } | null>();

  if (!payment) {
    throw new SubscriptionError("Payment not found.", "PAYMENT_NOT_FOUND", 404);
  }

  if (
    options.expectedHostelId &&
    payment.hostelId.toString() !== options.expectedHostelId
  ) {
    // Same wording as a missing payment, deliberately: a caller probing ids
    // should not learn which of them exist.
    throw new SubscriptionError("Payment not found.", "PAYMENT_NOT_FOUND", 404);
  }

  /*
   * **Claim the row before doing anything with consequences.**
   *
   * Idempotent: a gateway that delivers its callback twice must not issue two
   * receipts for one payment. Reading the status and then writing it would
   * leave a window between the two that both deliveries pass through — and
   * webhook deliveries retry until they get a 2xx, so concurrent duplicates are
   * the expected traffic rather than a rare race.
   *
   * A single conditional update is the claim. Exactly one caller can move a row
   * out of `PENDING`; everyone else gets `null` here and returns having done
   * nothing. Everything below — the receipt number, the email, the activation,
   * the publish — therefore happens once.
   */
  const claimed = await SubscriptionPaymentModel.findOneAndUpdate(
    { _id: payment._id, status: "PENDING" },
    { $set: { settledAt: new Date(), status: "SETTLED" } },
    { new: true },
  ).lean<{ _id: Types.ObjectId } | null>();

  if (!claimed) {
    return getSubscriptionState(payment.hostelId.toString());
  }

  const invoice = await loadInvoice(payment.invoiceId.toString());
  const receiptNumber = await allocateReceiptNumber(invoice.hostelId);

  /*
   * Two kinds of receipt, and only one of them is a document we can produce.
   *
   * A Softmato payment already has one: they issue it the moment money lands
   * and email it to the owner with the PDF attached. So this reads theirs
   * rather than inventing a second document that would disagree with the one
   * already in the owner's inbox.
   *
   * A cash payment has none, because there is no transaction on any rail to
   * receipt. It keeps our own `SRC-` number and a null document — the honest
   * representation of an internal record, and better than a URL that 404s.
   *
   * Our number is allocated either way, so our own sequence stays complete and
   * every settled payment has one handle that is ours.
   */
  const receipt = payment.softmatoTransactionNo
    ? await readSettledReceipt(payment.softmatoTransactionNo).catch((error) => {
        /*
         * A receipt we cannot read must not stop us provisioning. The money is
         * confirmed — that came from a verified webhook or a server-side
         * transaction read, not from this call — and withholding the service
         * because a document endpoint was slow would punish the owner for our
         * outage. The billing screen fetches it live anyway.
         */
        console.error(
          JSON.stringify({
            action: "softmato_receipt_read_failed",
            level: "error",
            message: error instanceof Error ? error.message : String(error),
            transactionNo: payment.softmatoTransactionNo,
          }),
        );

        return null;
      })
    : null;

  await SubscriptionPaymentModel.updateOne(
    { _id: payment._id },
    {
      $set: {
        ...(options.gatewayReference
          ? { gatewayReference: options.gatewayReference }
          : {}),
        ...(receipt?.providerRef
          ? { gatewayReference: receipt.providerRef }
          : {}),
        ...(receipt?.provider ? { softmatoProvider: receipt.provider } : {}),
        receiptDocumentUrl:
          receipt?.documentUrl ?? documentDownloadUrl("receipt", receiptNumber),
        receiptIssuedAt: new Date(),
        receiptNumber,
      },
    },
  );

  /*
   * **A receipt exists either way now.**
   *
   * When Softmato issued one, theirs is the document and this does nothing.
   * When they did not — a cash payment, or their API unreachable — we number
   * and print our own, so a settled payment is never a payment with no paper.
   * The URL above is our route in both cases; it resolves whichever document
   * actually exists (`documents/deliver.ts`), so nothing downstream has to know
   * which side printed it.
   */
  if (!receipt) {
    await ensureLocalReceiptNumber(payment._id);
  }

  const balance = await outstandingFor(invoice);

  await SubscriptionInvoiceModel.updateOne(
    { _id: invoice._id },
    { $set: { status: balance.outstanding <= 0 ? "PAID" : "PARTIAL" } },
  );

  const subscriptionAfter = await applySettlement(
    invoice,
    balance.outstanding,
    options.actorId,
  );

  const billingContact = await resolveOwnerEmail(invoice.hostelId);

  await onPaymentSettled({
    amount: payment.amount,
    dueBy: subscriptionAfter?.dueBy ?? null,
    hostelName: billingContact.hostelName,
    invoiceNumber: invoice.invoiceNumber,
    method: payment.method,
    outstanding: balance.outstanding,
    ownerEmail: billingContact.email,
    planName: invoice.planName,
    receiptNumber,
  });

  await AuditLogModel.create({
    action: "SUBSCRIPTION_PAYMENT_SETTLED",
    actorId: options.actorId ?? null,
    /*
     * A webhook settlement has no actor, and says so rather than borrowing
     * one. Nobody on our side did this: Softmato told us money arrived, on a
     * signature we verified. Naming the hostel owner here would put them in
     * the audit trail for an act they did not perform — they paid at a
     * wallet, which is a different event on somebody else's ledger.
     */
    actorType: options.actorId ? "USER" : "SYSTEM",
    entityId: String(payment._id),
    entityType: "SubscriptionPayment",
    hostelId: invoice.hostelId,
    metadata: {
      amount: payment.amount,
      invoiceNumber: invoice.invoiceNumber,
      method: payment.method,
      mocked: Boolean(payment.isMocked),
      outstandingAfter: balance.outstanding,
      receiptNumber,
    },
  });

  return getSubscriptionState(invoice.hostelId.toString());
}

/** `SRC-0001-4F2A`. Per hostel, lifetime — see `allocateNumber` next door. */
async function allocateReceiptNumber(hostelId: Types.ObjectId) {
  const counter = await ReceiptCounterModel.findOneAndUpdate(
    { hostelId, kind: "SUBSCRIPTION_RECEIPT", period: "LIFETIME" },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = String(counter?.sequence ?? 1).padStart(4, "0");

  return `SRC-${sequence}-${hostelId.toString().slice(-4).toUpperCase()}`;
}

/**
 * Moves the subscription and, where the rules allow, the hostel.
 *
 * The whole public/team difference is the `source` check below. Everything
 * above this point ran identically for both.
 */
async function applySettlement(
  invoice: InvoiceRecord,
  outstanding: number,
  actorId?: string,
): Promise<{ dueBy: Date | null } | null> {
  const subscription = await HostelSubscriptionModel.findById(
    invoice.subscriptionId,
  ).lean<{ _id: Types.ObjectId; cycleMonths?: number | null; source?: string } | null>();

  if (!subscription) {
    return null;
  }

  if (outstanding <= 0) {
    const periodEnd = new Date();

    periodEnd.setMonth(periodEnd.getMonth() + (invoice.cycleMonths || 1));

    await HostelSubscriptionModel.updateOne(
      { _id: subscription._id },
      {
        $set: {
          activatedAt: new Date(),
          currentPeriodEnd: periodEnd,
          dueBy: null,
          status: "ACTIVE",
        },
      },
    );

    await publishForSubscription(invoice.hostelId, actorId);

    return { dueBy: null };
  }

  // Still owed. Only a team registration may live in this state — a public one
  // simply stays unpublished and unactivated until it clears.
  if (subscription.source === "TEAM") {
    const operations = await getOperationsConfig();
    const dueBy = new Date();

    dueBy.setDate(dueBy.getDate() + operations.subscriptionDueGraceDays);

    await HostelSubscriptionModel.updateOne(
      { _id: subscription._id },
      { $set: { dueBy, status: "PAST_DUE" } },
    );

    return { dueBy };
  }

  return { dueBy: null };
}

/** Who the receipt goes to, and the hostel it names. */
async function resolveOwnerEmail(hostelId: Types.ObjectId) {
  const { UserModel } = await import("@hostel/db/models/User");
  const hostel = await HostelModel.findById(hostelId)
    .select("ownerId contact name")
    .lean<{
      contact?: { email?: string };
      name?: string;
      ownerId?: Types.ObjectId;
    } | null>();

  const owner = hostel?.ownerId
    ? await UserModel.findById(hostel.ownerId)
        .select("email")
        .lean<{ email?: string } | null>()
    : null;

  return {
    email: owner?.email ?? hostel?.contact?.email ?? "",
    hostelName: hostel?.name ?? "",
  };
}

/**
 * Publishes the hostel now that its plan is paid for.
 *
 * Deliberately does not go through `publishPlatformHostel`: that one is a
 * superadmin action carrying a principal and a "verified first" guard aimed at
 * a human clicking Approve. This is the automatic consequence of money landing,
 * so it writes the status directly and leaves the audit trail to the settlement
 * entry that called it. A hostel already published — every team-filed one — is
 * left exactly as it is.
 */
async function publishForSubscription(hostelId: Types.ObjectId, actorId?: string) {
  const hostel = await HostelModel.findById(hostelId)
    .select("status verificationStatus")
    .lean<{ status?: string; verificationStatus?: string } | null>();

  if (!hostel || hostel.status === "PUBLISHED") {
    return;
  }

  await HostelModel.updateOne(
    { _id: hostelId },
    {
      $set: {
        status: "PUBLISHED",
        ...(actorId ? { updatedBy: actorId } : {}),
        verificationStatus: "VERIFIED",
      },
    },
  );
}
