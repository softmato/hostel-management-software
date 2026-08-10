import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  complaintFind: vi.fn(),
  connectToDatabase: vi.fn(),
  foodRoutine: vi.fn(),
  guardianAccessFindOne: vi.fn(),
  guardianFindOne: vi.fn(),
  guardianPermissionFindOne: vi.fn(),
  hostelFindOne: vi.fn(),
  nightStatusFindOne: vi.fn(),
  noticeFind: vi.fn(),
  invoiceAggregate: vi.fn(),
  receiptFind: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: {
    findOne: mocks.guardianAccessFindOne,
    updateMany: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/Guardian", () => ({
  GuardianModel: { findById: vi.fn(), findOne: mocks.guardianFindOne },
}));

vi.mock("@hostel/db/models/GuardianPermission", () => ({
  GuardianPermissionModel: { create: vi.fn(), findOne: mocks.guardianPermissionFindOne },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/Invoice", () => ({
  InvoiceModel: { aggregate: mocks.invoiceAggregate },
}));

vi.mock("@hostel/db/models/Receipt", () => ({
  ReceiptModel: { find: mocks.receiptFind },
}));

vi.mock("@hostel/db/models/Notice", () => ({
  NoticeModel: { find: mocks.noticeFind },
}));

vi.mock("@hostel/db/models/NightStatus", () => ({
  NightStatusModel: { findOne: mocks.nightStatusFindOne },
}));

vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: { find: mocks.complaintFind },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: vi.fn() },
}));

vi.mock("@/modules/food/food-routine.service", () => ({
  getFoodRoutine: mocks.foodRoutine,
  mealsOn: () => [{ items: ["Dal bhat"], mealType: "LUNCH" }],
}));

vi.mock("@/modules/auth/auth.service", () => ({ issueSessionForUser: vi.fn() }));

import { getGuardianDashboard } from "@/modules/guardian/guardian.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0d1";
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d2");
const guardianId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d3");
const accessId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d4");

const guardianPrincipal = {
  hostelIds: [hostelId],
  role: Role.GUARDIAN,
  sessionId: "session-g",
  userId: "64f0f0f0f0f0f0f0f0f0f0d5",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function setPermissions(permissions: Record<string, boolean> | null) {
  mocks.guardianPermissionFindOne.mockReturnValue(leanResult(permissions));
}

describe("guardian dashboard privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guardianAccessFindOne.mockReturnValue(
      leanResult({
        _id: accessId,
        accessCode: "AB12CD",
        allowComplaintStatus: false,
        expiresAt: new Date("2031-01-01T00:00:00.000Z"),
        guardianId,
        hostelId: new Types.ObjectId(hostelId),
        phone: "9800000000",
        residentId,
        status: "USED",
      }),
    );
    mocks.residentFindOne.mockReturnValue(
      leanResult({
        _id: residentId,
        depositAmount: 5000,
        email: "asha@example.com",
        firstName: "Asha",
        hostelId: new Types.ObjectId(hostelId),
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        roomType: "DOUBLE",
        status: "ACTIVE",
      }),
    );
    mocks.guardianFindOne.mockReturnValue(
      leanResult({
        _id: guardianId,
        firstName: "Bimala",
        hostelId: new Types.ObjectId(hostelId),
        lastName: "Rai",
        phone: "9800000000",
        relation: "Mother",
        residentId,
      }),
    );
    mocks.hostelFindOne.mockReturnValue(
      leanResult({ _id: new Types.ObjectId(hostelId), location: {}, name: "Sunrise" }),
    );
    // Since item 2.8 the guardian view reads through the ledger facade, so the
    // fixture is a pipeline row rather than a `Payment` document.
    mocks.invoiceAggregate.mockResolvedValue([
      {
        _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d6"),
        dueDate: new Date("2030-02-05T00:00:00.000Z"),
        hostelId: new Types.ObjectId(hostelId),
        paidAmount: 0,
        period: "2030-02",
        residentId,
        status: "OPEN",
        totalAmount: 5000,
      },
    ]);
    mocks.receiptFind.mockReturnValue(
      queryResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d7"),
          amount: 5000,
          issuedAt: new Date("2030-01-05T10:15:00.000Z"),
          month: "2030-01",
          receiptNumber: "RCP-2030-01-00001",
        },
      ]),
    );
    mocks.noticeFind.mockReturnValue(
      queryResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d8"),
          category: "GENERAL",
          content: "Water cut tomorrow",
          isUrgent: false,
          title: "Water cut",
        },
      ]),
    );
    mocks.nightStatusFindOne.mockReturnValue(
      leanResult({
        checkedAt: new Date("2030-02-01T22:45:00.000Z"),
        status: "INSIDE_HOSTEL",
      }),
    );
    mocks.complaintFind.mockReturnValue(
      queryResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d9"),
          status: "PENDING",
          title: "Broken lock",
        },
      ]),
    );
    mocks.foodRoutine.mockResolvedValue({ days: [] });
  });

  it("returns nothing but the basics when no permission document exists", async () => {
    setPermissions(null);

    const { dashboard } = await getGuardianDashboard(guardianPrincipal);

    expect(dashboard.payments).toEqual([]);
    expect(dashboard.receipts).toEqual([]);
    expect(dashboard.notices).toEqual([]);
    expect(dashboard.food).toEqual([]);
    expect(dashboard.safety).toBeNull();
    expect(dashboard.complaints).toEqual([]);
    expect(dashboard.summary).toBeNull();
    // The hostel and the resident's identity stay visible — that is what the
    // guardian is here for.
    expect(dashboard.hostel?.name).toBe("Sunrise");
    expect(dashboard.resident.fullName).toBe("Asha Rai");
  });

  it("never queries a collection the resident did not share", async () => {
    setPermissions({ canViewPayments: true });

    await getGuardianDashboard(guardianPrincipal);

    expect(mocks.invoiceAggregate).toHaveBeenCalled();
    expect(mocks.receiptFind).not.toHaveBeenCalled();
    expect(mocks.noticeFind).not.toHaveBeenCalled();
    expect(mocks.complaintFind).not.toHaveBeenCalled();
    expect(mocks.nightStatusFindOne).not.toHaveBeenCalled();
  });

  it("omits the resident's contact details and deposit entirely", async () => {
    setPermissions({ canViewPayments: true, canViewReceipts: true });

    const { dashboard } = await getGuardianDashboard(guardianPrincipal);
    const serialized = JSON.stringify(dashboard.resident);

    expect(serialized).not.toContain("asha@example.com");
    expect(serialized).not.toContain("9800000000");
    expect(serialized).not.toContain("5000");
  });

  it("reduces the night status to a date, never a timestamp", async () => {
    setPermissions({ canViewSafety: true });

    const { dashboard } = await getGuardianDashboard(guardianPrincipal);

    expect(dashboard.safety).toEqual({ asOf: "2030-02-01", status: "INSIDE_HOSTEL" });
    expect(JSON.stringify(dashboard.safety)).not.toContain("22:45");
  });

  it("only asks for notices addressed to guardians", async () => {
    setPermissions({ canViewNotices: true });

    await getGuardianDashboard(guardianPrincipal);

    expect(mocks.noticeFind).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAudience: { $in: ["ALL", "GUARDIANS"] },
      }),
    );
  });
});
