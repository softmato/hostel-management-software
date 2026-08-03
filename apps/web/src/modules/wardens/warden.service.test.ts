import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const serviceMocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  memberCreate: vi.fn(),
  memberFind: vi.fn(),
  memberFindOne: vi.fn(),
  memberFindOneAndUpdate: vi.fn(),
  registerOrUpgrade: vi.fn(),
  userFind: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: serviceMocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: {
    create: serviceMocks.auditCreate,
  },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: {
    countDocuments: vi.fn().mockResolvedValue(0),
    create: serviceMocks.memberCreate,
    find: serviceMocks.memberFind,
    findOne: serviceMocks.memberFindOne,
    findOneAndUpdate: serviceMocks.memberFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    find: serviceMocks.userFind,
    findById: serviceMocks.userFindById,
  },
}));

vi.mock("@/modules/users/user.service", () => ({
  registerOrUpgradeUserByEmail: serviceMocks.registerOrUpgrade,
}));

import {
  createHostelWarden,
  deactivateHostelWarden,
  listHostelWardens,
} from "@/modules/wardens/warden.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0f4";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0f5";
const userId = "64f0f0f0f0f0f0f0f0f0f0f6";
const memberId = "64f0f0f0f0f0f0f0f0f0f0f7";

const adminPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  userId: "64f0f0f0f0f0f0f0f0f0f0f8",
};

function chain<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function memberRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(memberId),
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
    hostelId: new Types.ObjectId(hostelId),
    permissions: ["registerResidents"],
    role: Role.WARDEN,
    status: "ACTIVE",
    userId: new Types.ObjectId(userId),
    ...overrides,
  };
}

const userRecord = {
  _id: new Types.ObjectId(userId),
  email: "warden@hostel.test",
  name: "Warden One",
  phone: "9800000001",
};

describe("warden service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a warden account scoped to the admin's hostel and returns temp credentials", async () => {
    serviceMocks.registerOrUpgrade.mockResolvedValueOnce({
      created: true,
      temporaryPassword: "temp-pass-123",
      upgraded: false,
      user: { email: "warden@hostel.test", id: userId, role: Role.WARDEN },
    });
    serviceMocks.memberFindOne.mockReturnValueOnce(chain(null));
    serviceMocks.memberCreate.mockResolvedValueOnce({
      toObject: () => memberRecord(),
    });
    serviceMocks.userFindById.mockReturnValueOnce(chain(userRecord));

    const result = await createHostelWarden(
      { email: "warden@hostel.test", name: "Warden One" },
      adminPrincipal,
    );

    expect(serviceMocks.registerOrUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({
        hostelId,
        performedBy: adminPrincipal.userId,
        role: Role.WARDEN,
      }),
    );
    expect(result.accountCreated).toBe(true);
    expect(result.temporaryPassword).toBe("temp-pass-123");
    expect(result.warden).toMatchObject({ id: memberId, status: "ACTIVE" });
  });

  it("rejects creating a warden for a hostel the admin does not own", async () => {
    await expect(
      createHostelWarden(
        { email: "warden@hostel.test", hostelId: otherHostelId, name: "Warden One" },
        adminPrincipal,
      ),
    ).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
      status: 404,
    });

    expect(serviceMocks.registerOrUpgrade).not.toHaveBeenCalled();
    expect(serviceMocks.memberCreate).not.toHaveBeenCalled();
  });

  it("lists only WARDEN members within the principal's hostels", async () => {
    serviceMocks.memberFind.mockReturnValueOnce(chain([]));

    await listHostelWardens({}, adminPrincipal);

    expect(serviceMocks.memberFind).toHaveBeenCalledWith({
      hostelId: { $in: [new Types.ObjectId(hostelId)] },
      isDeleted: false,
      role: Role.WARDEN,
    });
  });

  it("deactivates a warden by suspending the membership", async () => {
    serviceMocks.memberFindOne.mockReturnValueOnce(chain(memberRecord()));
    serviceMocks.memberFindOneAndUpdate.mockReturnValueOnce(
      chain(memberRecord({ status: "SUSPENDED" })),
    );
    serviceMocks.userFindById.mockReturnValueOnce(chain(userRecord));

    const result = await deactivateHostelWarden(memberId, adminPrincipal);

    expect(serviceMocks.memberFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: new Types.ObjectId(memberId), isDeleted: false }),
      { $set: { status: "SUSPENDED", updatedBy: adminPrincipal.userId } },
      { new: true },
    );
    expect(result.warden.status).toBe("SUSPENDED");
  });
});
