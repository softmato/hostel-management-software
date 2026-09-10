import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * The restriction that used to sit on every invitation, and what replaced it.
 *
 * An address belonging to a resident, a warden, a cook or the public account
 * behind a service provider is now invitable, and accepting moves that account
 * onto the field team. The whole defence of that is reversibility, so the tests
 * that matter most here are the two halves of the same fact: the old role is
 * written down on the way in, and nothing about the account is destroyed.
 */

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  cookFindOne: vi.fn(),
  guardianFindOne: vi.fn(),
  inviteCreate: vi.fn(),
  inviteFindOne: vi.fn(),
  inviteUpdateMany: vi.fn(),
  inviteUpdateOne: vi.fn(),
  sendEmail: vi.fn(),
  userCreate: vi.fn(),
  userFindById: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    create: mocks.userCreate,
    findById: mocks.userFindById,
    findOne: mocks.userFindOne,
  },
}));

vi.mock("@hostel/db/models/PlatformAdminInvite", () => ({
  PlatformAdminInviteModel: {
    create: mocks.inviteCreate,
    find: vi.fn(),
    findOne: mocks.inviteFindOne,
    updateMany: mocks.inviteUpdateMany,
    updateOne: mocks.inviteUpdateOne,
  },
}));

vi.mock("@hostel/db/models/CookAccount", () => ({
  CookAccountModel: { findOne: mocks.cookFindOne },
}));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: { findOne: mocks.guardianFindOne },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

vi.mock("@hostel/shared/email/templates/platform/admin-invitation", () => ({
  platformAdminInvitationEmail: () => ({
    category: "platform",
    html: "<p>join</p>",
    subject: "Join the team",
  }),
}));

import {
  acceptPlatformAdminInvitation,
  checkPlatformAdminEmail,
  invitePlatformAdmin,
} from "@/modules/users/platform-admin-invite.service";

const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0ff01");
const inviteId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0ff02");
const superadminId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0ff03");

const principal = {
  hostelIds: [],
  role: Role.SUPERADMIN,
  userId: superadminId.toString(),
};

function lean<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function existingUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: userId,
    email: "warden@example.test",
    name: "Sita Gurung",
    phone: "",
    previousRole: undefined,
    role: Role.WARDEN,
    save: vi.fn().mockResolvedValue({}),
    status: "ACTIVE",
    tokenVersion: 4,
    ...overrides,
  };
}

function liveInvite(overrides: Record<string, unknown> = {}) {
  return {
    _id: inviteId,
    email: "warden@example.test",
    expiresAt: new Date(Date.now() + 60_000),
    invitedBy: superadminId,
    name: "Sita Gurung",
    role: Role.PLATFORM_AGENT,
    status: "PENDING",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindOne.mockReturnValue(lean(null));
  mocks.userFindById.mockReturnValue(lean({ name: "Platform Owner" }));
  mocks.cookFindOne.mockReturnValue(lean(null));
  mocks.guardianFindOne.mockReturnValue(lean(null));
  mocks.inviteFindOne.mockReturnValue(lean(null));
  mocks.inviteCreate.mockResolvedValue({
    _id: inviteId,
    email: "warden@example.test",
    expiresAt: new Date(Date.now() + 60_000),
    role: Role.PLATFORM_AGENT,
    status: "PENDING",
  });
  mocks.inviteUpdateMany.mockResolvedValue({});
  mocks.inviteUpdateOne.mockResolvedValue({});
  mocks.auditCreate.mockResolvedValue({});
  mocks.sendEmail.mockResolvedValue({ sent: true });
  mocks.userCreate.mockResolvedValue({ _id: userId });
});

