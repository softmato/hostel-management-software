import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * Residency has no blocker.
 *
 * Every case here is one a hostel walks into: somebody with a warden invitation
 * they never opened, somebody who is already a resident somewhere, and the one
 * account an intake form is still not allowed to touch. What connects them is
 * that the person is standing at the desk with their luggage — the product's job
 * is to give them a portal, not to explain that a stale row outranks them.
 */

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFind: vi.fn(),
  memberFind: vi.fn(),
  memberUpdateMany: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: mocks.userFindOne, updateOne: mocks.userUpdateOne },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.memberFind, updateMany: mocks.memberUpdateMany },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { find: mocks.hostelFind },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

import { promoteAccountToResident } from "@/modules/users/resident-promotion.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");
const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f2");
const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0fa");
const memberId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0fb");

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    _id: userId,
    email: "asha@example.com",
    hostelIds: [],
    role: Role.PUBLIC,
    status: "ACTIVE",
    ...overrides,
  };
}

/** The `$set` of the single write this service makes against the user. */
function userSet() {
  return mocks.userUpdateOne.mock.calls[0]?.[1]?.$set ?? {};
}

describe("promoteAccountToResident", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberFind.mockReturnValue(lean([]));
    mocks.hostelFind.mockReturnValue(lean([]));
    mocks.userUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.memberUpdateMany.mockResolvedValue({ acknowledged: true });
  });

  it("promotes a public account and clears nothing", async () => {
    mocks.userFindOne.mockReturnValue(lean(account()));

    const result = await promoteAccountToResident({ hostelId, userId });

    expect(userSet()).toMatchObject({ role: Role.RESIDENT });
    expect(result.cleared).toEqual({
      activatedInvite: false,
      clearedMemberships: [],
      clearedRole: null,
    });
  });

  /*
   * The registration that reported this bug. An `INVITED` warden row on the
   * resident's own mailbox made `registerOrUpgradeUserByEmail` refuse with
   * `EMAIL_ALREADY_HAS_ROLE`, so the resident was registered, invoiced and
   * emailed a welcome, and then had no portal to sign in to.
   */
  it("promotes an unaccepted warden invitation instead of refusing it", async () => {
    mocks.userFindOne.mockReturnValue(
      lean(account({ role: Role.WARDEN, status: "INVITED" })),
    );

    const result = await promoteAccountToResident({ hostelId, userId });

    expect(userSet()).toMatchObject({
      mustChangePassword: false,
      role: Role.RESIDENT,
      status: "ACTIVE",
    });
    expect(result.cleared).toMatchObject({
      activatedInvite: true,
      clearedRole: Role.WARDEN,
    });
  });

  it("stands down every staff membership and names the hostels", async () => {
    mocks.userFindOne.mockReturnValue(lean(account({ role: Role.WARDEN })));
    mocks.memberFind.mockReturnValue(
      lean([{ _id: memberId, hostelId: otherHostelId, role: Role.WARDEN }]),
    );
    mocks.hostelFind.mockReturnValue(
      lean([{ _id: otherHostelId, name: "Green View Hostel" }]),
    );

    const result = await promoteAccountToResident({ hostelId, userId });

    expect(mocks.memberUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: [memberId] } },
      { $set: { isDeleted: true, status: "REMOVED" } },
    );
    // Named, because this list is what the resident is emailed — "a hostel"
    // would not tell them which access they had just lost.
    expect(result.cleared.clearedMemberships).toEqual([
      { hostelName: "Green View Hostel", role: Role.WARDEN },
    ]);
  });

  it("leaves a resident membership alone", async () => {
    // Stood down, this would remove the person from the very hostel that is
    // admitting them.
    mocks.userFindOne.mockReturnValue(lean(account()));
    mocks.memberFind.mockReturnValue(
      lean([{ _id: memberId, hostelId, role: Role.RESIDENT }]),
    );

    const result = await promoteAccountToResident({ hostelId, userId });

    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
    expect(result.cleared.clearedMemberships).toEqual([]);
  });

  it("adds the hostel without disturbing one already on the account", async () => {
    mocks.userFindOne.mockReturnValue(lean(account({ hostelIds: [hostelId] })));

    await promoteAccountToResident({ hostelId, userId });

    expect(mocks.userUpdateOne.mock.calls[0]?.[1]).not.toHaveProperty("$addToSet");
  });

  it("refuses to demote an administrator from an intake form", async () => {
    /*
     * The one blocker that stays. A hostel admin who could register the platform
     * owner's address as a resident could strip that owner's access from a
     * screen meant for admitting students; the resident gets a separate login
     * through QR activation instead.
     */
    mocks.userFindOne.mockReturnValue(lean(account({ role: Role.HOSTEL_ADMIN })));

    await expect(promoteAccountToResident({ hostelId, userId })).rejects.toMatchObject({
      errorCode: "ROLE_TOO_PRIVILEGED",
    });
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses an account that no longer exists", async () => {
    mocks.userFindOne.mockReturnValue(lean(null));

    await expect(promoteAccountToResident({ hostelId, userId })).rejects.toMatchObject({
      errorCode: "USER_NOT_FOUND",
    });
  });

  it("still promotes when the memberships could not be written", async () => {
    // The role is already changed by the time this runs. A membership sweep that
    // failed is a log line, not an intake that reports failure.
    mocks.userFindOne.mockReturnValue(lean(account({ role: Role.WARDEN })));
    mocks.memberFind.mockImplementation(() => {
      throw new Error("mongo is having a day");
    });

    const result = await promoteAccountToResident({ hostelId, userId });

    expect(result.user.role).toBe(Role.RESIDENT);
    expect(result.cleared.clearedMemberships).toEqual([]);
  });

  it("writes an audit row naming what it cleared", async () => {
    mocks.userFindOne.mockReturnValue(
      lean(account({ role: Role.WARDEN, status: "INVITED" })),
    );

    await promoteAccountToResident({ hostelId, performedBy: "actor-1", userId });

    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          clearedRole: Role.WARDEN,
          previousRole: Role.WARDEN,
          reactivatedInvite: true,
          role: Role.RESIDENT,
        }),
      }),
    );
  });
});
