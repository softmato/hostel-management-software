/**
 * Receipts — Block 2 item 2.6 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §4.4), and invariant 6: one receipt per settled event, per-hostel
 * sequence with no gaps and no duplicates under concurrency.
 *
 * `fee-management.test.ts` covers the same ground against the old allocator and
 * is the suite §8.2 says to port rather than discard. These are its equivalents
 * on the new service — the old file still runs until 2.8 deletes it.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  counterUpdate: vi.fn(),
  hostelFindOne: vi.fn(),
  invoiceFindOne: vi.fn(),
  receiptCreate: vi.fn(),
  receiptFindOne: vi.fn(),
  receiptUpdateOne: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/finance/audit-finance", () => ({ auditFinanceAction: mocks.audit }));
vi.mock("@/modules/finance/ledger-read.service", () => ({
  listResidentInvoices: vi.fn().mockResolvedValue([]),
}));

vi.mock("@hostel/db/models/ReceiptCounter", () => ({
  ReceiptCounterModel: { findOneAndUpdate: mocks.counterUpdate },
}));

// Partial: the model is mocked, but `receiptUpdateViolatesImmutability` is the
// real rule under test and must come from the module itself.
vi.mock("@hostel/db/models/Receipt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hostel/db/models/Receipt")>()),
  ReceiptModel: {
    create: mocks.receiptCreate,
    findOne: mocks.receiptFindOne,
    updateOne: mocks.receiptUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { findOne: mocks.invoiceFindOne },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));

import {
  issueReceiptForEvent,
  nextReceiptNumber,
  periodOfDate,
  voidReceipt,
} from "@/modules/finance/receipt.service";
import { receiptUpdateViolatesImmutability } from "@hostel/db/models/Receipt";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const eventId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");
const receiptId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f9");

const principal = { userId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1") } as never;

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

let sequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  sequence = 0;
  mocks.counterUpdate.mockImplementation(() => {
    sequence += 1;
    return chain({ sequence });
  });
  mocks.hostelFindOne.mockReturnValue(chain({ name: "Rupa", referencePrefix: "RUP" }));
  mocks.receiptFindOne.mockReturnValue(chain(null));
  mocks.receiptCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
    ...doc,
    _id: new Types.ObjectId(),
  }));
  mocks.receiptUpdateOne.mockResolvedValue({});
  mocks.audit.mockResolvedValue(undefined);
});

describe("numbering", () => {
  it("allocates atomically rather than by reading the last number", async () => {
    // The old allocator was findOne(regex).sort(desc) — a race dressed as a
    // query, with a five-attempt retry loop bolted on to survive it.
    await nextReceiptNumber(hostelId, "2026-08", "RUP");

    const [filter, update, options] = mocks.counterUpdate.mock.calls[0]!;

    expect(filter).toEqual({ hostelId, kind: "RECEIPT", period: "2026-08" });
    expect(update).toEqual({ $inc: { sequence: 1 } });
    expect(options).toMatchObject({ new: true, upsert: true });
  });

  it("gives concurrent callers distinct numbers with no gaps", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => nextReceiptNumber(hostelId, "2026-08", "RUP")),
    );

    expect(new Set(numbers).size).toBe(20);
    expect(numbers.map((n) => Number(n.slice(-5))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  });

  it("scopes the number to the hostel, so sequences cannot leak volume", async () => {
    // A global sequence interleaves hostels and its gaps tell any hostel how
    // many receipts the platform issued.
    const number = await nextReceiptNumber(hostelId, "2026-08", "RUP");

    expect(number).toBe("RCP-RUP-2026-08-00001");
  });

  it("keeps counting past the five-digit padding", async () => {
    mocks.counterUpdate.mockReturnValue(chain({ sequence: 123_456 }));

    // The string-sorted allocator started reusing numbers here; padding is for
    // readability and nothing depends on the width.
    expect(await nextReceiptNumber(hostelId, "2026-08", "RUP")).toBe(
      "RCP-RUP-2026-08-123456",
    );
  });

  it("derives the period from the hostel's own day, not from UTC", () => {
    /*
     * 23:30 UTC on 16 September is 05:15 on the 17th in Kathmandu, which is
     * Aswin 1. Numbering that receipt into Bhadra hands somebody a `2083-05`
     * reference on an Aswin morning and reopens a counter the month had
     * finished with — and the Gregorian month has not changed at all, which is
     * why the boundary has to be read in the calendar the counter is keyed by.
     */
    expect(periodOfDate(new Date("2026-09-16T23:30:00.000Z"))).toBe("2083-06");
    expect(periodOfDate(new Date("2026-09-16T18:14:00.000Z"))).toBe("2083-05");
  });
});

