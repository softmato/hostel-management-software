import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rules money turns on.
 *
 * Not a test of mongoose. Every model here is a stub, and what is pinned is the
 * handful of decisions that decide whether a hostel is published, whether an
 * owner is asked for money, and whether a payment counts:
 *
 * - a plan may be chosen **before** verification, but never invoiced before it;
 * - *Pay now* needs verified **and** chosen — neither alone;
 * - paying in full activates and publishes;
 * - paying part of it publishes **only** a team-filed hostel, and leaves a due;
 * - a pending payment is worth nothing;
 * - settling twice issues one receipt;
 * - a payment belonging to another hostel cannot be settled through yours.
 */

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  counterFindOneAndUpdate: vi.fn(),
  getOperationsConfig: vi.fn(),
  getSiteConfigSection: vi.fn(),
  hostelFindById: vi.fn(),
  hostelUpdateOne: vi.fn(),
  invoiceCreate: vi.fn(),
  invoiceFindById: vi.fn(),
  invoiceFindOneAndUpdate: vi.fn(),
  documentSequenceFindOneAndUpdate: vi.fn(),
  invoiceFindOne: vi.fn(),
  invoiceUpdateOne: vi.fn(),
  onInvoiceIssued: vi.fn(),
  onPaymentSettled: vi.fn(),
  paymentCreate: vi.fn(),
  paymentFind: vi.fn(),
  paymentFindById: vi.fn(),
  paymentFindOneAndUpdate: vi.fn(),
  paymentUpdateOne: vi.fn(),
  subscriptionCreate: vi.fn(),
  subscriptionFindById: vi.fn(),
  subscriptionFindOne: vi.fn(),
  subscriptionUpdateOne: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findById: mocks.hostelFindById, updateOne: mocks.hostelUpdateOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findById: mocks.userFindById },
}));

vi.mock("@hostel/db/models/HostelSubscription", () => ({
  HostelSubscriptionModel: {
    create: mocks.subscriptionCreate,
    findById: mocks.subscriptionFindById,
    findOne: mocks.subscriptionFindOne,
    updateOne: mocks.subscriptionUpdateOne,
  },
}));

vi.mock("@hostel/db/models/SubscriptionInvoice", () => ({
  SubscriptionInvoiceModel: {
    create: mocks.invoiceCreate,
    findById: mocks.invoiceFindById,
    findOne: mocks.invoiceFindOne,
    findOneAndUpdate: mocks.invoiceFindOneAndUpdate,
    updateOne: mocks.invoiceUpdateOne,
  },
}));

vi.mock("@hostel/db/models/PlatformDocumentSequence", () => ({
  PlatformDocumentSequenceModel: {
    findOneAndUpdate: mocks.documentSequenceFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/SubscriptionPayment", () => ({
  SubscriptionPaymentModel: {
    aggregate: mocks.aggregate,
    create: mocks.paymentCreate,
    find: mocks.paymentFind,
    findById: mocks.paymentFindById,
    findOneAndUpdate: mocks.paymentFindOneAndUpdate,
    updateOne: mocks.paymentUpdateOne,
  },
}));

vi.mock("@hostel/db/models/ReceiptCounter", () => ({
  ReceiptCounterModel: { findOneAndUpdate: mocks.counterFindOneAndUpdate },
}));

vi.mock("@/modules/platform-config/operations-config", () => ({
  getOperationsConfig: mocks.getOperationsConfig,
}));

vi.mock("@/modules/platform-config/site-config.service", () => ({
  getSiteConfigSection: mocks.getSiteConfigSection,
}));

vi.mock("@/modules/hostels/hostel-registration.events", () => ({
  onInvoiceIssued: mocks.onInvoiceIssued,
  onPaymentSettled: mocks.onPaymentSettled,
}));

import {
  SubscriptionError,
  getSubscriptionState,
  issueSubscriptionInvoice,
  selectPlan,
} from "@/modules/billing/subscription.service";
import { settlePayment } from "@/modules/billing/subscription-payment.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c9");
const subscriptionId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3");
const paymentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a4");
const actorId = "64f0f0f0f0f0f0f0f0f0f0a5";

