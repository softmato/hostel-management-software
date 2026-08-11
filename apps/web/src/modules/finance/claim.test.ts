/**
 * Claim submission — Block 3 item 3.4 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §11.2, §11.3, §8).
 *
 * The item's own test line: "duplicate screenshot, reused txn ID, foreign asset,
 * amount out of bounds, and the happy path each produce exactly the right error
 * code and **never reach the owner queue** (target P7)."
 *
 * That last clause is what every rejection case asserts, and it is invariant 9.
 * A duplicate that lands in front of a human has already cost the thing the
 * check exists to save — so each of these confirms that `appendEvent` was never
 * called and no admin was notified, not merely that an error came back.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  assetFind: vi.fn(),
  assetFindOne: vi.fn(),
  audit: vi.fn(),
  balanceFindOne: vi.fn(),
  eventExists: vi.fn(),
  eventFindOne: vi.fn(),
  findCurrentResident: vi.fn(),
  invoiceFindById: vi.fn(),
  invoiceFindOne: vi.fn(),
  notifyAdmins: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/realtime/server", () => ({ publishResourceChange: mocks.publish }));
vi.mock("@/modules/finance/audit-finance", () => ({ auditFinanceAction: mocks.audit }));

vi.mock("@/modules/finance/finance-notify", () => ({
  notifyAdminsOfClaim: mocks.notifyAdmins,
}));

vi.mock("@/modules/finance/payment-event.service", () => ({
  appendEvent: mocks.appendEvent,
}));

vi.mock("@/modules/residents/resident-access", () => ({
  findCurrentResident: mocks.findCurrentResident,
}));

vi.mock("@hostel/db/models/FileAsset", () => ({
  FileAssetModel: { find: mocks.assetFind, findOne: mocks.assetFindOne },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { findById: mocks.invoiceFindById, findOne: mocks.invoiceFindOne },
}));

vi.mock("@hostel/db/models/InvoiceBalance", () => ({
  InvoiceBalanceModel: { findOne: mocks.balanceFindOne },
}));

vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { exists: mocks.eventExists, findOne: mocks.eventFindOne },
}));

const { submitClaim } = await import("./claim.service");

const hostelId = new Types.ObjectId();
const residentId = new Types.ObjectId();
const invoiceId = new Types.ObjectId();
const assetId = new Types.ObjectId();
const userId = new Types.ObjectId().toString();

const principal = {
  role: Role.RESIDENT,
  userId,
} as unknown as ApiPrincipal;

function lean<T>(value: T) {
  return { lean: () => Promise.resolve(value) };
}

/** `FileAssetModel.find(...).sort(...).limit(...).select(...).lean()` */
function assetQuery<T>(value: T) {
  const chain = {
    lean: () => Promise.resolve(value),
    limit: () => chain,
    select: () => chain,
    sort: () => chain,
  };

  return chain;
}

const input = {
  amount: 10000,
  paymentMethod: "ESEWA" as const,
  proofImageAssetId: assetId.toString(),
};

/** Nothing entered the owner's queue: invariant 9, asserted the same way each time. */
function expectNothingQueued() {
  expect(mocks.appendEvent).not.toHaveBeenCalled();
  expect(mocks.notifyAdmins).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.findCurrentResident.mockResolvedValue({
    _id: residentId,
    firstName: "Suman",
    hostelId,
    lastName: "Tamang",
  });
  mocks.invoiceFindOne.mockReturnValue(
    lean({
      _id: invoiceId,
      hostelId,
      period: "2026-09",
      referenceCode: "EDU-0001-F",
      status: "OPEN",
      totalAmount: 10000,
    }),
  );
  mocks.assetFindOne.mockReturnValue(
    lean({
      _id: assetId,
      contentHash: "a".repeat(64),
      hostelId,
      ownerId: new Types.ObjectId(userId),
      perceptualHash: "0f0f0f0f0f0f0f0f",
      uploadCompletedAt: new Date(),
    }),
  );
  mocks.assetFind.mockReturnValue(assetQuery([]));
  mocks.balanceFindOne.mockReturnValue(lean(null));
  mocks.eventExists.mockResolvedValue(null);
  mocks.eventFindOne.mockReturnValue(lean(null));
  mocks.invoiceFindById.mockReturnValue(lean({ period: "2026-07" }));
  mocks.appendEvent.mockResolvedValue({
    created: true,
    event: { _id: new Types.ObjectId(), status: "PENDING" },
  });
});

