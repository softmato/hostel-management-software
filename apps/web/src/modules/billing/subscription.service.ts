import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { issueInvoiceDocument, type EnsureInvoiceInput } from "@/modules/billing/billing-gateway";
import { isSoftmatoDown } from "@/modules/billing/softmato/client";
import { rememberTask } from "@/modules/billing/softmato/outage";
import { servicePeriod } from "@/modules/billing/softmato/invoice";
import { buildPresentation } from "@/modules/billing/softmato/presentation";
import { onInvoiceIssued } from "@/modules/hostels/hostel-registration.events";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import { getSiteConfigSection } from "@/modules/platform-config/site-config.service";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelSubscriptionModel } from "@hostel/db/models/HostelSubscription";
import { ReceiptCounterModel } from "@hostel/db/models/ReceiptCounter";
import { SubscriptionInvoiceModel } from "@hostel/db/models/SubscriptionInvoice";
import { SubscriptionPaymentModel } from "@hostel/db/models/SubscriptionPayment";
import { currentBsPeriod, hostelDayEnd } from "@hostel/shared/calendar/bs";
import {
  cycleMonths,
  cycleTotal,
  getPlan,
  sellingCatalog,
} from "@hostel/shared/plans/catalog";
import type { BillingCycle } from "@hostel/shared/plans/catalog";

/**
 * The plan lifecycle: choose, be invoiced, pay, go live.
 *
 * ## The one rule that shapes everything here
 *
 * **What a hostel still owes is never stored.** It is the invoice amount minus
 * the settled payments against it, computed on every read by `outstandingFor`.
 * `Invoice` one level down explains why at length and this follows it: a stored
 * balance is a number two writers can disagree about, and the disagreement is
 * silent until somebody is published for free or billed twice.
 *
 * ## Two desks, one ledger
 *
 * The public and team flows differ in exactly two places, and both are here
 * rather than scattered:
 *
 * - **when the invoice is raised** — public on *Pay now*, team when the agent
 *   moves past the plan step;
 * - **what an unpaid balance means** — a public hostel stays unpublished until
 *   it clears; a team-filed hostel publishes anyway and carries a due, because
 *   our own staff stood in the building and checked it.
 *
 * Everything else — numbering, documents, receipts, activation arithmetic — is
 * one path with no branch in it.
 */

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public errorCode = "SUBSCRIPTION_ERROR",
    public status = 400,
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}

type SubscriptionRecord = {
  _id: Types.ObjectId;
  activatedAt?: Date | null;
  agentId?: Types.ObjectId | null;
  currency?: string;
  currentPeriodEnd?: Date | null;
  cycle?: BillingCycle | null;
  cycleMonths?: number | null;
  cycleTotal?: number | null;
  dueBy?: Date | null;
  hostelId: Types.ObjectId;
  monthlyRate?: number | null;
  planId?: string | null;
  planName?: string | null;
  selectedAt?: Date | null;
  source?: "PUBLIC" | "TEAM";
  status: string;
};

export type InvoiceRecord = {
  _id: Types.ObjectId;
  amount: number;
  billedTo?: { email?: string; hostelName?: string; name?: string } | null;
  createdAt?: Date;
  currency?: string;
  cycle: BillingCycle;
  cycleMonths: number;
  documentUrl?: string | null;
  dueAt?: Date | null;
  hostelId: Types.ObjectId;
  invoiceNumber: string;
  issuedAt?: Date;
  /** Our own statutory number, when Softmato could not raise theirs. */
  localInvoiceNo?: string | null;
  localIssuedAt?: Date | null;
  /** The period it pays for, fixed at issue. Null on older invoices. */
  periodEnd?: Date | null;
  periodStart?: Date | null;
  planId: string;
  planName: string;
  softmatoInvoiceId?: string | null;
  softmatoInvoiceNo?: string | null;
  /** Documents for the balance alone. See the model. */
  softmatoBalanceInvoices?: { amount: number; id: string; no: string }[];
  source?: "PUBLIC" | "TEAM";
  status: string;
  subscriptionId: Types.ObjectId;
};