/** A chainable stub standing in for a mongoose query. */
function query<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

const catalog = {
  cycleLabels: { annual: "Yearly", halfYearly: "Half-yearly", monthly: "Monthly" },
  modules: [],
  plans: [
    {
      annualDiscountPercent: 0,
      ctaHref: "/register-hostel",
      ctaLabel: "Start",
      description: "",
      featured: false,
      halfYearlyDiscountPercent: 0,
      id: "pro",
      listingTier: null,
      maxResidents: null,
      monthly: 5900,
      name: "Pro Plan",
      portalAccess: { cooks: null, wardens: null },
    },
  ],
  services: [],
};

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    _id: subscriptionId,
    currency: "NPR",
    cycle: "monthly",
    cycleMonths: 1,
    cycleTotal: 5900,
    hostelId,
    planId: "pro",
    planName: "Pro Plan",
    source: "PUBLIC",
    status: "SELECTED",
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    _id: invoiceId,
    amount: 5900,
    cycle: "monthly",
    cycleMonths: 1,
    hostelId,
    invoiceNumber: "SUB-0001-F0A1",
    planId: "pro",
    planName: "Pro Plan",
    source: "PUBLIC",
    status: "OPEN",
    subscriptionId,
    ...overrides,
  };
}

/** How much has settled against the invoice, as the aggregate would report it. */
function settledTotal(total: number) {
  mocks.aggregate.mockResolvedValue(total > 0 ? [{ total }] : []);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSiteConfigSection.mockResolvedValue(catalog);
  mocks.getOperationsConfig.mockResolvedValue({ subscriptionDueGraceDays: 15 });
  mocks.counterFindOneAndUpdate.mockReturnValue(query({ sequence: 1 }));
  mocks.subscriptionUpdateOne.mockResolvedValue({});
  mocks.invoiceUpdateOne.mockResolvedValue({});
  mocks.paymentUpdateOne.mockResolvedValue({});
  /*
   * The claim that moves a payment out of `PENDING`. It answers a row by
   * default — this caller won the race — and one test overrides it with null to
   * stand for the second delivery of the same webhook.
   */
  mocks.paymentFindOneAndUpdate.mockReturnValue(query({ _id: paymentId }));
  mocks.hostelUpdateOne.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.paymentFind.mockReturnValue(query([]));
  mocks.userFindById.mockReturnValue(query({ email: "owner@example.com", name: "Owner" }));
  settledTotal(0);
});

describe("choosing a plan", () => {
  it("is allowed while the hostel is still unverified", async () => {
    mocks.subscriptionFindOne.mockReturnValue(
      query(subscription({ planId: null, planName: null, status: "PENDING_SELECTION" })),
    );
    mocks.invoiceFindOne.mockReturnValue(query(null));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "PENDING_APPROVAL", verificationStatus: "PENDING" }),
    );

    await selectPlan(hostelId.toString(), { cycle: "monthly", planId: "pro" }, actorId);

    expect(mocks.subscriptionUpdateOne).toHaveBeenCalledWith(
      { _id: subscriptionId },
      expect.objectContaining({
        $set: expect.objectContaining({ planId: "pro", status: "SELECTED" }),
      }),
    );
  });

  it("refuses to change plan while an invoice is outstanding", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));

    await expect(
      selectPlan(hostelId.toString(), { cycle: "monthly", planId: "pro" }, actorId),
    ).rejects.toThrow(/already outstanding/i);
  });
});

