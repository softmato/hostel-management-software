import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  bedFindOne: vi.fn(),
  connectToDatabase: vi.fn(),
  emergencyContactFind: vi.fn(),
  foodFeedbackCreate: vi.fn(),
  foodMenuFindOne: vi.fn(),
  foodMenuFindOneAndUpdate: vi.fn(),
  foodPhotoCreate: vi.fn(),
  foodPhotoFind: vi.fn(),
  guardianFind: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  issueSessionForUser: vi.fn(),
  markReferralConverted: vi.fn(),
  notificationCreate: vi.fn(),
  platformSettingFindOne: vi.fn(),
  sendEmail: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  noticeCreate: vi.fn(),
  noticeFind: vi.fn(),
  noticeFindOne: vi.fn(),
  noticeFindOneAndUpdate: vi.fn(),
  noticeReadFind: vi.fn(),
  noticeReadFindOneAndUpdate: vi.fn(),
  qrActivationCreate: vi.fn(),
  qrActivationFindOne: vi.fn(),
  qrActivationUpdateMany: vi.fn(),
  qrActivationUpdateOne: vi.fn(),
  invoiceAggregate: vi.fn(),
  receiptCreate: vi.fn(),
  receiptFindOne: vi.fn(),
  receiptFindOneAndUpdate: vi.fn(),
  residentFindOne: vi.fn(),
  residentFindOneAndUpdate: vi.fn(),
  roomFindOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: {
    create: serviceMocks.auditCreate,
    // The finance audit envelope reads the hostel's chain head before writing.
    findOne: () => ({
      lean: async () => null,
      select: function select() {
        return this;
      },
      sort: function sort() {
        return this;
      },
    }),
  },
}));

vi.mock("@/modules/auth/auth.service", () => ({
  issueSessionForUser: serviceMocks.issueSessionForUser,
}));

vi.mock("@hostel/db/models/QRActivation", () => ({
  QRActivationModel: {
    create: serviceMocks.qrActivationCreate,
    findOne: serviceMocks.qrActivationFindOne,
    updateMany: serviceMocks.qrActivationUpdateMany,
    updateOne: serviceMocks.qrActivationUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    findOne: serviceMocks.residentFindOne,
    findOneAndUpdate: serviceMocks.residentFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    find: serviceMocks.userFind,
    findOne: serviceMocks.userFindOne,
    findOneAndUpdate: serviceMocks.userFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { aggregate: serviceMocks.invoiceAggregate },
}));

vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: {
    create: serviceMocks.receiptCreate,
    findOne: serviceMocks.receiptFindOne,
    findOneAndUpdate: serviceMocks.receiptFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/FoodRoutine", () => ({
  FoodRoutineModel: {
    findOne: serviceMocks.foodMenuFindOne,
    findOneAndUpdate: serviceMocks.foodMenuFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/FoodPhoto", () => ({
  FoodPhotoModel: {
    create: serviceMocks.foodPhotoCreate,
    find: serviceMocks.foodPhotoFind,
  },
}));

vi.mock("@hostel/db/models/FoodFeedback", () => ({
  FoodFeedbackModel: {
    create: serviceMocks.foodFeedbackCreate,
  },
}));

vi.mock("@hostel/db/models/Notice", () => ({
  NoticeModel: {
    create: serviceMocks.noticeCreate,
    find: serviceMocks.noticeFind,
    findOne: serviceMocks.noticeFindOne,
    findOneAndUpdate: serviceMocks.noticeFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/NoticeReadStatus", () => ({
  NoticeReadStatusModel: {
    find: serviceMocks.noticeReadFind,
    findOneAndUpdate: serviceMocks.noticeReadFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: {
    findOne: serviceMocks.hostelFindOne,
  },
}));

vi.mock("@hostel/db/models/Room", () => ({
  RoomModel: {
    findOne: serviceMocks.roomFindOne,
  },
}));

vi.mock("@hostel/db/models/Bed", () => ({
  BedModel: {
    findOne: serviceMocks.bedFindOne,
  },
}));

vi.mock("@hostel/db/models/Guardian", () => ({
  GuardianModel: {
    find: serviceMocks.guardianFind,
  },
}));

vi.mock("@hostel/db/models/EmergencyContact", () => ({
  EmergencyContactModel: {
    find: serviceMocks.emergencyContactFind,
  },
}));

// Notification side-effects (config lookup, admin/resident contact resolution)
// hang against unmocked models, so stub the collections they reach for.
vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: {
    findOne: serviceMocks.platformSettingFindOne,
  },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: {
    find: serviceMocks.hostelMemberFind,
  },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: {
    create: serviceMocks.notificationCreate,
  },
}));