describe("an address already in use elsewhere", () => {
  it("is sendable when it belongs to a warden, and says what will change", async () => {
    mocks.userFindOne.mockReturnValue(lean(existingUser()));

    const result = await checkPlatformAdminEmail(
      "warden@example.test",
      Role.PLATFORM_AGENT,
    );

    expect(result.sendable).toBe(true);
    expect(result.reason).toBe("OTHER_ROLE");
    expect(result.message).toContain("warden");
  });

  it("is sendable when it belongs to a resident", async () => {
    mocks.userFindOne.mockReturnValue(lean(existingUser({ role: Role.RESIDENT })));

    expect(
      (await checkPlatformAdminEmail("r@example.test", Role.PLATFORM_AGENT)).sendable,
    ).toBe(true);
  });

  it("is sendable when a cook invitation is already outstanding", async () => {
    mocks.cookFindOne.mockReturnValue(lean({ _id: new Types.ObjectId() }));

    const result = await checkPlatformAdminEmail("cook@example.test");

    expect(result.sendable).toBe(true);
    expect(result.reason).toBe("COOK_INVITE_PENDING");
  });

  it("is sendable when the account is suspended, and says it will be reactivated", async () => {
    mocks.userFindOne.mockReturnValue(
      lean(existingUser({ role: Role.PUBLIC, status: "SUSPENDED" })),
    );

    const result = await checkPlatformAdminEmail("back@example.test");

    expect(result.sendable).toBe(true);
    expect(result.message).toContain("reactivates");
  });

  it("still refuses an address that already holds the role being offered", async () => {
    mocks.userFindOne.mockReturnValue(lean(existingUser({ role: Role.PLATFORM_AGENT })));

    const result = await checkPlatformAdminEmail(
      "agent@example.test",
      Role.PLATFORM_AGENT,
    );

    expect(result.sendable).toBe(false);
    expect(result.reason).toBe("ALREADY_HAS_THIS_ROLE");
  });

  it("still refuses a closed account, whose address the unique index holds", async () => {
    mocks.userFindOne.mockReturnValue(
      lean(existingUser({ isDeleted: true, role: Role.PUBLIC })),
    );

    const result = await checkPlatformAdminEmail("gone@example.test");

    expect(result.sendable).toBe(false);
    expect(result.reason).toBe("CLOSED_ACCOUNT");
  });
});

describe("sending twice to the same address", () => {
  it("supersedes the outstanding invitation instead of colliding with it", async () => {
    mocks.inviteFindOne.mockReturnValue(
      lean({ expiresAt: new Date(Date.now() + 60_000), role: Role.PLATFORM_AGENT }),
    );

    await invitePlatformAdmin(
      { email: "again@example.test", role: Role.PLATFORM_AGENT },
      principal,
    );

    expect(mocks.inviteUpdateMany).toHaveBeenCalledWith(
      { email: "again@example.test", status: "PENDING" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "REVOKED" }),
        $unset: { tokenHash: "" },
      }),
    );
    expect(mocks.inviteCreate).toHaveBeenCalled();
  });
});

describe("accepting an invitation on an address that already has a role", () => {
  it("moves that account onto the team and parks the role it came from", async () => {
    const user = existingUser();

    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(user);

    const result = await acceptPlatformAdminInvitation({ token: "raw-token" });

    expect(result.accepted).toBe(true);
    expect(result.displacedRole).toBe(Role.WARDEN);
    expect(user.role).toBe(Role.PLATFORM_AGENT);
    expect(user.previousRole).toBe(Role.WARDEN);
    expect(user.save).toHaveBeenCalled();
  });

  it("ends the sessions still carrying the old role", async () => {
    const user = existingUser();

    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(user);

    await acceptPlatformAdminInvitation({ token: "raw-token" });

    expect(user.tokenVersion).toBe(5);
  });

  it("reactivates a suspended account rather than granting access it cannot use", async () => {
    const user = existingUser({ role: Role.PUBLIC, status: "SUSPENDED" });

    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(user);

    await acceptPlatformAdminInvitation({ token: "raw-token" });

    expect(user.status).toBe("ACTIVE");
  });

  it("leaves an INVITED account alone, because the first sign-in clears that", async () => {
    const user = existingUser({ role: Role.PUBLIC, status: "INVITED" });

    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(user);

    await acceptPlatformAdminInvitation({ token: "raw-token" });

    expect(user.status).toBe("INVITED");
  });

  it("records no displaced role when the account was only ever public", async () => {
    const user = existingUser({ role: Role.PUBLIC });

    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(user);

    const result = await acceptPlatformAdminInvitation({ token: "raw-token" });

    expect(result.displacedRole).toBe(Role.PUBLIC);
    expect(user.previousRole).toBe(Role.PUBLIC);
  });

  it("still refuses an address that already holds a platform grade", async () => {
    mocks.inviteFindOne.mockReturnValue(lean(liveInvite()));
    mocks.userFindOne.mockResolvedValue(existingUser({ role: Role.SUPERADMIN }));

    await expect(
      acceptPlatformAdminInvitation({ token: "raw-token" }),
    ).rejects.toMatchObject({ errorCode: "ALREADY_PLATFORM_ADMIN", status: 409 });
  });
});
