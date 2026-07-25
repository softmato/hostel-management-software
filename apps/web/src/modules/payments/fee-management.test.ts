import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  notificationCreate: vi.fn(),
  paymentFind: vi.fn(),
  paymentFindOne: vi.fn(),
  paymentFindOneAndUpdate: vi.fn(),
  paymentInsertMany: vi.fn(),
  paymentProofFindOne: vi.fn(),
  paymentProofFindOneAndUpdate: vi.fn(),
  platformSettingFindOne: vi.fn(),
  receiptCreate: vi.fn(),
  receiptFindOne: vi.fn(),
  receiptFindOneAndUpdate: vi.fn(),
  residentFind: vi.fn(),
  residentFindOne: vi.fn(),
  residentUpdateMany: vi.fn(),
  sendEmail: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Payment", () => ({
  PaymentModel: {
    find: mocks.paymentFind,
    findOne: mocks.paymentFindOne,
    findOneAndUpdate: mocks.paymentFindOneAndUpdate,
    insertMany: mocks.paymentInsertMany,
  },
}));

vi.mock("@hostel/db/models/PaymentProof", () => ({
  PaymentProofModel: {
    findOne: mocks.paymentProofFindOne,
    findOneAndUpdate: mocks.paymentProofFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: {
    create: mocks.receiptCreate,
    findOne: mocks.receiptFindOne,
    findOneAndUpdate: mocks.receiptFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    find: mocks.residentFind,
    findOne: mocks.residentFindOne,
    updateMany: mocks.residentUpdateMany,
  },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: vi.fn(), findOne: mocks.userFindOne },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { create: mocks.notificationCreate },
}));

vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: { findOne: mocks.platformSettingFindOne },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import {
  approvePaymentProof,
  generateMonthlyPayments,
  setResidentMonthlyFee,
} from "@/modules/payments/payment.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const residentAId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3");
const residentBId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b3");
const paymentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a7");
const proofId = "64f0f0f0f0f0f0f0f0f0f0a8";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

describe("fee management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.residentFindOne.mockReturnValue(leanResult(null));
    mocks.notificationCreate.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("bills each resident their own fee and falls back to the default", async () => {
    mocks.residentFind.mockReturnValue(
      leanResult([
        { _id: residentAId, monthlyFee: 9000 },
        { _id: residentBId, monthlyFee: 0 },
      ]),
    );
    mocks.paymentFind.mockReturnValue(leanResult([]));
    mocks.paymentInsertMany.mockResolvedValue([]);

    const result = await generateMonthlyPayments(
      {
        defaultAmount: 7000,
        dueDate: new Date("2030-07-05T00:00:00.000Z"),
        month: "2030-07",
      },
      staffPrincipal,
    );

    expect(result.createdCount).toBe(2);
    const inserted = mocks.paymentInsertMany.mock.calls[0][0];
    expect(inserted.map((entry: { dueAmount: number }) => entry.dueAmount)).toEqual([
      9000, 7000,
    ]);
  });

  it("never double-bills a resident who already has that month", async () => {
    mocks.residentFind.mockReturnValue(
      leanResult([
        { _id: residentAId, monthlyFee: 9000 },
        { _id: residentBId, monthlyFee: 9000 },
      ]),
    );
    mocks.paymentFind.mockReturnValue(leanResult([{ residentId: residentAId }]));
    mocks.paymentInsertMany.mockResolvedValue([]);

    const result = await generateMonthlyPayments(
      { dueDate: new Date("2030-07-05T00:00:00.000Z"), month: "2030-07" },
      staffPrincipal,
    );

    expect(result.createdCount).toBe(1);
    expect(result.skippedExistingCount).toBe(1);
    expect(mocks.paymentInsertMany.mock.calls[0][0]).toHaveLength(1);
  });

  it("skips residents with no fee and no default rather than billing zero", async () => {
    mocks.residentFind.mockReturnValue(leanResult([{ _id: residentAId, monthlyFee: 0 }]));
    mocks.paymentFind.mockReturnValue(leanResult([]));

    const result = await generateMonthlyPayments(
      { dueDate: new Date("2030-07-05T00:00:00.000Z"), month: "2030-07" },
      staffPrincipal,
    );

    expect(result.createdCount).toBe(0);
    expect(result.skippedNoFeeCount).toBe(1);
    expect(mocks.paymentInsertMany).not.toHaveBeenCalled();
  });

  it("sets a bulk monthly fee across the hostel", async () => {
    mocks.residentUpdateMany.mockResolvedValue({ modifiedCount: 12 });

    const result = await setResidentMonthlyFee({ monthlyFee: 8000 }, staffPrincipal);

    expect(result.updatedCount).toBe(12);
    expect(mocks.residentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["ACTIVE", "PENDING"] } }),
      expect.objectContaining({ $set: expect.objectContaining({ monthlyFee: 8000 }) }),
    );
  });
});

