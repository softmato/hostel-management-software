import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * The three ways somebody leaves the field team, and the two that are not
 * allowed to lose anything.
 *
 * The delete guards get the most attention here because they are the only place
 * in this flow where a wrong answer is unrecoverable — a removal can be undone
 * by sending another invitation, and a suspension by lifting it, but a deleted
 * account that a subscription still points at cannot be brought back.
 */

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  inviteDeleteMany: vi.fn(),
  inviteUpdateMany: vi.fn(),
  oauthDeleteMany: vi.fn(),
  paymentCount: vi.fn(),
  sessionDeleteMany: vi.fn(),
  subscriptionCount: vi.fn(),
  userDeleteOne: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    deleteOne: mocks.userDeleteOne,
    findOne: mocks.userFindOne,
    updateOne: mocks.userUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Session", () => ({
  SessionModel: { deleteMany: mocks.sessionDeleteMany },
}));

vi.mock("@hostel/db/models/OAuthAccount", () => ({
  OAuthAccountModel: { deleteMany: mocks.oauthDeleteMany },
}));

vi.mock("@hostel/db/models/PlatformAdminInvite", () => ({
  PlatformAdminInviteModel: {
    deleteMany: mocks.inviteDeleteMany,
    updateMany: mocks.inviteUpdateMany,
  },
}));

vi.mock("@hostel/db/models/HostelSubscription", () => ({
  HostelSubscriptionModel: { countDocuments: mocks.subscriptionCount },
}));

vi.mock("@hostel/db/models/SubscriptionPayment", () => ({
  SubscriptionPaymentModel: { countDocuments: mocks.paymentCount },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

import {
  deleteTeamMember,
  reinstateTeamMember,
  removeTeamMember,
  suspendTeamMember,
} from "@/modules/team/team-member.service";

const memberId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0ee01");
const superadminId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0ee02");

const principal = {
  hostelIds: [],
  role: Role.SUPERADMIN,
  userId: superadminId.toString(),
};

function member(overrides: Record<string, unknown> = {}) {
  return {
    lean: vi.fn().mockResolvedValue({
      _id: memberId,
      email: "agent@example.test",
      name: "Kiran Rai",
      role: Role.PLATFORM_AGENT,
      status: "ACTIVE",
      ...overrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindOne.mockReturnValue(member());
  mocks.userUpdateOne.mockResolvedValue({});
  mocks.userDeleteOne.mockResolvedValue({});
  mocks.sessionDeleteMany.mockResolvedValue({});
  mocks.oauthDeleteMany.mockResolvedValue({});
  mocks.inviteDeleteMany.mockResolvedValue({});
  mocks.inviteUpdateMany.mockResolvedValue({});
  mocks.subscriptionCount.mockResolvedValue(0);
  mocks.paymentCount.mockResolvedValue(0);
  mocks.auditCreate.mockResolvedValue({});
});

describe("suspending a team member", () => {
  it("ends every live session rather than waiting for the token to expire", async () => {
    await suspendTeamMember(memberId.toString(), principal);

    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: memberId },
      { $set: { status: "SUSPENDED" } },
    );
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: memberId },
      { $inc: { tokenVersion: 1 } },
    );
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({ userId: memberId });
  });

  it("refuses to suspend the superadmin doing the suspending", async () => {
    await expect(
      suspendTeamMember(superadminId.toString(), principal),
    ).rejects.toMatchObject({ errorCode: "CANNOT_SUSPEND_SELF", status: 409 });
  });

  it("reinstates to ACTIVE, not back to INVITED", async () => {
    mocks.userFindOne.mockReturnValue(member({ status: "SUSPENDED" }));

    const result = await reinstateTeamMember(memberId.toString(), principal);

    expect(result.reinstated).toBe(true);
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: memberId },
      { $set: { status: "ACTIVE" } },
    );
  });
});

describe("removing a team member", () => {
  it("hands the account back the role the invitation took it off", async () => {
    mocks.userFindOne.mockReturnValue(member({ previousRole: Role.WARDEN }));

    const result = await removeTeamMember(memberId.toString(), principal);

    expect(result.restoredRole).toBe(Role.WARDEN);
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: memberId },
      { $set: { role: Role.WARDEN }, $unset: { previousRole: "" } },
    );
  });

  it("drops to PUBLIC when the team was the only thing the account ever was", async () => {
    const result = await removeTeamMember(memberId.toString(), principal);

    expect(result.restoredRole).toBe(Role.PUBLIC);
  });

  it("withdraws any invitation still outstanding for the address", async () => {
    await removeTeamMember(memberId.toString(), principal);

    expect(mocks.inviteUpdateMany).toHaveBeenCalledWith(
      { email: "agent@example.test", status: "PENDING" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "REVOKED" }),
        $unset: { tokenHash: "" },
      }),
    );
  });

  it("keeps the account, so the money it collected still names somebody", async () => {
    await removeTeamMember(memberId.toString(), principal);

    expect(mocks.userDeleteOne).not.toHaveBeenCalled();
  });
});

describe("deleting a team member outright", () => {
  it("refuses while a registration points at the account", async () => {
    mocks.subscriptionCount.mockResolvedValue(3);

    await expect(deleteTeamMember(memberId.toString(), principal)).rejects.toMatchObject({
      errorCode: "MEMBER_HAS_HISTORY",
      status: 409,
    });
    expect(mocks.userDeleteOne).not.toHaveBeenCalled();
  });

  it("refuses on a collected payment even when no hostel was registered", async () => {
    mocks.paymentCount.mockResolvedValue(1);

    await expect(deleteTeamMember(memberId.toString(), principal)).rejects.toMatchObject({
      errorCode: "MEMBER_HAS_HISTORY",
    });
  });

  it("refuses when the address had an account before it joined the team", async () => {
    mocks.userFindOne.mockReturnValue(member({ previousRole: Role.RESIDENT }));

    await expect(deleteTeamMember(memberId.toString(), principal)).rejects.toMatchObject({
      errorCode: "MEMBER_HAS_PRIOR_ACCOUNT",
    });
    expect(mocks.userDeleteOne).not.toHaveBeenCalled();
  });

  it("really deletes when nothing points at the account, so the address frees up", async () => {
    const result = await deleteTeamMember(memberId.toString(), principal);

    expect(result.deleted).toBe(true);
    expect(mocks.userDeleteOne).toHaveBeenCalledWith({ _id: memberId });
    expect(mocks.oauthDeleteMany).toHaveBeenCalledWith({ userId: memberId });
    expect(mocks.inviteDeleteMany).toHaveBeenCalledWith({
      email: "agent@example.test",
    });
  });

  it("still writes the audit entry, pointing at an id that no longer resolves", async () => {
    await deleteTeamMember(memberId.toString(), principal);

    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TEAM_MEMBER_DELETED",
        entityId: memberId.toString(),
      }),
    );
  });
});

describe("the roster scope", () => {
  it("only ever finds PLATFORM_AGENT rows, so a peer superadmin is out of reach", async () => {
    await suspendTeamMember(memberId.toString(), principal);

    expect(mocks.userFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.PLATFORM_AGENT }),
    );
  });

  it("answers 422 rather than throwing on an id that is not an ObjectId", async () => {
    await expect(removeTeamMember("not-an-id", principal)).rejects.toMatchObject({
      errorCode: "INVALID_OBJECT_ID",
      status: 422,
    });
  });
});
