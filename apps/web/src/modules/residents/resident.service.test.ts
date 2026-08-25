import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  getIntakeQuote: vi.fn(),
  raiseAdmissionInvoice: vi.fn(),
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

vi.mock("@/modules/residents/resident-intake.service", () => ({
  getIntakeQuote: serviceMocks.getIntakeQuote,
  raiseAdmissionInvoice: serviceMocks.raiseAdmissionInvoice,
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

/** A hostel that levies no admission fee and prices this room type. */
function quote(overrides: Record<string, unknown> = {}) {
  return {
    admissionFee: 0,
    admissionPayable: 0,
    bedType: "FOUR_SHARING",
    currency: "NPR",
    depositAmount: 0,
    feeScheduleId: null,
    monthlyRent: 6000,
    referral: { applied: false, code: null, discount: 0, reason: null },
    rentBasis: "SCHEDULE",
    roomType,
    ...overrides,
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
    serviceMocks.getIntakeQuote.mockResolvedValue(quote());
    serviceMocks.raiseAdmissionInvoice.mockResolvedValue({
      raised: false,
      reason: "NO_ADMISSION_FEE",
    });
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
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
      status: 404,
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

  /**
   * The defect, reported from the field: an intake hit the phone conflict above,
   * the admin changed the number and pressed save again, and the same person was
   * taken onto the roll twice on one mailbox. Nothing downstream survives that —
   * `linkResidentAccount` refuses the second profile with
   * `ACCOUNT_ALREADY_LINKED`, so the duplicate can never be given a login and
   * shows as a resident who cannot sign in.
   */
  it("rejects a second resident on an email already registered at the hostel", async () => {
    serviceMocks.residentFindOne.mockReturnValueOnce(
      queryResult(residentRecord({ email: "asha@example.com", phone: "9811111111" })),
    );

    await expect(
      createResident(
        {
          depositAmount: 5000,
          email: "Asha@Example.com",
          firstName: "Asha",
          lastName: "Rai",
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "RESIDENT_EMAIL_TAKEN", status: 409 });
    expect(serviceMocks.claimBedForRoomType).not.toHaveBeenCalled();
    expect(serviceMocks.residentCreate).not.toHaveBeenCalled();
  });

  it("looks the email up lower-cased, the way it is stored", async () => {
    // `Resident.email` carries `lowercase: true`. A query built from raw form
    // input would miss `Asha@Gmail.com` against the `asha@gmail.com` on the roll
    // and let the duplicate straight through.
    serviceMocks.residentCreate.mockResolvedValueOnce(residentRecord());

    await createResident(
      {
        depositAmount: 5000,
        email: "  Asha@Example.COM ",
        firstName: "Asha",
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        residentType: "STUDENT" as const,
        roomType,
        status: "PENDING",
      },
      staffPrincipal,
    );

    expect(serviceMocks.residentFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [{ phone: "9800000000" }, { email: "asha@example.com" }],
      }),
    );
  });

  it("asks for the phone and the email in one query", async () => {
    // Intake is the slowest path in the portal — the admin who reported this
    // said so before they said anything about duplicates. A second round trip
    // for the second field would be paid on every registration.
    serviceMocks.residentCreate.mockResolvedValueOnce(residentRecord());

    await createResident(
      {
        depositAmount: 5000,
        email: "asha@example.com",
        firstName: "Asha",
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        residentType: "STUDENT" as const,
        roomType,
        status: "PENDING",
      },
      staffPrincipal,
    );

    expect(serviceMocks.residentFindOne).toHaveBeenCalledTimes(1);
  });

  it("does not collide two residents who simply have no email", async () => {
    // The common case: a hostel that registers by phone alone. `$or` must not
    // appear at all, or every second resident matches the first on a missing
    // field.
    serviceMocks.residentCreate.mockResolvedValueOnce(residentRecord());

    await createResident(
      {
        depositAmount: 5000,
        firstName: "Asha",
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        residentType: "STUDENT" as const,
        roomType,
        status: "PENDING",
      },
      staffPrincipal,
    );

    expect(serviceMocks.residentFindOne).toHaveBeenCalledWith(
      expect.not.objectContaining({ $or: expect.anything() }),
    );
  });

  it("names the field the unique index actually rejected", async () => {
    // Two intakes racing land on the index, not on the check above. Mapping
    // every E11000 to the phone would tell an admin to change a number that was
    // never the problem.
    serviceMocks.residentCreate.mockRejectedValueOnce(
      Object.assign(new Error("E11000"), {
        code: 11000,
        keyPattern: { email: 1, hostelId: 1 },
      }),
    );

    await expect(
      createResident(
        {
          depositAmount: 5000,
          email: "asha@example.com",
          firstName: "Asha",
          lastName: "Rai",
          moveInDate: new Date("2030-01-01T00:00:00.000Z"),
          phone: "9800000000",
          residentType: "STUDENT" as const,
          roomType,
          status: "PENDING",
        },
        staffPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "RESIDENT_EMAIL_TAKEN", status: 409 });
    expect(serviceMocks.releaseBedForRoomType).toHaveBeenCalled();
  });

  it("hands the bed back when creating the resident fails", async () => {
    serviceMocks.residentCreate.mockRejectedValueOnce(new Error("duplicate phone"));

    await expect(
      createResident(
        {
          depositAmount: 5000,
          firstName: "Asha",
          lastName: "Rai",
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