describe("payment proof verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.residentFindOne.mockReturnValue(leanResult(null));
    mocks.receiptFindOneAndUpdate.mockReturnValue(leanResult(null));
    mocks.receiptFindOne.mockReturnValue(queryResult(null));
    mocks.notificationCreate.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  function arrangeProof(amount: number, paidAmount = 0) {
    mocks.paymentProofFindOne.mockReturnValue(
      leanResult({
        _id: new Types.ObjectId(proofId),
        amount,
        hostelId: new Types.ObjectId(hostelId),
        paymentId,
        paymentMethod: "ESEWA",
        proofImageAssetId: "asset-1",
        residentId: residentAId,
        status: "PENDING",
        submittedAt: new Date(),
        submittedBy: new Types.ObjectId(staffPrincipal.userId),
      }),
    );
    mocks.paymentFindOne.mockReturnValue(
      leanResult({
        _id: paymentId,
        dueAmount: 10000,
        dueDate: new Date("2030-07-05T00:00:00.000Z"),
        hostelId: new Types.ObjectId(hostelId),
        month: "2030-07",
        paidAmount,
        residentId: residentAId,
        status: "PENDING_PROOF",
      }),
    );
    mocks.paymentProofFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: new Types.ObjectId(proofId),
        amount,
        hostelId: new Types.ObjectId(hostelId),
        paymentId,
        proofImageAssetId: "asset-1",
        residentId: residentAId,
        status: "APPROVED",
        submittedAt: new Date(),
        submittedBy: new Types.ObjectId(staffPrincipal.userId),
      }),
    );
    mocks.receiptCreate.mockImplementation(
      (input: Record<string, unknown>) =>
        Promise.resolve({ ...input, _id: new Types.ObjectId(), issuedAt: new Date() }),
    );
  }

  it("leaves a month PARTIAL when the verified amount is short", async () => {
    arrangeProof(4000);
    mocks.paymentFindOneAndUpdate.mockImplementation(
      (_filter: unknown, update: { $set: Record<string, unknown> }) =>
        leanResult({
          _id: paymentId,
          dueAmount: 10000,
          dueDate: new Date("2030-07-05T00:00:00.000Z"),
          hostelId: new Types.ObjectId(hostelId),
          month: "2030-07",
          paidAmount: update.$set.paidAmount,
          residentId: residentAId,
          status: update.$set.status,
        }),
    );

    const result = await approvePaymentProof(proofId, {}, staffPrincipal);

    expect(result.payment.status).toBe("PARTIAL");
    expect(result.payment.paidAmount).toBe(4000);
  });

  it("settles the month once the running total covers the due amount", async () => {
    arrangeProof(6000, 4000);
    mocks.paymentFindOneAndUpdate.mockImplementation(
      (_filter: unknown, update: { $set: Record<string, unknown> }) =>
        leanResult({
          _id: paymentId,
          dueAmount: 10000,
          dueDate: new Date("2030-07-05T00:00:00.000Z"),
          hostelId: new Types.ObjectId(hostelId),
          month: "2030-07",
          paidAmount: update.$set.paidAmount,
          residentId: residentAId,
          status: update.$set.status,
        }),
    );

    const result = await approvePaymentProof(proofId, {}, staffPrincipal);

    expect(result.payment.status).toBe("PAID");
    expect(result.payment.paidAmount).toBe(10000);
    expect(result.receipt.receiptNumber).toBe("RCP-2030-07-00001");
  });

  it("continues the receipt sequence within a month", async () => {
    arrangeProof(10000);
    mocks.receiptFindOne.mockReturnValue(
      queryResult({ receiptNumber: "RCP-2030-07-00122" }),
    );
    mocks.paymentFindOneAndUpdate.mockImplementation(
      (_filter: unknown, update: { $set: Record<string, unknown> }) =>
        leanResult({
          _id: paymentId,
          dueAmount: 10000,
          dueDate: new Date("2030-07-05T00:00:00.000Z"),
          hostelId: new Types.ObjectId(hostelId),
          month: "2030-07",
          paidAmount: update.$set.paidAmount,
          residentId: residentAId,
          status: update.$set.status,
        }),
    );

    const result = await approvePaymentProof(proofId, {}, staffPrincipal);

    expect(result.receipt.receiptNumber).toBe("RCP-2030-07-00123");
  });
});