type PaymentRecord = {
  _id: Types.ObjectId;
  amount: number;
  collectedBy?: Types.ObjectId | null;
  createdAt?: Date;
  gatewayReference?: string | null;
  invoiceId: Types.ObjectId;
  isMocked?: boolean;
  method: string;
  receiptIssuedAt?: Date | null;
  receiptNumber?: string | null;
  settledAt?: Date | null;
  status: string;
};

/* ── Numbering ─────────────────────────────────────────────────────────── */

/**
 * `SUB-0001-4F2A` / `SRC-0001-4F2A`.
 *
 * Per hostel and for its lifetime, not per month: a plan document is quoted
 * back years later, and a per-period sequence would reissue the same number
 * every January. The hostel suffix keeps it unique platform-wide without a
 * global counter — which, as `ReceiptCounter` notes, would leak the platform's
 * total volume to anyone who read two of their own numbers.
 */
async function allocateNumber(
  hostelId: Types.ObjectId,
  kind: "SUBSCRIPTION_INVOICE" | "SUBSCRIPTION_RECEIPT",
) {
  const counter = await ReceiptCounterModel.findOneAndUpdate(
    { hostelId, kind, period: "LIFETIME" },
    { $inc: { sequence: 1 } },
    { new: true, setDefaultsOnInsert: true, upsert: true },
  ).lean<{ sequence: number } | null>();

  const sequence = String(counter?.sequence ?? 1).padStart(4, "0");
  const prefix = kind === "SUBSCRIPTION_INVOICE" ? "SUB" : "SRC";

  return `${prefix}-${sequence}-${hostelId.toString().slice(-4).toUpperCase()}`;
}

/* ── Plan resolution ───────────────────────────────────────────────────── */

/**
 * Prices a plan from the **live catalogue**, once, at the moment of choosing.
 *
 * Everything it returns is then snapshotted onto the subscription and the
 * invoice, and never re-derived. A superadmin may reprice or delete a tier
 * tomorrow, and neither an agreement already struck nor a document already sent
 * may change underneath it.
 */
export async function pricePlan(planId: string, cycle: BillingCycle) {
  // The catalogue as it is sold today, not as it is stored: a running event is
  // the price the cards quote, so it has to be the price the invoice carries.
  // Snapshotting happens immediately after, so the offer survives the event
  // ending — an agreement struck during it is not repriced when it stops.
  const catalog = sellingCatalog(await getSiteConfigSection("plans"), currentBsPeriod());
  const plan = getPlan(catalog, planId);

  if (!plan) {
    throw new SubscriptionError(
      "That plan is no longer available. Choose another one.",
      "PLAN_NOT_FOUND",
      404,
    );
  }

  const months = cycleMonths(cycle);
  const total = cycleTotal(plan, cycle);

  if (total <= 0) {
    throw new SubscriptionError(
      "That plan has no price set, so it cannot be invoiced. Ask the platform team to price it.",
      "PLAN_NOT_PRICED",
      409,
    );
  }

  return {
    cycle,
    cycleMonths: months,
    cycleTotal: total,
    monthlyRate: plan.monthly,
    planId: plan.id,
    planName: plan.name,
  };
}

/* ── Reading state ─────────────────────────────────────────────────────── */

/** The live invoice for a subscription, if one is outstanding. */
async function findOpenInvoice(subscriptionId: Types.ObjectId) {
  return SubscriptionInvoiceModel.findOne({
    status: { $in: ["OPEN", "PARTIAL"] },
    subscriptionId,
  })
    .sort({ createdAt: -1 })
    .lean<InvoiceRecord | null>();
}

/**
 * What is still owed on an invoice.
 *
 * Only `SETTLED` rows count. A `PENDING` QR payment is a promise being waited
 * on, and letting one reduce the balance would publish a hostel on the strength
 * of a scan that never completed.
 */