describe("issuing", () => {
  it("issues one receipt for a settled event", async () => {
    const receipt = await issueReceiptForEvent(
      { amount: 12000, eventId, hostelId, invoiceId, residentId },
      principal,
    );

    expect(receipt).toMatchObject({ amount: 12000, eventId, invoiceId });
    expect(mocks.receiptCreate).toHaveBeenCalledTimes(1);
  });

  it("returns the existing receipt instead of minting a second", async () => {
    // The crash-and-resume path ADR-4 deliberately allows re-runs settlement.
    // Two receipts for one payment is money appearing to arrive twice.
    mocks.receiptFindOne.mockReturnValue(chain({ _id: receiptId, amount: 12000 }));

    const receipt = await issueReceiptForEvent(
      { amount: 12000, eventId, hostelId, residentId },
      principal,
    );

    expect(receipt._id).toEqual(receiptId);
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });

  it("returns the winner when two settlements race the unique index", async () => {
    mocks.receiptCreate.mockRejectedValue({ code: 11000 });
    mocks.receiptFindOne
      .mockReturnValueOnce(chain(null))
      .mockReturnValueOnce(chain({ _id: receiptId, amount: 12000 }));

    const receipt = await issueReceiptForEvent(
      { amount: 12000, eventId, hostelId, residentId },
      principal,
    );

    expect(receipt._id).toEqual(receiptId);
  });

  it("records no issuer when a scheduled job issued it", async () => {
    await issueReceiptForEvent({ amount: 12000, eventId, hostelId, residentId });

    expect(mocks.receiptCreate.mock.calls[0]![0].issuedBy).toBeNull();
  });
});

describe("immutability", () => {
  it.each(["amount", "eventId", "invoiceId", "receiptNumber", "residentId"])(
    "refuses an update that rewrites %s",
    (field) => {
      expect(receiptUpdateViolatesImmutability({ $set: { [field]: 1 } })).toBe(true);
    },
  );

  it("permits voiding, which does not change what the receipt said", () => {
    expect(
      receiptUpdateViolatesImmutability({
        $set: { voidReason: "wrong amount", voidedAt: new Date() },
      }),
    ).toBe(false);
  });

  it("sees through a top-level assignment as well as $set", () => {
    expect(receiptUpdateViolatesImmutability({ amount: 1 })).toBe(true);
  });
});

describe("voiding and reissuing", () => {
  beforeEach(() => {
    mocks.receiptFindOne.mockReturnValue(
      chain({
        _id: receiptId,
        amount: 12000,
        hostelId,
        invoiceId,
        issuedAt: new Date(),
        receiptNumber: "RCP-RUP-2026-08-00007",
        residentId,
        voidedAt: null,
      }),
    );
  });

  it("gives the replacement a fresh number rather than reusing the voided one", async () => {
    // Two different documents answering to one identifier is exactly what a
    // receipt number exists to prevent.
    mocks.counterUpdate.mockReturnValue(chain({ sequence: 8 }));

    const { receipt, replacement } = await voidReceipt(receiptId, {
      principal,
      reason: "wrong amount",
      reissue: { amount: 9000 },
    });

    expect(mocks.counterUpdate).toHaveBeenCalledTimes(1);
    expect(replacement?.receiptNumber).toMatch(/-00008$/);
    expect(replacement?.receiptNumber).not.toBe(receipt.receiptNumber);
  });

  it("does not give the replacement the event id", async () => {
    // The unique index permits one receipt per event and the voided one holds
    // it. A replacement is a document about the same money, not a second claim.
    await voidReceipt(receiptId, {
      principal,
      reason: "wrong amount",
      reissue: { amount: 9000 },
    });

    expect(mocks.receiptCreate.mock.calls[0]![0].eventId).toBeUndefined();
  });

  it("voids without reissuing, for a reversal", async () => {
    const { replacement } = await voidReceipt(receiptId, {
      principal,
      reason: "payment reversed",
    });

    expect(replacement).toBeNull();
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });

  it("refuses to void twice", async () => {
    mocks.receiptFindOne.mockReturnValue(
      chain({ _id: receiptId, amount: 1, hostelId, residentId, voidedAt: new Date() }),
    );

    await expect(
      voidReceipt(receiptId, { principal, reason: "again" }),
    ).rejects.toMatchObject({ errorCode: "RECEIPT_ALREADY_VOID" });
  });

  it("refuses to void without a reason", async () => {
    await expect(
      voidReceipt(receiptId, { principal, reason: "" }),
    ).rejects.toBeInstanceOf(Error);
  });

  it("audits the void with both amounts", async () => {
    await voidReceipt(receiptId, {
      principal,
      reason: "wrong amount",
      reissue: { amount: 9000 },
    });

    expect(mocks.audit).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        action: "RECEIPT_VOIDED",
        amountAfter: 9000,
        amountBefore: 12000,
      }),
    );
  });
});
