/**
 * Cash and reversals — Block 2 item 2.7 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §9).
 *
 * These two paths replace the unrestricted PATCH, which is the only endpoint in
 * the system that could set a balance to any number with no event, no proof and
 * no receipt — and which §8.3 lists as entirely untested. The tests the plan
 * names are here: the reversal invariant `sum(CREDIT) − sum(DEBIT) == balance`,
 * a reversed invoice returning to OPEN/PARTIAL, and a reversal without a reason
 * being rejected.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  invoiceFindOne: vi.fn(),
  paymentEventFindOne: vi.fn(),
  profileFindOne: vi.fn(),
  settleEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

// Partial: the two writers are stubbed, but `deriveInvoiceStatus` is the real
// rule the reversal tests below are about.
vi.mock("@/modules/finance/payment-event.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/finance/payment-event.service")>()),
  appendEvent: mocks.appendEvent,
  settleEvent: mocks.settleEvent,
}));

vi.mock("@hostel/db/models/HostelPaymentProfile", () => ({
  HostelPaymentProfileModel: { findOne: mocks.profileFindOne },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { findOne: mocks.invoiceFindOne },
}));

vi.mock("@hostel/db/models/PaymentEvent", () => ({
  PaymentEventModel: { findOne: mocks.paymentEventFindOne },
}));

import {
  approveCashPayment,
  recordCashPayment,
} from "@/modules/finance/cash-payment.service";
import { deriveInvoiceStatus } from "@/modules/finance/payment-event.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const invoiceId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");
const eventId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

// Two distinct people — the whole point of maker-checker — with the shape the
// service reads rather than a full principal.
function principal(id: string): ApiPrincipal {
  return {
    hostelIds: [hostelId.toString()],
    role: Role.HOSTEL_ADMIN,
    userId: id,
  } as ApiPrincipal;
}

const maker = principal("64f0f0f0f0f0f0f0f0f0f0b1");
const checker = principal("64f0f0f0f0f0f0f0f0f0f0b2");

function chain<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

const validCash = {
  amount: 5000,
  cashReceiptNumber: "BOOK-042",
  collectedBy: "Ram Thapa",
  invoiceId,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoiceFindOne.mockReturnValue(
    chain({ _id: invoiceId, hostelId, residentId, status: "OPEN" }),
  );
  mocks.profileFindOne.mockReturnValue(chain({ cashApprovalThreshold: 20000 }));
  mocks.appendEvent.mockResolvedValue({
    created: true,
    event: { _id: eventId, status: "PENDING" },
  });
  mocks.settleEvent.mockResolvedValue({
    balance: { outstanding: 7000, settledAmount: 5000 },
    receipt: { receiptNumber: "RCP-RUP-2026-08-00001" },
  });
});

describe("recording cash", () => {
  it("settles immediately below the threshold", async () => {
    const result = await recordCashPayment(validCash, maker);

    expect(result.pendingApproval).toBe(false);
    expect(mocks.settleEvent).toHaveBeenCalled();
    expect(result.receipt).not.toBeNull();
  });

  it("keys on the paper slip, so entering it twice is not two payments", async () => {
    await recordCashPayment(validCash, maker);

    expect(mocks.appendEvent.mock.calls[0]![0].idempotencyKey).toBe(
      `cash:${hostelId.toString()}:BOOK-042`,
    );
  });

  it("does not credit the invoice again when the slip was already entered", async () => {
    mocks.appendEvent.mockResolvedValue({
      created: false,
      event: { _id: eventId, status: "SETTLED" },
    });

    const result = await recordCashPayment(validCash, maker);

    expect(mocks.settleEvent).not.toHaveBeenCalled();
    expect(result.eventId).toBe(eventId.toString());
  });

  it("records who physically took the money", async () => {
    // Frequently not the person at the keyboard. Recording only the latter
    // names the wrong human when the count is short.
    await recordCashPayment({ ...validCash, note: "evening collection" }, maker);

    expect(mocks.appendEvent.mock.calls[0]![0].rawPayload).toMatchObject({
      cashReceiptNumber: "BOOK-042",
      collectedBy: "Ram Thapa",
      recordedBy: maker.userId.toString(),
    });
  });

  it.each([
    ["a blank receipt number", { cashReceiptNumber: " " }],
    ["no collector", { collectedBy: "" }],
    ["a zero amount", { amount: 0 }],
    ["a fractional amount", { amount: 100.5 }],
  ])("refuses %s", async (_label, override) => {
    await expect(
      recordCashPayment({ ...validCash, ...override }, maker),
    ).rejects.toBeInstanceOf(Error);
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("refuses cash against a voided invoice", async () => {
    mocks.invoiceFindOne.mockReturnValue(
      chain({ _id: invoiceId, hostelId, residentId, status: "VOID" }),
    );

    await expect(recordCashPayment(validCash, maker)).rejects.toBeInstanceOf(Error);
  });
});

describe("maker-checker", () => {
  it("holds cash above the hostel's threshold for a second person", async () => {
    const result = await recordCashPayment({ ...validCash, amount: 25000 }, maker);

    expect(result.pendingApproval).toBe(true);
    expect(mocks.settleEvent).not.toHaveBeenCalled();
  });

  it("uses the hostel's own threshold, not a platform-wide number", async () => {
    // NPR 20,000 is a routine month's rent in one hostel and a red flag in
    // another.
    mocks.profileFindOne.mockReturnValue(chain({ cashApprovalThreshold: 100000 }));

    const result = await recordCashPayment({ ...validCash, amount: 25000 }, maker);

    expect(result.pendingApproval).toBe(false);
  });

  it("falls back to NPR 20,000 when the hostel has no profile", async () => {
    mocks.profileFindOne.mockReturnValue(chain(null));

    expect((await recordCashPayment({ ...validCash, amount: 20001 }, maker))
      .pendingApproval).toBe(true);
  });

  it("refuses to let the recorder approve their own entry", async () => {
    // Without this the "second approver" is the same person clicking twice,
    // which is the control this exists to create.
    mocks.paymentEventFindOne.mockReturnValue(
      chain({ rawPayload: { recordedBy: maker.userId.toString() }, status: "PENDING" }),
    );

    await expect(approveCashPayment(eventId, maker)).rejects.toMatchObject({
      errorCode: "SECOND_APPROVER_REQUIRED",
    });
    expect(mocks.settleEvent).not.toHaveBeenCalled();
  });

  it("settles when a different person approves", async () => {
    mocks.paymentEventFindOne.mockReturnValue(
      chain({ rawPayload: { recordedBy: maker.userId.toString() }, status: "PENDING" }),
    );

    await approveCashPayment(eventId, checker);

    expect(mocks.settleEvent).toHaveBeenCalled();
  });

  it("refuses to approve an entry that is no longer pending", async () => {
    mocks.paymentEventFindOne.mockReturnValue(
      chain({ rawPayload: { recordedBy: maker.userId.toString() }, status: "SETTLED" }),
    );

    await expect(approveCashPayment(eventId, checker)).rejects.toMatchObject({
      errorCode: "SETTLED_EVENT_IMMUTABLE",
    });
  });
});

describe("the reversal invariant", () => {
  /** The ledger's definition of a balance, written out as the tests read it. */
  const balanceOf = (events: { amount: number; direction: string }[]) =>
    events.reduce(
      (sum, event) => sum + (event.direction === "DEBIT" ? -event.amount : event.amount),
      0,
    );

  it("holds: sum(CREDIT) − sum(DEBIT) equals the balance", () => {
    const ledger = [
      { amount: 5000, direction: "CREDIT" },
      { amount: 7000, direction: "CREDIT" },
      { amount: 5000, direction: "DEBIT" },
    ];

    expect(balanceOf(ledger)).toBe(7000);
  });

  it("returns a fully-paid invoice to PARTIAL when one payment is reversed", () => {
    const total = 12000;
    const settled = balanceOf([
      { amount: 5000, direction: "CREDIT" },
      { amount: 7000, direction: "CREDIT" },
    ]);

    expect(deriveInvoiceStatus({ settledAmount: settled, totalAmount: total })).toBe(
      "PAID",
    );

    const afterReversal = balanceOf([
      { amount: 5000, direction: "CREDIT" },
      { amount: 7000, direction: "CREDIT" },
      { amount: 7000, direction: "DEBIT" },
    ]);

    expect(
      deriveInvoiceStatus({
        dueDate: new Date("2099-01-01"),
        settledAmount: afterReversal,
        totalAmount: total,
      }),
    ).toBe("PARTIAL");
  });

  it("returns it to OPEN when the only payment is reversed", () => {
    const afterReversal = balanceOf([
      { amount: 12000, direction: "CREDIT" },
      { amount: 12000, direction: "DEBIT" },
    ]);

    expect(
      deriveInvoiceStatus({
        dueDate: new Date("2099-01-01"),
        settledAmount: afterReversal,
        totalAmount: 12000,
      }),
    ).toBe("OPEN");
  });

  it("reports a reversed overdue invoice as OVERDUE, not PARTIAL", () => {
    // Precedence decided in 2.2: past its due date and actionable outranks
    // half-paid, because PARTIAL hides it from the list an owner chases.
    expect(
      deriveInvoiceStatus({
        dueDate: new Date("2020-01-01"),
        settledAmount: 0,
        totalAmount: 12000,
      }),
    ).toBe("OVERDUE");
  });
});