describe("the Pay now gate", () => {
  it("stays shut while unverified, even with a plan chosen", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(null));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "PENDING_APPROVAL", verificationStatus: "PENDING" }),
    );

    const state = await getSubscriptionState(hostelId.toString());

    expect(state?.canPayNow).toBe(false);
    expect(state?.planChosen).toBe(true);
  });

  it("stays shut when verified but no plan is chosen", async () => {
    mocks.subscriptionFindOne.mockReturnValue(
      query(subscription({ planId: null, planName: null, status: "PENDING_SELECTION" })),
    );
    mocks.invoiceFindOne.mockReturnValue(query(null));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "APPROVED", verificationStatus: "VERIFIED" }),
    );

    const state = await getSubscriptionState(hostelId.toString());

    expect(state?.canPayNow).toBe(false);
  });

  it("opens once verified and chosen", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(null));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "APPROVED", verificationStatus: "VERIFIED" }),
    );

    const state = await getSubscriptionState(hostelId.toString());

    expect(state?.canPayNow).toBe(true);
  });
});

describe("raising the invoice", () => {
  it("refuses before verification", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(null));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", verificationStatus: "PENDING" }),
    );

    await expect(
      issueSubscriptionInvoice(hostelId.toString(), actorId),
    ).rejects.toBeInstanceOf(SubscriptionError);
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  it("returns the existing invoice rather than raising a second", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.subscriptionFindById.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));
    mocks.invoiceFindById.mockReturnValue(query(invoice()));
    mocks.documentSequenceFindOneAndUpdate.mockReturnValue(
      query({ sequence: 12 }),
    );
    mocks.invoiceFindOneAndUpdate.mockReturnValue(
      query({ localInvoiceNo: "HH-INV-2083/84-000012" }),
    );

    const result = await issueSubscriptionInvoice(hostelId.toString(), actorId);

    expect(result.invoiceNumber).toBe("SUB-0001-F0A1");
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  /*
   * Softmato is not configured in this suite, so every raise here takes the
   * unreachable path — which is the path that now has to produce a document
   * rather than leave the owner with an invoice they cannot be shown.
   */
  it("issues our own numbered document when Softmato cannot be reached", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.subscriptionFindById.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));
    mocks.invoiceFindById.mockReturnValue(query(invoice()));
    mocks.documentSequenceFindOneAndUpdate.mockReturnValue(
      query({ sequence: 12 }),
    );
    mocks.invoiceFindOneAndUpdate.mockReturnValue(
      query({ localInvoiceNo: "HH-INV-2083/84-000012" }),
    );

    const result = await issueSubscriptionInvoice(hostelId.toString(), actorId);

    // The `HH-` prefix is what keeps our series from ever colliding with theirs.
    expect(result.localInvoiceNo).toMatch(/^HH-INV-/);
    // Never into the field a webhook is matched on.
    expect(result.softmatoInvoiceNo ?? null).toBeNull();
    // And the owner gets a download button, not a "not raised yet".
    expect(result.documentUrl).toContain("/billing/documents/invoice/");
  });

  it("does not burn a second number on an invoice that already has one", async () => {
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.subscriptionFindById.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));
    mocks.invoiceFindById.mockReturnValue(
      query({ ...invoice(), localInvoiceNo: "HH-INV-2083/84-000007" }),
    );

    const result = await issueSubscriptionInvoice(hostelId.toString(), actorId);

    expect(result.localInvoiceNo).toBe("HH-INV-2083/84-000007");
    expect(mocks.documentSequenceFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("settling", () => {
  function arrangeSettlement(options: {
    alreadySettled?: number;
    amount: number;
    source?: "PUBLIC" | "TEAM";
  }) {
    mocks.paymentFindById.mockReturnValue(
      query({
        _id: paymentId,
        amount: options.amount,
        hostelId,
        invoiceId,
        method: "CASH",
        status: "PENDING",
        subscriptionId,
      }),
    );
    mocks.invoiceFindById.mockReturnValue(query(invoice()));
    mocks.subscriptionFindById.mockReturnValue(
      query({ _id: subscriptionId, cycleMonths: 1, source: options.source ?? "PUBLIC" }),
    );
    mocks.subscriptionFindOne.mockReturnValue(
      query(subscription({ source: options.source ?? "PUBLIC" })),
    );
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));
    mocks.hostelFindById.mockReturnValue(
      query({
        name: "Sunrise",
        status: "APPROVED",
        verificationStatus: "VERIFIED",
      }),
    );
    settledTotal((options.alreadySettled ?? 0) + options.amount);
  }

  it("activates and publishes when paid in full", async () => {
    arrangeSettlement({ amount: 5900 });

    await settlePayment(paymentId.toString(), { actorId });

    expect(mocks.invoiceUpdateOne).toHaveBeenCalledWith(
      { _id: invoiceId },
      { $set: { status: "PAID" } },
    );
    expect(mocks.subscriptionUpdateOne).toHaveBeenCalledWith(
      { _id: subscriptionId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "ACTIVE" }) }),
    );
    expect(mocks.hostelUpdateOne).toHaveBeenCalledWith(
      { _id: hostelId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "PUBLISHED" }),
      }),
    );
  });

  it("leaves a team hostel published and past due when part paid", async () => {
    arrangeSettlement({ amount: 2000, source: "TEAM" });

    await settlePayment(paymentId.toString(), { actorId });

    expect(mocks.invoiceUpdateOne).toHaveBeenCalledWith(
      { _id: invoiceId },
      { $set: { status: "PARTIAL" } },
    );
    expect(mocks.subscriptionUpdateOne).toHaveBeenCalledWith(
      { _id: subscriptionId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "PAST_DUE" }),
      }),
    );
  });

  it("does not publish a public hostel that has only part paid", async () => {
    arrangeSettlement({ amount: 2000, source: "PUBLIC" });

    await settlePayment(paymentId.toString(), { actorId });

    expect(mocks.hostelUpdateOne).not.toHaveBeenCalled();
    // A public shortfall is not a due — it is simply not paid for yet.
    expect(mocks.subscriptionUpdateOne).not.toHaveBeenCalledWith(
      { _id: subscriptionId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "PAST_DUE" }),
      }),
    );
  });

  it("issues one receipt when the same payment settles twice", async () => {
    mocks.paymentFindById.mockReturnValue(
      query({
        _id: paymentId,
        amount: 5900,
        hostelId,
        invoiceId,
        method: "CASH",
        status: "SETTLED",
        subscriptionId,
      }),
    );
    /*
     * The claim is what makes this idempotent, and it is what is stubbed here.
     * `findOneAndUpdate({ status: "PENDING" })` matches nothing once a row has
     * settled, so the second caller gets null and stops — which is the point:
     * a webhook delivered twice concurrently would both pass a plain status
     * *read*, and only one can win a conditional *write*.
     */
    mocks.paymentFindOneAndUpdate.mockReturnValue(query(null));
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice({ status: "PAID" })));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "PUBLISHED", verificationStatus: "VERIFIED" }),
    );

    await settlePayment(paymentId.toString(), { actorId });

    expect(mocks.counterFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses a payment belonging to another hostel", async () => {
    mocks.paymentFindById.mockReturnValue(
      query({
        _id: paymentId,
        amount: 5900,
        hostelId: otherHostelId,
        invoiceId,
        method: "CASH",
        status: "PENDING",
        subscriptionId,
      }),
    );

    await expect(
      settlePayment(paymentId.toString(), {
        actorId,
        expectedHostelId: hostelId.toString(),
      }),
    ).rejects.toThrow(/not found/i);
    expect(mocks.paymentUpdateOne).not.toHaveBeenCalled();
  });
});

describe("what counts toward the balance", () => {
  it("ignores a pending payment", async () => {
    // The aggregate matches `status: SETTLED`, so a pending row contributes
    // nothing — this pins that the filter is actually on the query.
    mocks.subscriptionFindOne.mockReturnValue(query(subscription()));
    mocks.invoiceFindOne.mockReturnValue(query(invoice()));
    mocks.hostelFindById.mockReturnValue(
      query({ name: "Sunrise", status: "APPROVED", verificationStatus: "VERIFIED" }),
    );
    settledTotal(0);

    const state = await getSubscriptionState(hostelId.toString());

    expect(state?.outstanding).toBe(5900);
    expect(mocks.aggregate).toHaveBeenCalledWith([
      { $match: { invoiceId, status: "SETTLED" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
  });
});
