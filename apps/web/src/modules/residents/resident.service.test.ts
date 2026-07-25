import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  bedCountDocuments: vi.fn(),
  bedFindOne: vi.fn(),
  bedFindOneAndUpdate: vi.fn(),
  connectToDatabase: vi.fn(),
  emergencyContactCreate: vi.fn(),
  guardianCreate: vi.fn(),
  residentCreate: vi.fn(),
  residentFind: vi.fn(),
  residentFindOne: vi.fn(),
  residentFindOneAndUpdate: vi.fn(),
  roomFindOne: vi.fn(),
  roomUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: {
    create: serviceMocks.auditCreate,
  },
}));

vi.mock("@hostel/db/models/Bed", () => ({
  BedModel: {
    countDocuments: serviceMocks.bedCountDocuments,
    findOne: serviceMocks.bedFindOne,
    findOneAndUpdate: serviceMocks.bedFindOneAndUpdate,
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

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    create: serviceMocks.residentCreate,
    find: serviceMocks.residentFind,
    findOne: serviceMocks.residentFindOne,
    findOneAndUpdate: serviceMocks.residentFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/Room", () => ({
  RoomModel: {
    findOne: serviceMocks.roomFindOne,
    updateOne: serviceMocks.roomUpdateOne,
  },
}));

import { createResident, listResidents } from "@/modules/residents/resident.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0f4";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0f5";
const roomId = "64f0f0f0f0f0f0f0f0f0f0f6";
const bedId = "64f0f0f0f0f0f0f0f0f0f0f7";
const residentId = "64f0f0f0f0f0f0f0f0f0f0f8";

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0f9",
};

function leanResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function roomRecord() {
  return {
    _id: new Types.ObjectId(roomId),
    capacity: 4,
    hostelId: new Types.ObjectId(hostelId),
  };
}

function bedRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(bedId),
    hostelId: new Types.ObjectId(hostelId),
    roomId: new Types.ObjectId(roomId),
    status: "AVAILABLE",
    ...overrides,
  };
}

function residentRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(residentId),
    bedId: new Types.ObjectId(bedId),
    depositAmount: 5000,
    firstName: "Asha",
    hostelId: new Types.ObjectId(hostelId),
    lastName: "Rai",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomId: new Types.ObjectId(roomId),
    status: "PENDING",
    ...overrides,
  };
}

describe("resident management service behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          bedId,
          depositAmount: 5000,
          firstName: "Asha",
          hostelId: otherHostelId,
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomId,
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

  it("rejects resident creation when the selected bed is not available", async () => {
    serviceMocks.roomFindOne.mockReturnValueOnce(leanResult(roomRecord()));
    serviceMocks.bedFindOne.mockReturnValueOnce(
      leanResult(
        bedRecord({
          assignedResidentId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0fa"),
          status: "OCCUPIED",
        }),
      ),
    );

    await expect(
      createResident(
        {
          bedId,
          depositAmount: 5000,
          firstName: "Asha",
          lastName: "Rai",
          monthlyFee: 0,
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomId,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({
      errorCode: "BED_NOT_AVAILABLE",
      status: 409,
    });
    expect(serviceMocks.residentCreate).not.toHaveBeenCalled();
  });

  it("creates residents and occupies the selected bed", async () => {
    serviceMocks.roomFindOne.mockReturnValueOnce(leanResult(roomRecord()));
    serviceMocks.bedFindOne.mockReturnValueOnce(leanResult(bedRecord()));
    serviceMocks.residentCreate.mockResolvedValueOnce(residentRecord());
    serviceMocks.bedCountDocuments.mockResolvedValueOnce(1);

    const result = await createResident(
      {
        bedId,
        depositAmount: 5000,
        firstName: "Asha",
        lastName: "Rai",
        monthlyFee: 0,
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        residentType: "STUDENT" as const,
        roomId,
        status: "PENDING",
      },
      staffPrincipal,
    );

    expect(result.resident).toMatchObject({
      bedId,
      firstName: "Asha",
      hostelId,
      roomId,
      status: "PENDING",
    });
    expect(serviceMocks.residentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        bedId: new Types.ObjectId(bedId),
        createdBy: staffPrincipal.userId,
        hostelId: new Types.ObjectId(hostelId),
        roomId: new Types.ObjectId(roomId),
      }),
    );
    expect(serviceMocks.bedFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(bedId), isDeleted: false },
      expect.objectContaining({
        $set: expect.objectContaining({
          assignedResidentId: new Types.ObjectId(residentId),
          status: "OCCUPIED",
        }),
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
