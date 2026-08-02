import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  emergencyContactCreate: vi.fn(),
  guardianCreate: vi.fn(),
  claimBedForRoomType: vi.fn(),
  releaseBedForRoomType: vi.fn(),
  residentCountDocuments: vi.fn(),
  residentCreate: vi.fn(),
  residentFind: vi.fn(),
  residentFindOne: vi.fn(),
  residentFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: {
    create: serviceMocks.auditCreate,
  },
}));

vi.mock("@hostel/db/models/EmergencyContact", () => ({
  EmergencyContactModel: {
    create: serviceMocks.emergencyContactCreate,
  },
}));

vi.mock("@hostel/db/models/Guardian", () => ({
  GuardianModel: {
    create: serviceMocks.guardianCreate,
  },
}));

vi.mock("@/modules/hostels/hostel-capacity.service", () => ({
  claimBedForRoomType: serviceMocks.claimBedForRoomType,
  moveBedBetweenRoomTypes: vi.fn(),
  releaseBedForRoomType: serviceMocks.releaseBedForRoomType,
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    countDocuments: serviceMocks.residentCountDocuments,
    create: serviceMocks.residentCreate,
    find: serviceMocks.residentFind,
    findOne: serviceMocks.residentFindOne,
    findOneAndUpdate: serviceMocks.residentFindOneAndUpdate,
  },
}));

import { createResident, listResidents } from "@/modules/residents/resident.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0f4";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0f5";
const roomType = "Four Sharing";
const residentId = "64f0f0f0f0f0f0f0f0f0f0f8";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0f9",
};

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function residentRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(residentId),
    depositAmount: 5000,
    firstName: "Asha",
    hostelId: new Types.ObjectId(hostelId),
    lastName: "Rai",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomType,
    status: "PENDING",
    ...overrides,
  };
}

describe("resident management service behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Intake starts with a duplicate-phone lookup; no match is the normal case.
    serviceMocks.residentFindOne.mockReturnValue(queryResult(null));
    serviceMocks.residentCountDocuments.mockResolvedValue(0);
  });

  it("limits resident lists to the principal hostel ids", async () => {
    serviceMocks.residentFind.mockReturnValueOnce(queryResult([]));

    await listResidents({}, staffPrincipal);

    expect(serviceMocks.residentFind).toHaveBeenCalledWith({
      hostelId: {
        $in: [new Types.ObjectId(hostelId)],
      },
      isDeleted: false,
    });
  });

  it("rejects resident creation outside the admin tenant", async () => {
    await expect(
      createResident(
        {
          depositAmount: 5000,
          firstName: "Asha",
          hostelId: otherHostelId,
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({
      errorCode: "TENANT_ACCESS_DENIED",
      status: 403,
    });
    expect(serviceMocks.residentCreate).not.toHaveBeenCalled();
  });

  it("refuses to admit a resident into a room type with no vacancy", async () => {
    serviceMocks.claimBedForRoomType.mockRejectedValueOnce(
      Object.assign(new Error("No vacant beds left."), {
        errorCode: "ROOM_TYPE_FULL",
        status: 409,
      }),
    );

    await expect(
      createResident(
        {
          depositAmount: 5000,
          firstName: "Asha",
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "ROOM_TYPE_FULL", status: 409 });
    expect(serviceMocks.residentCreate).not.toHaveBeenCalled();
  });

  it("rejects a second resident on a phone already registered at the hostel", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(queryResult(residentRecord()));

    await expect(
      createResident(
        {
          depositAmount: 5000,
          firstName: "Asha",
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "RESIDENT_PHONE_TAKEN", status: 409 });
    // The bed must never be claimed for a registration that cannot proceed.
    expect(serviceMocks.claimBedForRoomType).not.toHaveBeenCalled();
    expect(serviceMocks.residentCreate).not.toHaveBeenCalled();
  });

  it("hands the bed back when creating the resident fails", async () => {
    serviceMocks.residentCreate.mockRejectedValueOnce(new Error("duplicate phone"));

    await expect(
      createResident(
        {
          depositAmount: 5000,
          firstName: "Asha",
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toThrow("duplicate phone");
    expect(serviceMocks.releaseBedForRoomType).toHaveBeenCalledWith(
      new Types.ObjectId(hostelId),
      roomType,
    );
  });

  it("creates residents and claims a bed of their room type", async () => {
    serviceMocks.residentCreate.mockResolvedValueOnce(residentRecord());

    const result = await createResident(
      {
        depositAmount: 5000,
        firstName: "Asha",
        lastName: "Rai",
        monthlyFee: 0,
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        residentType: "STUDENT" as const,
        roomType,
        status: "PENDING",
      },
      staffPrincipal,
    );

    expect(result.resident).toMatchObject({
      firstName: "Asha",
      hostelId,
      roomType,
      status: "PENDING",
    });
    expect(serviceMocks.claimBedForRoomType).toHaveBeenCalledWith(
      new Types.ObjectId(hostelId),
      roomType,
    );
    expect(serviceMocks.residentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: staffPrincipal.userId,
        hostelId: new Types.ObjectId(hostelId),
        roomType,
      }),
    );
    expect(serviceMocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RESIDENT_CREATED",
        entityId: residentId,
        entityType: "Resident",
        hostelId: new Types.ObjectId(hostelId),
      }),
    );
  });
});