export async function outstandingFor(invoice: {
  _id: Types.ObjectId;
  amount: number;
}) {
  const settled = await SubscriptionPaymentModel.aggregate<{ total: number }>([
    { $match: { invoiceId: invoice._id, status: "SETTLED" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const paid = settled[0]?.total ?? 0;

  return { outstanding: Math.max(0, invoice.amount - paid), paid };
}

/* ── Deadlines ─────────────────────────────────────────────────────────── */

/**
 * The last instant of the Nepal calendar day `graceDays` after `from`.
 *
 * A due is a **day**, not a timestamp. "Pay by Bhadra 28" means all of Bhadra
 * 28, so the deadline is the final millisecond of that day in Kathmandu — not
 * the wall-clock minute the invoice happened to be raised at, which would make
 * a hostel added at 3 pm overdue at 3 pm three days later while every screen
 * still said "due today".
 *
 * Counted from the day the invoice was raised, which for a team registration is
 * the day the hostel was added: added on Bhadra 25 with a 3-day grace means due
 * by the end of Bhadra 28.
 */
export function graceDeadline(from: Date, graceDays: number): Date {
  return hostelDayEnd(from, graceDays);
}

/* ── The plan's period ─────────────────────────────────────────────────── */

/**
 * Starts the plan running on the period an invoice pays for.
 *
 * Called at the two moments a hostel goes live, which are the two moments its
 * plan starts:
 *
 * - a **team** registration, the instant the agent files it — published before
 *   paid, so the plan runs from that day and "days left" counts down from it;
 * - a settlement **in full** — a public hostel goes live on paying, and a
 *   renewal extends the period already running.
 *
 * Idempotent on the invoice. When the running period already reaches the
 * invoice's `periodEnd`, the team registration started it, and paying the
 * balance off must not start the same month again from a later day.
 *
 * `activatedAt` is the start of the stretch now running: kept when a period is
 * being extended, so the span from it to `currentPeriodEnd` is what has been
 * bought, and set afresh when nothing was running.
 */
export async function startPlanPeriod(
  invoice: Pick<InvoiceRecord, "cycleMonths" | "periodEnd" | "subscriptionId">,
  from: Date = new Date(),
) {
  const subscription = await HostelSubscriptionModel.findById(
    invoice.subscriptionId,
  ).lean<Pick<SubscriptionRecord, "_id" | "activatedAt" | "currentPeriodEnd"> | null>();

  if (!subscription) {
    return null;
  }

  const runningEnd = subscription.currentPeriodEnd ?? null;

  if (
    runningEnd &&
    invoice.periodEnd &&
    runningEnd.getTime() >= invoice.periodEnd.getTime()
  ) {
    return {
      activatedAt: subscription.activatedAt ?? null,
      currentPeriodEnd: runningEnd,
    };
  }

  const period = servicePeriod(invoice.cycleMonths || 1, runningEnd, from);
  const extending = Boolean(runningEnd && runningEnd.getTime() > from.getTime());
  const activatedAt =
    extending && subscription.activatedAt ? subscription.activatedAt : period.startsAt;

  await HostelSubscriptionModel.updateOne(
    { _id: subscription._id },
    { $set: { activatedAt, currentPeriodEnd: period.endsAt } },
  );

  return { activatedAt, currentPeriodEnd: period.endsAt };
}

export async function getOrCreateSubscription(
  hostelId: string | Types.ObjectId,
  seed: { agentId?: string | null; source?: "PUBLIC" | "TEAM" } = {},
) {
  await connectToDatabase();

  const objectId =
    typeof hostelId === "string" ? new Types.ObjectId(hostelId) : hostelId;

  const existing = await HostelSubscriptionModel.findOne({
    hostelId: objectId,
  }).lean<SubscriptionRecord | null>();

  if (existing) {
    return existing;
  }

  const created = await HostelSubscriptionModel.create({
    agentId: seed.agentId ?? null,
    hostelId: objectId,
    source: seed.source ?? "PUBLIC",
    status: "PENDING_SELECTION",
  });

  return created.toObject() as SubscriptionRecord;
}

/**
 * Everything the progress page and the due banner need, in one read.
 *
 * Returned as plain facts rather than rendered sentences — the page decides how
 * to word "you owe 4,900", and the app words it differently on a smaller
 * screen. `canPayNow` is the one computed judgement, and it lives here because
 * it is the rule the whole public flow turns on and must not be re-derived by
 * each surface that asks.
 */
export async function getSubscriptionState(hostelId: string) {
  await connectToDatabase();

  const objectId = new Types.ObjectId(hostelId);
  const subscription = await HostelSubscriptionModel.findOne({
    hostelId: objectId,
  }).lean<SubscriptionRecord | null>();

  if (!subscription) {
    return null;
  }

  const invoice = await findOpenInvoice(subscription._id);
  const latestInvoice =
    invoice ??
    (await SubscriptionInvoiceModel.findOne({ subscriptionId: subscription._id })
      .sort({ createdAt: -1 })
      .lean<InvoiceRecord | null>());

  const balance = latestInvoice
    ? await outstandingFor(latestInvoice)
    : { outstanding: 0, paid: 0 };

  const payments = await SubscriptionPaymentModel.find({
    subscriptionId: subscription._id,
  })
    .sort({ createdAt: -1 })
    .lean<PaymentRecord[]>();

  const hostel = await HostelModel.findById(objectId)
    .select("verificationStatus status name")
    .lean<{ name?: string; status?: string; verificationStatus?: string } | null>();

  const verified = hostel?.verificationStatus === "VERIFIED";
  const planChosen = Boolean(subscription.planId);

  return {
    /**
     * The gate the whole public flow turns on: **verified and a plan chosen**.
     *
     * Choosing early is allowed on purpose, so this cannot simply mean "has a
     * plan" — and verification alone is not enough either, because there would
     * be nothing to raise an invoice for.
     */
    canPayNow: verified && planChosen && subscription.status !== "ACTIVE",
    hostelName: hostel?.name ?? "",
    hostelStatus: hostel?.status ?? "",
    invoice: latestInvoice
      ? {
          amount: latestInvoice.amount,
          cycle: latestInvoice.cycle,
          documentUrl: latestInvoice.documentUrl ?? null,
          dueAt: latestInvoice.dueAt?.toISOString() ?? null,
          id: latestInvoice._id.toString(),
          invoiceNumber: latestInvoice.invoiceNumber,
          issuedAt: latestInvoice.issuedAt?.toISOString() ?? null,
          planName: latestInvoice.planName,
          status: latestInvoice.status,
        }
      : null,
    outstanding: balance.outstanding,
    paid: balance.paid,
    payments: payments.map((payment) => ({
      amount: payment.amount,
      id: payment._id.toString(),
      isMocked: Boolean(payment.isMocked),
      method: payment.method,
      receiptNumber: payment.receiptNumber ?? null,
      settledAt: payment.settledAt?.toISOString() ?? null,
      status: payment.status,
    })),
    planChosen,
    subscription: {
      activatedAt: subscription.activatedAt?.toISOString() ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cycle: subscription.cycle ?? null,
      cycleTotal: subscription.cycleTotal ?? null,
      dueBy: subscription.dueBy?.toISOString() ?? null,
      id: subscription._id.toString(),
      planId: subscription.planId ?? null,
      planName: subscription.planName ?? null,
      source: subscription.source ?? "PUBLIC",
      status: subscription.status,
    },
    verified,
  };
}

/**
 * An invoice that buys more time for a hostel already on the platform — the
 * "Get plan" checkout on the pricing page.
 *
 * Unlike `selectPlan` + `issueSubscriptionInvoice`, this works on an **active**
 * plan: the chosen plan and cycle are priced onto the invoice alone, and its
 * period starts where the running one ends, so paying it extends the plan
 * rather than restarting it. The subscription's own plan fields are only
 * changed when the invoice is paid in full (`applySettlement`), so an abandoned
 * checkout leaves the running plan exactly as it was.
 *
 * An invoice that is already outstanding is returned instead of raising a
 * second one: the hostel owes that first, and two open invoices would be two
 * answers to "what do I pay".
 */
export async function raiseRenewalInvoice(
  hostelId: string,
  input: { cycle: BillingCycle; planId: string },
  actorId: string,
) {
  await connectToDatabase();

  const subscription = await getOrCreateSubscription(hostelId);
  const open = await findOpenInvoice(subscription._id);

  if (open) {
    return { invoice: await ensureInvoiceRaised(open, { required: false }), reused: true };
  }

  const hostel = await HostelModel.findById(subscription.hostelId)
    .select("name slug status verificationStatus")
    .lean<{ name?: string; slug?: string; status?: string; verificationStatus?: string } | null>();

  if (!hostel) {
    throw new SubscriptionError("Hostel not found.", "HOSTEL_NOT_FOUND", 404);
  }

  if (hostel.verificationStatus !== "VERIFIED") {
    throw new SubscriptionError(
      "This hostel is still being verified, so it cannot buy a plan yet. You will be emailed the moment it is.",
      "NOT_VERIFIED",
      409,
    );
  }

  const priced = await pricePlan(input.planId, input.cycle);
  const operations = await getOperationsConfig();
  const issuedAt = new Date();
  const period = servicePeriod(priced.cycleMonths, subscription.currentPeriodEnd ?? null, issuedAt);
  const owner = await resolveBillingContact(subscription.hostelId);
  const invoiceNumber = await allocateNumber(subscription.hostelId, "SUBSCRIPTION_INVOICE");

  const created = await SubscriptionInvoiceModel.create({
    agentId: subscription.agentId ?? null,
    amount: priced.cycleTotal,
    billedTo: { email: owner.email, hostelName: hostel.name, name: owner.name },
    cycle: priced.cycle,
    cycleMonths: priced.cycleMonths,
    dueAt: graceDeadline(issuedAt, operations.subscriptionDueGraceDays),
    hostelId: subscription.hostelId,
    invoiceNumber,
    issuedAt,
    periodEnd: period.endsAt,
    periodStart: period.startsAt,
    planId: priced.planId,
    planName: priced.planName,
    source: "PUBLIC",
    status: "OPEN",
    subscriptionId: subscription._id,
  });

  const invoice = await ensureInvoiceRaised(created.toObject() as InvoiceRecord, {
    required: false,
  });

  // A running plan stays ACTIVE while its renewal is open: that is paying
  // early, not owing (see `plan-due-reminders.service.ts`).
  if (subscription.status !== "ACTIVE") {
    await HostelSubscriptionModel.updateOne(
      { _id: subscription._id },
      { $set: { status: "AWAITING_PAYMENT" } },
    );
  }

  await AuditLogModel.create({
    action: "SUBSCRIPTION_RENEWAL_INVOICE_ISSUED",
    actorId,
    entityId: invoice._id.toString(),
    entityType: "SubscriptionInvoice",
    hostelId: subscription.hostelId,
    metadata: { amount: priced.cycleTotal, cycle: priced.cycle, invoiceNumber, planId: priced.planId },
  });

  return { invoice, reused: false };
}

/**
 * The id of the invoice a payment should go against.
 *
 * Raises the obvious error rather than returning null, because every caller is
 * about to take money and "there is nothing to pay" is a thing the payer needs
 * told, not a null to branch on.
 */
export async function invoiceIdFor(hostelId: string) {
  await connectToDatabase();

  const subscription = await HostelSubscriptionModel.findOne({
    hostelId: new Types.ObjectId(hostelId),
  }).lean<SubscriptionRecord | null>();

  if (!subscription) {
    throw new SubscriptionError(
      "This hostel has no plan yet.",
      "NO_SUBSCRIPTION",
      404,
    );
  }

  const invoice = await findOpenInvoice(subscription._id);

  if (!invoice) {
    throw new SubscriptionError(
      "There is no outstanding invoice to pay.",
      "NO_OPEN_INVOICE",
      409,
    );
  }

  return invoice._id.toString();
}

/* ── Choosing a plan ───────────────────────────────────────────────────── */

/**
 * Records the owner's (or agent's) plan choice.
 *
 * Deliberately allowed while the hostel is still unverified. That is the whole
 * point of the state: the owner explores plans during the wait, picks one, and
 * the moment verification lands *Pay now* is already there rather than sending
 * them back to choose.
 *
 * Re-choosing is allowed right up until an invoice exists. Once one is raised,
 * changing plan would mean the document and the agreement disagree, so the
 * invoice has to be voided first — the guard says so rather than silently
 * repricing.
 */
export async function selectPlan(
  hostelId: string,
  input: { cycle: BillingCycle; planId: string },
  actorId: string,
) {
  await connectToDatabase();

  const subscription = await getOrCreateSubscription(hostelId);

  if (subscription.status === "ACTIVE") {
    throw new SubscriptionError(
      "This hostel is already on an active plan.",
      "ALREADY_ACTIVE",
      409,
    );
  }

  const open = await findOpenInvoice(subscription._id);

  if (open) {
    throw new SubscriptionError(
      `Invoice ${open.invoiceNumber} is already outstanding for the ${open.planName}. Pay or cancel it before changing plan.`,
      "INVOICE_OUTSTANDING",
      409,
    );
  }

  const priced = await pricePlan(input.planId, input.cycle);

  await HostelSubscriptionModel.updateOne(
    { _id: subscription._id },
    {
      $set: {
        cycle: priced.cycle,
        cycleMonths: priced.cycleMonths,
        cycleTotal: priced.cycleTotal,
        monthlyRate: priced.monthlyRate,
        planId: priced.planId,
        planName: priced.planName,
        selectedAt: new Date(),
        selectedBy: actorId,
        status: "SELECTED",
      },
    },
  );

  await AuditLogModel.create({
    action: "SUBSCRIPTION_PLAN_SELECTED",
    actorId,
    entityId: subscription._id.toString(),
    entityType: "HostelSubscription",
    hostelId: subscription.hostelId,
    metadata: { cycle: priced.cycle, planId: priced.planId, total: priced.cycleTotal },
  });

  return getSubscriptionState(hostelId);
}

/* ── Raising the invoice ───────────────────────────────────────────────── */

/**
 * Raises the invoice for the chosen plan and returns it.
 *
 * On the public path this is *Pay now*, and the verification guard below is the
 * teeth behind the button being hidden — a client that posts anyway is refused
 * for the same reason, in the same words.
 *
 * Idempotent: an invoice already outstanding for this subscription is returned
 * rather than duplicated. A double-clicked button must not raise two demands
 * for the same money.
 */
export async function issueSubscriptionInvoice(
  hostelId: string,
  actorId: string,
  options: { agentId?: string | null; requireVerified?: boolean; source?: "PUBLIC" | "TEAM" } = {},
) {
  await connectToDatabase();

  const requireVerified = options.requireVerified ?? true;
  const subscription = await getOrCreateSubscription(hostelId, {
    agentId: options.agentId,
    source: options.source,
  });

  if (!subscription.planId || !subscription.cycle) {
    throw new SubscriptionError(
      "Choose a plan before asking for an invoice.",
      "NO_PLAN_SELECTED",
      409,
    );
  }

  const existing = await findOpenInvoice(subscription._id);

  /*
   * An invoice already outstanding is returned rather than duplicated — a
   * double-tapped button must not raise two demands for one payment. It is put
   * back through `ensureInvoiceRaised` on the way out because the local row and
   * the Softmato document are two writes, and the first can outlive a failure
   * of the second. Resuming here is what turns that into a delay rather than an
   * invoice nobody can pay.
   */
  if (existing) {
    return ensureInvoiceRaised(existing, { required: false });
  }

  const hostel = await HostelModel.findById(subscription.hostelId)
    .select("name contact slug status verificationStatus")
    .lean<{
      contact?: { email?: string; phone?: string };
      name?: string;
      slug?: string;
      status?: string;
      verificationStatus?: string;
    } | null>();

  if (!hostel) {
    throw new SubscriptionError("Hostel not found.", "HOSTEL_NOT_FOUND", 404);
  }

  if (requireVerified && hostel.verificationStatus !== "VERIFIED") {
    throw new SubscriptionError(
      "This hostel has not been verified yet, so it cannot be invoiced. You will be emailed the moment it is.",
      "NOT_VERIFIED",
      409,
    );
  }

  /*
   * One instant for both, so the deadline is counted from the day the invoice
   * says it was issued rather than from a clock read a few statements apart.
   */
  const operations = await getOperationsConfig();
  const issuedAt = new Date();
  const dueAt = graceDeadline(issuedAt, operations.subscriptionDueGraceDays);
  /*
   * The period, fixed here and printed as the document's service dates. A team
   * registration starts it the moment the hostel is filed (`startPlanPeriod`),
   * and a later settlement reads it back to know that has already happened.
   */
  const period = servicePeriod(
    subscription.cycleMonths || 1,
    subscription.currentPeriodEnd ?? null,
    issuedAt,
  );

  const source = options.source ?? subscription.source ?? "PUBLIC";
  const owner = await resolveBillingContact(subscription.hostelId);
  const invoiceNumber = await allocateNumber(
    subscription.hostelId,
    "SUBSCRIPTION_INVOICE",
  );

  /*
   * **Our row first, their document second**, and the order is the whole
   * design.
   *
   * These are two writes to two systems and there is no transaction across
   * them. Whichever goes first, a crash between them leaves one side ahead —
   * so the question is which orphan is survivable.
   *
   * Ours first leaves an obligation recorded with no paper yet: the owner sees
   * what they owe, the next attempt to pay raises the document, and
   * `external_ref` is derived from a number that already exists so the retry
   * lands on the same invoice rather than a second one.
   *
   * Theirs first would leave the opposite — an invoice raised under the parent
   * company's name, in their ledger, that nothing here points at. Nobody would
   * ever pay it and nobody would know to void it.
   */
  const created = await SubscriptionInvoiceModel.create({
    agentId: options.agentId ?? subscription.agentId ?? null,
    amount: subscription.cycleTotal,
    billedTo: { email: owner.email, hostelName: hostel.name, name: owner.name },
    cycle: subscription.cycle,
    cycleMonths: subscription.cycleMonths,
    dueAt,
    hostelId: subscription.hostelId,
    invoiceNumber,
    issuedAt,
    periodEnd: period.endsAt,
    periodStart: period.startsAt,
    planId: subscription.planId,
    planName: subscription.planName,
    source,
    status: "OPEN",
    subscriptionId: subscription._id,
  });

  const invoice = await ensureInvoiceRaised(
    created.toObject() as InvoiceRecord,
    { required: false },
  );

  await HostelSubscriptionModel.updateOne(
    { _id: subscription._id },
    { $set: { status: "AWAITING_PAYMENT" } },
  );

  await AuditLogModel.create({
    action: "SUBSCRIPTION_INVOICE_ISSUED",
    actorId,
    entityId: invoice._id.toString(),
    entityType: "SubscriptionInvoice",
    hostelId: subscription.hostelId,
    metadata: {
      amount: subscription.cycleTotal,
      invoiceNumber,
      planId: subscription.planId,
    },
  });

  const catalog = await getSiteConfigSection("plans");

  await onInvoiceIssued({
    amount: subscription.cycleTotal ?? 0,
    cycleLabel: catalog.cycleLabels[subscription.cycle] ?? subscription.cycle,
    documentUrl: invoice.documentUrl ?? null,
    dueAt,
    hostelLive: hostel.status === "PUBLISHED",
    hostelName: hostel.name ?? "",
    hostelSlug: hostel.slug ?? null,
    invoiceNumber,
    ownerEmail: owner.email,
    ownerName: owner.name,
    planName: subscription.planName ?? "",
    source: source === "TEAM" ? "TEAM" : "PUBLIC",
  });

  return invoice;
}

/* ── Raising the document on Softmato ───────────────────────────── */

/**
 * What the Softmato document for this invoice says: who is billed, the line,
 * the plan block and the service period. Shared by the invoice itself and by
 * a balance document (`balance-document.ts`), which differs only in amount and
 * number.
 */
export async function invoiceDocumentInput(invoice: InvoiceRecord): Promise<EnsureInvoiceInput> {
  const subscription = await HostelSubscriptionModel.findById(
    invoice.subscriptionId,
  ).lean<SubscriptionRecord | null>();

  const catalog = await getSiteConfigSection("plans");
  // The stored pair when the invoice has one, so a retry prints the dates the
  // hostel was already given rather than recomputing them from a later day.
  const period =
    invoice.periodStart && invoice.periodEnd
      ? { endsAt: invoice.periodEnd, startsAt: invoice.periodStart }
      : servicePeriod(
          invoice.cycleMonths,
          subscription?.currentPeriodEnd ?? null,
          invoice.issuedAt ?? new Date(),
        );

  return {
    amount: invoice.amount,
    customer: {
      hostelId: invoice.hostelId.toString(),
      name: invoice.billedTo?.hostelName || invoice.billedTo?.name || "Hostel",
      ...(invoice.billedTo?.email ? { email: invoice.billedTo.email } : {}),
    },
    /*
     * The line as it prints on the document. The cycle label comes from the
     * catalogue rather than the enum so the invoice reads the way the pricing
     * page reads — "6 months", not "halfYearly".
     */
    description: `${invoice.planName} — ${catalog.cycleLabels[invoice.cycle] ?? invoice.cycle}`,
    dueAt: invoice.dueAt ?? null,
    invoiceNumber: invoice.invoiceNumber,
    /*
     * The plan in our own words, rendered beside the amount on the checkout
     * page and under the line items on the invoice. Built defensively: every
     * string in it comes from a catalogue a platform owner edits in a form,
     * and Softmato refuses a block that quotes a price. See
     * `softmato/presentation.ts` for why a dropped bullet beats a `422`.
     */
    presentation: buildPresentation({
      cycleLabel: catalog.cycleLabels[invoice.cycle] ?? invoice.cycle,
      cycleMonths: invoice.cycleMonths,
      plan: catalog.plans.find((tier) => tier.id === invoice.planId) ?? null,
      planName: invoice.planName,
    }),
    serviceEndsAt: period.endsAt,
    serviceStartsAt: period.startsAt,
  };
}

/**
 * Makes sure this invoice has a statutory document behind it, and returns it.
 *
 * Idempotent twice over. It returns early when the handles are already stored,
 * and even if it did not, `external_ref` is derived from `invoiceNumber` — a
 * repeat returns the invoice Softmato already has rather than raising a second
 * one. That is what makes it safe to call from anywhere that needs the document
 * to exist: at issue, at checkout, from a retry.
 *
 * ## `required` decides what a failure means
 *
 * At issue time it is `false`. The obligation is real whether or not the API
 * answered, the owner should still be told what they owe, and the next attempt
 * to pay will raise the paper. Failing the whole Pay-now because a document
 * service was briefly unreachable would turn a delay into a dead end.
 *
 * At checkout time it is `true`, because there is nothing to check out
 * against: `POST /v1/checkout` is addressed by their invoice id and reads the
 * amount from it. A checkout with no invoice is not a degraded payment, it is
 * no payment.
 */
export async function ensureInvoiceRaised(
  invoice: InvoiceRecord,
  options: { required?: boolean } = {},
): Promise<InvoiceRecord> {
  if (invoice.softmatoInvoiceId && invoice.softmatoInvoiceNo) return invoice;

  const input = await invoiceDocumentInput(invoice);

  try {
    const raised = await issueInvoiceDocument(input);

    await SubscriptionInvoiceModel.updateOne(
      { _id: invoice._id },
      {
        $set: {
          documentUrl: raised.documentUrl,
          softmatoInvoiceId: raised.softmatoInvoiceId,
          softmatoInvoiceNo: raised.softmatoInvoiceNo,
        },
      },
    );

    return {
      ...invoice,
      documentUrl: raised.documentUrl,
      softmatoInvoiceId: raised.softmatoInvoiceId,
      softmatoInvoiceNo: raised.softmatoInvoiceNo,
    };
  } catch (error) {
    if (options.required !== false) throw error;

    console.error(
      JSON.stringify({
        action: "subscription_invoice_document_deferred",
        invoiceNumber: invoice.invoiceNumber,
        level: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );

    /*
     * **No stand-in.** Softmato issues every invoice; a number of our own here
     * would be a second invoice for the same money. The invoice waits, and when
     * Softmato was simply unreachable the owner is emailed the moment it is
     * raised (`softmato/retry.ts`).
     */
    if (isSoftmatoDown(error)) {
      const contact = await resolveBillingContact(invoice.hostelId);

      await rememberTask({
        email: contact.email || null,
        kind: "PLAN_PAYMENT",
        link: `${siteUrl()}/hostel-admin/billing`,
        name: contact.name || null,
        ref: String(invoice._id),
      });
    }

    return invoice;
  }
}

/** The address a plan document is sent to: the hostel's owner. */
async function resolveBillingContact(hostelId: Types.ObjectId) {
  const { UserModel } = await import("@hostel/db/models/User");
  const hostel = await HostelModel.findById(hostelId)
    .select("ownerId contact")
    .lean<{
      contact?: { email?: string };
      ownerId?: Types.ObjectId;
    } | null>();

  const owner = hostel?.ownerId
    ? await UserModel.findById(hostel.ownerId)
        .select("name email")
        .lean<{ email?: string; name?: string } | null>()
    : null;

  return {
    email: owner?.email ?? hostel?.contact?.email ?? "",
    name: owner?.name ?? "",
  };
}
