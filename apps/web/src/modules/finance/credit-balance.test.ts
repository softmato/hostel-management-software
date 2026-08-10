/**
 * Credit balances — Block 5 item 5.3 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §9.4).
 *
 * One rule, stated by the target doc as an imperative: **never destroy money.**
 * The case the plan names is here — 15,000 paid against a 12,000 invoice yields
 * a full settlement and 3,000 in credit, with the total conserved — and so is
 * the conservation check itself, because "the invoice says PAID" and "every
 * rupee is still accounted for" are different claims and only the second one is
 * the point.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");
const eventId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@hostel/db/models/CreditBalance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hostel/db/models/CreditBalance")>()),
  CreditBalanceModel: { findOne: mocks.findOne, updateOne: mocks.updateOne },
}));

import { computeCreditAmount } from "@hostel/db/models/CreditBalance";
import {
  applyCreditToInvoice,
  creditOverpayment,
  getCreditBalance,
} from "@/modules/finance/credit-balance.service";

type Entry = { amount: number; idempotencyKey: string; kind: string };

/** The stored document, mutated by `updateOne` the way Mongo would. */
let stored: { amount: number; entries: Entry[] };

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = { amount: 0, entries: [] };

  mocks.findOne.mockImplementation(() => chain({ ...stored, entries: stored.entries }));
  mocks.updateOne.mockImplementation(
    (_filter: unknown, update: Record<string, never>) => {
      const push = (update as { $push?: { entries: Entry } }).$push;
      const set = (update as { $set?: { amount?: number } }).$set;

      if (push) {
        // The unique index on `entries.idempotencyKey`, enforced here so the
        // service's replay path is exercised rather than assumed.
        if (stored.entries.some((one) => one.idempotencyKey === push.entries.idempotencyKey)) {
          return Promise.reject(Object.assign(new Error("dup"), { code: 11000 }));
        }

        stored.entries.push(push.entries);
      }

      if (set?.amount !== undefined) {
        stored.amount = set.amount;
      }

      return Promise.resolve({});
    },
  );
});

describe("computeCreditAmount", () => {
  it("adds what was earned and subtracts what was used", () => {
    expect(
      computeCreditAmount([
        { amount: 3000, kind: "EARNED" },
        { amount: 1000, kind: "APPLIED" },
        { amount: 500, kind: "REFUNDED" },
      ]),
    ).toBe(1500);
  });

  it("is zero for a resident who has never overpaid", () => {
    expect(computeCreditAmount([])).toBe(0);
  });
});

describe("an overpayment", () => {
  it("leaves the excess as credit — 15,000 against 12,000 gives 3,000", async () => {
    const result = await creditOverpayment({
      eventId,
      excess: 3000,
      hostelId,
      invoiceId,
      residentId,
    });

    expect(result.created).toBe(true);
    expect(result.amount).toBe(3000);
  });

  it("conserves the total: nothing is clamped away", async () => {
    // The clamp this replaces made a 15,000 payment against a 12,000 invoice
    // indistinguishable from a 12,000 one. Settled + credit must equal paid.
    const paid = 15000;
    const invoiceTotal = 12000;

    const { amount: credit } = await creditOverpayment({
      eventId,
      excess: paid - invoiceTotal,
      hostelId,
      invoiceId,
      residentId,
    });

    expect(invoiceTotal + credit).toBe(paid);
  });

  it("cannot credit the same overpayment twice", async () => {
    await creditOverpayment({ eventId, excess: 3000, hostelId, invoiceId, residentId });
    const replay = await creditOverpayment({
      eventId,
      excess: 3000,
      hostelId,
      invoiceId,
      residentId,
    });

    expect(replay.created).toBe(false);
    expect(replay.amount).toBe(3000);
    expect(stored.entries).toHaveLength(1);
  });

  it("refuses a zero or negative excess", async () => {
    await expect(
      creditOverpayment({ eventId, excess: 0, hostelId, invoiceId, residentId }),
    ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });
  });

  it("refuses a part-rupee excess rather than rounding it", async () => {
    await expect(
      creditOverpayment({ eventId, excess: 3000.5, hostelId, invoiceId, residentId }),
    ).rejects.toMatchObject({ errorCode: "AMOUNT_OUT_OF_BOUNDS" });
  });
});

describe("applying credit to a new invoice", () => {
  beforeEach(async () => {
    await creditOverpayment({ eventId, excess: 3000, hostelId, invoiceId, residentId });
  });

  it("applies what is available, no more than the invoice", async () => {
    const applied = await applyCreditToInvoice({
      hostelId,
      invoiceId: new Types.ObjectId(),
      maxAmount: 8000,
      residentId,
    });

    expect(applied).toBe(3000);
  });

  it("never applies more than the invoice — an invoice cannot go negative", async () => {
    const applied = await applyCreditToInvoice({
      hostelId,
      invoiceId: new Types.ObjectId(),
      maxAmount: 1000,
      residentId,
    });

    expect(applied).toBe(1000);
  });

  it("leaves the remainder for the month after", async () => {
    await applyCreditToInvoice({
      hostelId,
      invoiceId: new Types.ObjectId(),
      maxAmount: 1000,
      residentId,
    });

    expect(computeCreditAmount(stored.entries)).toBe(2000);
  });

  it("does not discount the same invoice twice on a re-run", async () => {
    const second = new Types.ObjectId();

    await applyCreditToInvoice({ hostelId, invoiceId: second, maxAmount: 8000, residentId });
    const replay = await applyCreditToInvoice({
      hostelId,
      invoiceId: second,
      maxAmount: 8000,
      residentId,
    });

    // The mirror image of double-billing, and just as unwelcome.
    expect(replay).toBe(0);
    expect(computeCreditAmount(stored.entries)).toBe(0);
  });

  it("applies nothing when there is nothing to apply", async () => {
    stored = { amount: 0, entries: [] };

    expect(
      await applyCreditToInvoice({
        hostelId,
        invoiceId: new Types.ObjectId(),
        maxAmount: 8000,
        residentId,
      }),
    ).toBe(0);
  });
});

describe("the resident's view", () => {
  it("shows the amount and where it came from", async () => {
    await creditOverpayment({ eventId, excess: 3000, hostelId, invoiceId, residentId });

    const view = await getCreditBalance(hostelId, residentId);

    expect(view.amount).toBe(3000);
    expect(view.entries[0]?.kind).toBe("EARNED");
    expect(view.entries[0]?.note).toContain("Overpayment");
  });

  it("is zero, not an error, for a resident with no credit record", async () => {
    mocks.findOne.mockReturnValue(chain(null));

    expect((await getCreditBalance(hostelId, residentId)).amount).toBe(0);
  });
});
