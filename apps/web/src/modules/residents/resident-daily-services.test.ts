import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  bedFindOne: vi.fn(),
  complaintCountDocuments: vi.fn(),
  complaintFind: vi.fn(),
  connectToDatabase: vi.fn(),
  emergencyContactFind: vi.fn(),
  nightStatusFindOne: vi.fn(),
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

// The dashboard's night-status and complaints blocks were hardcoded literals
// until 2026-08-17; these two collections are what replaced them.
vi.mock("@hostel/db/models/NightStatus", () => ({
  NightStatusModel: {
    findOne: serviceMocks.nightStatusFindOne,
  },
}));

vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: {
    countDocuments: serviceMocks.complaintCountDocuments,
    find: serviceMocks.complaintFind,
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
    /*
      Two ledger reads per dashboard, in this order: the six rows of history
      `loadResidentBase` shows, then the unbounded unsettled read `feeStatus`
      does its arithmetic over. See `buildFeeSummary`.
    */
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([invoiceRow()]);
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([invoiceRow()]);
    serviceMocks.noticeFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.foodMenuFindOne.mockReturnValueOnce(queryResult(null));
    serviceMocks.nightStatusFindOne.mockReturnValueOnce(leanResult(null));
    serviceMocks.complaintFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.complaintCountDocuments.mockResolvedValueOnce(0);

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

  it("reads night status and complaints instead of returning the old literals", async () => {
    /*
     * Both blocks used to be hardcoded: `{ status: "UNKNOWN", checkedAt: null }`
     * — a value `NightStatusValue` does not contain — and `{ openCount: 0,
     * recent: [] }`. Every resident portal and the mobile home screen therefore
     * showed a status nothing wrote and a complaint count that was always zero.
     */
    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.hostelFindOne.mockReturnValueOnce(leanResult(null));
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([]);
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([]);
    serviceMocks.noticeFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.foodMenuFindOne.mockReturnValueOnce(queryResult(null));
    serviceMocks.nightStatusFindOne.mockReturnValueOnce(
      leanResult({
        _id: objectId("64f0f0f0f0f0f0f0f0f0f0b1"),
        checkedAt: new Date("2030-01-01T18:30:00.000Z"),
        hostelId: objectId(hostelId),
        residentId: objectId(residentId),
        source: "RESIDENT",
        status: "IN_HOSTEL",
      }),
    );
    serviceMocks.complaintFind.mockReturnValueOnce(
      queryResult([
        {
          _id: objectId("64f0f0f0f0f0f0f0f0f0f0b2"),
          category: "MAINTENANCE",
          createdAt: new Date("2030-01-01T00:00:00.000Z"),
          hostelId: objectId(hostelId),
          // Well past its SLA and still PENDING, which is the whole reason a
          // dashboard row is worth showing.
          slaDueAt: new Date("2020-01-01T00:00:00.000Z"),
          status: "PENDING",
          title: "Tap leaking",
        },
      ]),
    );
    serviceMocks.complaintCountDocuments.mockResolvedValueOnce(2);

    const result = await getResidentDashboard(residentPrincipal);

    expect(result.dashboard.nightStatus).toMatchObject({ status: "IN_HOSTEL" });
    expect(result.dashboard.complaints.openCount).toBe(2);
    expect(result.dashboard.complaints.recent[0]).toMatchObject({
      isOverdue: true,
      title: "Tap leaking",
    });

    // Scoped to this resident in this hostel, not to the hostel at large.
    expect(serviceMocks.complaintCountDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        hostelId: objectId(hostelId),
        residentId: objectId(residentId),
        status: { $in: ["PENDING", "IN_PROGRESS"] },
      }),
    );
  });

  it("reports an absent night-status row as NOT_VERIFIED, never UNKNOWN", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.hostelFindOne.mockReturnValueOnce(leanResult(null));
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([]);
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([]);
    serviceMocks.noticeFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.foodMenuFindOne.mockReturnValueOnce(queryResult(null));
    serviceMocks.nightStatusFindOne.mockReturnValueOnce(leanResult(null));
    serviceMocks.complaintFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.complaintCountDocuments.mockResolvedValueOnce(0);

    const result = await getResidentDashboard(residentPrincipal);

    // The same answer `GET /resident/night-status` gives, so the two surfaces
    // cannot disagree about a resident who has never been checked.
    expect(result.dashboard.nightStatus).toMatchObject({
      checkedAt: null,
      status: "NOT_VERIFIED",
    });
  });

  it("dates the dues from the earliest unsettled invoice, not the newest one", async () => {
    /*
     * The bug this pins, as it reached a device: the resident card printed
     * "Across 2 unpaid invoices · Due in 27 days".
     *
     * `latestPayment` is `payments[0]` out of a `dueDate: -1` sort with no
     * unpaid filter — the invoice due *furthest in the future*, settled ones
     * included — and its date was being shown beside a total summed across every
     * unpaid invoice. A resident two months behind was told they had 27 days
     * while the older invoice sat a month overdue. Wrong in the reassuring
     * direction, on the one line of this payload that costs money.
     *
     * `feeStatus.nextDue` is the earliest unsettled one, which is the invoice
     * anybody reading that line would act on.
     */
    const overdue = invoiceRow({
      _id: objectId("64f0f0f0f0f0f0f0f0f0f0c1"),
      dueDate: new Date("2030-01-10T00:00:00.000Z"),
      period: "2030-01",
      totalAmount: 8500,
    });
    const upcoming = invoiceRow({
      _id: objectId("64f0f0f0f0f0f0f0f0f0f0c2"),
      dueDate: new Date("2030-03-10T00:00:00.000Z"),
      period: "2030-03",
      totalAmount: 10300,
    });

    serviceMocks.residentFindOne.mockReturnValueOnce(
      leanResult(residentRecord({ userId: objectId(userId) })),
    );
    serviceMocks.hostelFindOne.mockReturnValueOnce(leanResult(null));
    // History, newest first — which is exactly why its head is the wrong row.
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([upcoming, overdue]);
    // The unsettled read, in the same order the pipeline returns it.
    serviceMocks.invoiceAggregate.mockResolvedValueOnce([upcoming, overdue]);
    serviceMocks.noticeFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.foodMenuFindOne.mockReturnValueOnce(queryResult(null));
    serviceMocks.nightStatusFindOne.mockReturnValueOnce(leanResult(null));
    serviceMocks.complaintFind.mockReturnValueOnce(queryResult([]));
    serviceMocks.complaintCountDocuments.mockResolvedValueOnce(0);

    const { feeStatus } = (await getResidentDashboard(residentPrincipal)).dashboard;

    expect(feeStatus.nextDue).toMatchObject({
      dueDate: "2030-01-10T00:00:00.000Z",
      month: "2030-01",
    });
    // Still the newest, because the screens use it for "Falgun 2086 · PAID".
    expect(feeStatus.latestPayment).toMatchObject({ month: "2030-03" });
    expect(feeStatus.dueAmount).toBe(18800);
    expect(feeStatus.unpaidCount).toBe(2);

    /*
     * The second read is the unbounded one. `dueAmount` and `unpaidCount` were
     * computed over `loadResidentBase`'s `{ limit: 6 }` history, so a resident
     * eight months behind was under-billed on their own dashboard and the count
     * stopped at six.
     */
    const [unsettledStages] = serviceMocks.invoiceAggregate.mock.calls[1];

    expect(unsettledStages[0].$match).toMatchObject({
      hostelId: objectId(hostelId),
      residentId: objectId(residentId),
      status: { $in: ["OPEN", "PARTIAL", "OVERDUE"] },
    });
    expect(unsettledStages.some((stage: { $limit?: number }) => stage.$limit)).toBe(
      false,
    );
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