describe("submitClaim — the happy path", () => {
  it("records a PENDING event and notifies the owner", async () => {
    const result = await submitClaim(invoiceId.toString(), input, principal);

    expect(result.status).toBe("PENDING");
    expect(mocks.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it("does not change the invoice status", async () => {
    await submitClaim(invoiceId.toString(), input, principal);

    // Target §6.2 step 7: a claim is a badge, not a payment state. This is the
    // fix for `PENDING_PROOF` conflating "someone said they paid" with money.
    const [appended] = mocks.appendEvent.mock.calls[0];

    expect(appended.status).toBe("PENDING");
    expect(appended.confirmation).toBe("UNCONFIRMED");
  });

  it("audits zero movement, because a claim moves no money", async () => {
    await submitClaim(invoiceId.toString(), input, principal);

    expect(mocks.audit).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({ amountAfter: 0, amountBefore: 0 }),
    );
  });
});

describe("submitClaim — duplicate screenshot", () => {
  it("rejects the same bytes re-uploaded as a new asset", async () => {
    // The asset id is fresh, so the one-asset-one-claim check passes; what
    // catches this is the hostel-scoped content hash.
    mocks.eventFindOne.mockImplementation((filter: Record<string, unknown>) =>
      lean("evidenceHash" in filter ? { _id: new Types.ObjectId() } : null),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "EVIDENCE_ALREADY_USED" });

    expectNothingQueued();
  });

  /**
   * Without this the rejection card (§11.3) is a dead end — the resident is told
   * the screenshot is used and given nothing to go and find.
   */
  it("says which month the screenshot was already used for", async () => {
    mocks.eventFindOne.mockImplementation((filter: Record<string, unknown>) =>
      lean(
        "evidenceHash" in filter
          ? { invoiceId: new Types.ObjectId(), occurredAt: new Date("2026-07-02") }
          : null,
      ),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({
      details: { priorPeriod: "2026-07", priorSubmittedAt: expect.any(String) },
    });
  });

  it("scopes the hash comparison to the hostel", async () => {
    await submitClaim(invoiceId.toString(), input, principal);

    // Comparing across hostels would reveal that another hostel holds the same
    // image — a privacy leak dressed as a fraud control.
    const hashCall = mocks.eventFindOne.mock.calls.find(
      ([filter]) => "evidenceHash" in filter,
    );

    expect(hashCall?.[0]).toMatchObject({ hostelId });
  });

  it("rejects the same asset submitted twice", async () => {
    mocks.eventExists.mockImplementation(async (filter: Record<string, unknown>) =>
      "evidenceAssetId" in filter ? { _id: new Types.ObjectId() } : null,
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "EVIDENCE_ALREADY_USED" });

    expectNothingQueued();
  });
});

/**
 * Target §11.3. One transfer has one id, so a second claim carrying it is last
 * month's payment resubmitted or a typo — and neither should reach the owner.
 */
describe("submitClaim — duplicate transaction id", () => {
  const withCode = { ...input, transactionCode: "8823119471" };

  it("rejects a transaction id another claim already carries", async () => {
    mocks.eventFindOne.mockImplementation((filter: Record<string, unknown>) =>
      lean(
        "rawPayload.transactionCode" in filter
          ? { invoiceId: new Types.ObjectId(), occurredAt: new Date("2026-07-02") }
          : null,
      ),
    );

    await expect(
      submitClaim(invoiceId.toString(), withCode, principal),
    ).rejects.toMatchObject({
      details: { priorPeriod: "2026-07", transactionCode: "8823119471" },
      errorCode: "TXN_ID_ALREADY_CLAIMED",
    });

    expectNothingQueued();
  });

  it("scopes the lookup to this hostel and provider, and ignores rejected claims", async () => {
    await submitClaim(invoiceId.toString(), withCode, principal);

    const call = mocks.eventFindOne.mock.calls.find(
      ([filter]) => "rawPayload.transactionCode" in filter,
    );

    // Across providers an eight-digit id genuinely repeats, and a rejected
    // claim must not lock the resident out of resubmitting the real one.
    expect(call?.[0]).toMatchObject({
      hostelId,
      provider: "ESEWA",
      status: { $ne: "REJECTED" },
    });
  });

  it("does not run the check for a cash claim with no id", async () => {
    await submitClaim(
      invoiceId.toString(),
      { ...input, paymentMethod: "CASH" as const },
      principal,
    );

    // Cash has no transaction id (§11.2), so an empty code must not collide
    // with every other cash claim in the hostel.
    expect(
      mocks.eventFindOne.mock.calls.some(
        ([filter]) => "rawPayload.transactionCode" in filter,
      ),
    ).toBe(false);
  });
});

describe("submitClaim — a screenshot that only looks similar", () => {
  it("flags for review and never rejects", async () => {
    mocks.assetFind.mockReturnValue(
      // One bit different: well inside the threshold.
      assetQuery([{ perceptualHash: "0f0f0f0f0f0f0f0e" }]),
    );

    const result = await submitClaim(invoiceId.toString(), input, principal);

    expect(result.status).toBe("PENDING");
    expect(mocks.appendEvent.mock.calls[0][0].reviewFlags).toEqual([
      "SIMILAR_EVIDENCE",
    ]);
  });

  it("does not flag an image that merely shares a bank app's layout", async () => {
    mocks.assetFind.mockReturnValue(assetQuery([{ perceptualHash: "f0f0f0f0f0f0f0f0" }]));

    await submitClaim(invoiceId.toString(), input, principal);

    expect(mocks.appendEvent.mock.calls[0][0].reviewFlags).toEqual([]);
  });
});

describe("submitClaim — a foreign asset", () => {
  it("rejects an asset owned by somebody else", async () => {
    mocks.assetFindOne.mockReturnValue(
      lean({
        _id: assetId,
        hostelId,
        ownerId: new Types.ObjectId(),
        uploadCompletedAt: new Date(),
      }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "ASSET_NOT_OWNED" });

    expectNothingQueued();
  });

  it("rejects an asset belonging to another hostel", async () => {
    mocks.assetFindOne.mockReturnValue(
      lean({
        _id: assetId,
        hostelId: new Types.ObjectId(),
        ownerId: new Types.ObjectId(userId),
        uploadCompletedAt: new Date(),
      }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "ASSET_NOT_OWNED" });

    expectNothingQueued();
  });

  it("rejects our own receipt submitted as proof of payment", async () => {
    // The circular case: a receipt is our record that the hostel *was* paid, so
    // it cannot also be the resident's evidence that they sent the money. Before
    // this check it was accepted and every claim check went green.
    mocks.assetFindOne.mockReturnValue(
      lean({
        _id: assetId,
        contentHash: "a".repeat(64),
        hostelId,
        ownerId: new Types.ObjectId(userId),
        systemDocumentKind: "RECEIPT",
        uploadCompletedAt: new Date(),
      }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "EVIDENCE_IS_SYSTEM_DOCUMENT" });

    // Never reaches the owner's queue (target P7): rejecting at submission is
    // the point, and the resident is told what to upload instead.
    expectNothingQueued();
  });

  it("rejects our own statement too, with copy that names it", async () => {
    mocks.assetFindOne.mockReturnValue(
      lean({
        _id: assetId,
        contentHash: "a".repeat(64),
        hostelId,
        ownerId: new Types.ObjectId(userId),
        systemDocumentKind: "STATEMENT",
        uploadCompletedAt: new Date(),
      }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({
      errorCode: "EVIDENCE_IS_SYSTEM_DOCUMENT",
      message: expect.stringContaining("statement"),
    });

    expectNothingQueued();
  });

  it("rejects an asset whose upload was never verified", async () => {
    mocks.assetFindOne.mockReturnValue(
      lean({ _id: assetId, hostelId, ownerId: new Types.ObjectId(userId) }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "ASSET_UPLOAD_INCOMPLETE" });

    expectNothingQueued();
  });
});

describe("submitClaim — amount out of bounds", () => {
  it("rejects an amount beyond outstanding × 1.5", async () => {
    await expect(
      submitClaim(invoiceId.toString(), { ...input, amount: 100000 }, principal),
    ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });

    expectNothingQueued();
  });

  it("rejects zero and negative amounts", async () => {
    for (const amount of [0, -500]) {
      await expect(
        submitClaim(invoiceId.toString(), { ...input, amount }, principal),
      ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });
    }

    expectNothingQueued();
  });

  it("allows a little over — a resident clearing a small arrear with the month", async () => {
    await expect(
      submitClaim(invoiceId.toString(), { ...input, amount: 12000 }, principal),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("measures against what is outstanding, not the invoice total", async () => {
    mocks.balanceFindOne.mockReturnValue(lean({ settledAmount: 9000 }));

    // 1,000 left, so 10,000 is now far out of bounds even though it equals the
    // invoice total — which is exactly the second-claim double-payment case.
    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });
  });
});

describe("submitClaim — invoices that cannot take a claim", () => {
  it("refuses a paid invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(
      lean({ _id: invoiceId, hostelId, status: "PAID", totalAmount: 10000 }),
    );

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "INVOICE_ALREADY_PAID" });

    expectNothingQueued();
  });

  it("answers NOT_FOUND for another resident's invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(lean(null));

    await expect(
      submitClaim(invoiceId.toString(), input, principal),
    ).rejects.toMatchObject({ errorCode: "INVOICE_NOT_FOUND" });

    expectNothingQueued();
  });
});