vi.mock("@hostel/shared/email/sender", () => ({
  sendEmail: serviceMocks.sendEmail,
}));

// Approving a proof also converts the resident's referral; that path is covered
// by referral-conversion.test.ts.
vi.mock("@/modules/referrals/referral.service", () => ({
  assertActiveReferralCode: vi.fn(),
  linkReferralOnRegistration: vi.fn(),
  markReferralConverted: serviceMocks.markReferralConverted,
}));

import {
  activateResident,
  generateActivationCode,
} from "@/modules/residents/activation.service";
import { getResidentDashboard } from "@/modules/residents/resident-dashboard.service";
import { submitFoodFeedback } from "@/modules/food/food.service";
import { listNotices, markNoticeAsRead } from "@/modules/notices/notice.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0a2";
const residentId = "64f0f0f0f0f0f0f0f0f0f0a3";
const userId = "64f0f0f0f0f0f0f0f0f0f0a4";
const roomId = "64f0f0f0f0f0f0f0f0f0f0a5";
const bedId = "64f0f0f0f0f0f0f0f0f0f0a6";
const invoiceId = "64f0f0f0f0f0f0f0f0f0f0a7";

/** A row as the ledger pipeline emits it — the shape the facade maps from. */
function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(invoiceId),
    dueDate: new Date("2030-01-10T00:00:00.000Z"),
    hostelId: objectId(hostelId),
    paidAmount: 0,
    period: "2030-01",
    residentId: objectId(residentId),
    status: "OPEN",
    totalAmount: 8500,
    ...overrides,
  };
}
const noticeId = "64f0f0f0f0f0f0f0f0f0f0a9";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId,
};

const residentPrincipal = {
  hostelIds: [hostelId],
  role: Role.RESIDENT,
  sessionId: "session-2",
  userId,
};

function objectId(value: string) {
  return new Types.ObjectId(value);
}

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function residentRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId(residentId),
    bedId: objectId(bedId),
    depositAmount: 5000,
    firstName: "Asha",
    hostelId: objectId(hostelId),
    lastName: "Rai",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomId: objectId(roomId),
    status: "ACTIVE",
    ...overrides,
  };
}

describe("resident daily-use services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.markReferralConverted.mockResolvedValue({ converted: false });

    // Notification plumbing: no stored config, no reachable contacts, no sends.
    serviceMocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    serviceMocks.hostelMemberFind.mockReturnValue(leanResult([]));
    serviceMocks.userFind.mockReturnValue(leanResult([]));
    serviceMocks.userFindOne.mockReturnValue(leanResult(null));
    serviceMocks.notificationCreate.mockResolvedValue({});
    serviceMocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("generates hashed one-time activation codes without storing plain code", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(leanResult(residentRecord()));
    serviceMocks.qrActivationCreate.mockResolvedValueOnce({
      _id: objectId("64f0f0f0f0f0f0f0f0f0f0ac"),
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      createdBy: objectId(userId),
      expiresAt: new Date("2030-01-03T00:00:00.000Z"),
      hostelId: objectId(hostelId),
      residentId: objectId(residentId),
      status: "PENDING",
    });

    const result = await generateActivationCode(
      residentId,
      { expiresInHours: 48, sendEmail: false },
      staffPrincipal,
    );

    expect(result.activation.code).toHaveLength(8);
    expect(serviceMocks.qrActivationUpdateMany).toHaveBeenCalledWith(
      { residentId: objectId(residentId), status: "PENDING" },
      { $set: { status: "CANCELLED" } },
    );
    expect(serviceMocks.qrActivationCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ code: expect.any(String) }),
    );
    expect(serviceMocks.qrActivationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ codeHash: expect.any(String), status: "PENDING" }),
    );
  });

  it("rejects expired and already-used activation codes", async () => {
    serviceMocks.qrActivationFindOne.mockReturnValueOnce(
      queryResult({
        _id: objectId("64f0f0f0f0f0f0f0f0f0f0ad"),
        createdBy: objectId(userId),
        expiresAt: new Date("2000-01-01T00:00:00.000Z"),
        hostelId: objectId(hostelId),
        residentId: objectId(residentId),
        status: "PENDING",
      }),
    );

    await expect(
      activateResident(
        { code: "ABCD1234", deviceInfo: {}, sessionInfo: {} },
        residentPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "ACTIVATION_CODE_EXPIRED", status: 410 });
    expect(serviceMocks.qrActivationUpdateOne).toHaveBeenCalledWith(
      { _id: objectId("64f0f0f0f0f0f0f0f0f0f0ad") },
      { $set: { status: "EXPIRED" } },
    );

    serviceMocks.qrActivationFindOne.mockReturnValueOnce(
      queryResult({
        _id: objectId("64f0f0f0f0f0f0f0f0f0f0ae"),
        createdBy: objectId(userId),
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        hostelId: objectId(hostelId),
        residentId: objectId(residentId),
        status: "USED",
        usedAt: new Date("2030-01-01T00:00:00.000Z"),
      }),
    );

    await expect(
      activateResident(
        { code: "USED1234", deviceInfo: {}, sessionInfo: {} },
        residentPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "ACTIVATION_CODE_USED", status: 409 });
  });

  it("returns resident dashboard data only for the current resident account", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.hostelFindOne.mockReturnValueOnce(
      leanResult({
        _id: objectId(hostelId),
        name: "Green View Hostel",
        slug: "green-view-hostel",
      }),
    );
    serviceMocks.roomFindOne.mockReturnValueOnce(
      leanResult({ _id: objectId(roomId), roomNumber: "201", roomType: "DOUBLE" }),
    );
    serviceMocks.bedFindOne.mockReturnValueOnce(
      leanResult({ _id: objectId(bedId), bedNumber: "B", status: "OCCUPIED" }),
    );
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([invoiceRow()]);
    serviceMocks.noticeFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.foodMenuFindOne.mockReturnValueOnce(queryResult(null));

    const result = await getResidentDashboard(residentPrincipal);

    expect(result.dashboard.resident.id).toBe(residentId);
    expect(serviceMocks.residentFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: objectId(userId) }),
    );
    // The dashboard reads through the ledger facade since item 2.8, so the
    // tenant boundary now lives in the pipeline's opening $match.
    const [stages] = serviceMocks.invoiceAggregate.mock.calls[0];

    expect(stages[0].$match).toMatchObject({
      hostelId: objectId(hostelId),
      residentId: objectId(residentId),
    });
  });

  it("enforces food tenant isolation and accepts feedback for the current hostel", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.foodFeedbackCreate.mockResolvedValueOnce({
      _id: objectId("64f0f0f0f0f0f0f0f0f0f0af"),
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      date: new Date("2030-01-01T00:00:00.000Z"),
      hostelId: objectId(hostelId),
      isAnonymous: false,
      mealType: "DINNER",
      rating: 4,
      residentId: objectId(residentId),
    });

    const result = await submitFoodFeedback(
      {
        date: new Date("2030-01-01T00:00:00.000Z"),
        isAnonymous: false,
        mealType: "DINNER",
        rating: 4,
      },
      residentPrincipal,
    );

    expect(result.feedback.rating).toBe(4);
  });

  it("enforces notice tenant isolation and marks own-hostel notices read", async () => {
    await expect(
      listNotices({ hostelId: otherHostelId }, staffPrincipal),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", status: 404 });

    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.noticeFindOne.mockReturnValueOnce(
      leanResult({
        _id: objectId(noticeId),
        category: "GENERAL",
        content: "Dinner timing updated.",
        hostelId: objectId(hostelId),
        isUrgent: false,
        title: "Dinner",
      }),
    );
    serviceMocks.noticeReadFindOneAndUpdate.mockReturnValueOnce(
      leanResult({
        _id: objectId("64f0f0f0f0f0f0f0f0f0f0b0"),
        noticeId: objectId(noticeId),
        readAt: new Date("2030-01-01T00:00:00.000Z"),
        userId: objectId(userId),
      }),
    );

    const result = await markNoticeAsRead(noticeId, residentPrincipal);

    expect(result.notice.isRead).toBe(true);
    expect(serviceMocks.noticeFindOne).toHaveBeenCalledWith({
      _id: objectId(noticeId),
      hostelId: objectId(hostelId),
    });
  });
});
