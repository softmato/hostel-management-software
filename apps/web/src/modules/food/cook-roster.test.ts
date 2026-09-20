import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";
import { cookLoginStem, mintCookLogin, previousCookLabel } from "@/modules/food/cook-identity";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  cookCount: vi.fn(),
  cookCreate: vi.fn(),
  cookFind: vi.fn(),
  cookFindOne: vi.fn(),
  cookFindOneAndUpdate: vi.fn(),
  cookUpdateOne: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  registerOrUpgrade: vi.fn(),
  sendEmail: vi.fn(),
  sessionUpdateMany: vi.fn(),
  settingsFindOne: vi.fn(),
  settingsUpdateOne: vi.fn(),
  userCreate: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/CookAccount", () => ({
  CookAccountModel: {
    countDocuments: mocks.cookCount,
    create: mocks.cookCreate,
    find: mocks.cookFind,
    findOne: mocks.cookFindOne,
    findOneAndUpdate: mocks.cookFindOneAndUpdate,
    updateOne: mocks.cookUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.hostelMemberFind },
}));

vi.mock("@hostel/db/models/HostelSettings", () => ({
  HostelSettingsModel: {
    findOne: mocks.settingsFindOne,
    findOneAndUpdate: vi.fn(),
    updateOne: mocks.settingsUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Session", () => ({
  SessionModel: { updateMany: mocks.sessionUpdateMany },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    create: mocks.userCreate,
    find: mocks.userFind,
    findOne: mocks.userFindOne,
    updateOne: mocks.userUpdateOne,
  },
}));

vi.mock("@/modules/users/user.service", () => ({
  registerOrUpgradeUserByEmail: mocks.registerOrUpgrade,
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import {
  acceptCookInvitation,
  addCookAccount,
  removeCookAccount,
  resolveCookLabels,
  updateCookAccount,
} from "@/modules/food/cook-roster.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const cookUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const cookRowId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0e1");

const admin = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

/**
 * Wires `CookAccountModel.findOne` for a whole call: the first lookup is
 * `findHostelCook` fetching the row being acted on, every later one is
 * `syncPrimaryCook` asking who the hostel's primary cook is now.
 */
function cookLookup(row: unknown, primary: unknown = null) {
  mocks.cookFindOne
    .mockReturnValueOnce(queryResult(row))
    .mockReturnValue(queryResult(primary));
}

/** A live roster row, as `findHostelCook` would load it. */
function cookRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: cookRowId,
    hostelId: new Types.ObjectId(hostelId),
    kind: "CREDENTIAL",
    loginEmail: "sunr@cook.local",
    name: "Gita",
    status: "ACTIVE",
    userId: cookUserId,
    ...overrides,
  };
}

describe("cook login identity", () => {
  it("keeps the whole address short enough to type on a kitchen phone", async () => {
    const email = await mintCookLogin("sunrise-boys-hostel-kathmandu", async () => false);

    // The address this replaced was `cook@sunrise-boys-hostel-kathmandu.hostelpalika.local`.
    expect(email).toBe("sunr@cook.local");
    expect(email.length).toBeLessThan(20);
  });

  it("adds a suffix rather than reusing an address that is already taken", async () => {
    const taken = new Set(["sunr@cook.local"]);
    const email = await mintCookLogin("Sunrise Hostel", async (candidate) =>
      taken.has(candidate),
    );

    expect(email).not.toBe("sunr@cook.local");
    expect(email).toMatch(/^sunr[a-z0-9]{2}@cook\.local$/);
  });

  it("falls back to a stem when the hostel name has no latin letters", () => {
    expect(cookLoginStem("सूर्योदय")).toBe("ck");
  });

  it("labels a departed cook by the hostel's first word only", () => {
    expect(previousCookLabel("Sunrise Boys Hostel Pvt. Ltd.")).toBe(
      "Previous Sunrise cook",
    );
  });
});

describe("adding a cook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", slug: "sunrise-hostel" }),
    );
    mocks.settingsFindOne.mockReturnValue(queryResult(null));
    mocks.cookFindOne.mockReturnValue(queryResult(null));
    mocks.cookFind.mockReturnValue(queryResult([]));
    mocks.cookCount.mockResolvedValue(0);
    mocks.cookCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...input, _id: cookRowId }),
    );
    mocks.userCreate.mockResolvedValue({ _id: cookUserId });
    mocks.userFindOne.mockReturnValue(queryResult(null));
    mocks.userFind.mockReturnValue(leanResult([]));
    mocks.hostelMemberFind.mockReturnValue(leanResult([]));
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("mints a short login and hands the password back exactly once", async () => {
    const result = await addCookAccount(
      { kind: "CREDENTIAL", name: "Gita Sharma" },
      admin,
    );

    expect(result.credentials?.email).toMatch(/@cook\.local$/);
    expect(result.credentials?.temporaryPassword).toHaveLength(8);
    expect(mocks.userCreate.mock.calls[0][0].role).toBe(Role.COOK);
    // The row carries the login; the password exists only in the response and
    // in the bcrypt hash on the account.
    expect(JSON.stringify(result.cook)).not.toContain(
      result.credentials!.temporaryPassword,
    );
  });

  it("sends an invitation instead of a password when given an email", async () => {
    const result = await addCookAccount(
      { email: "Ram@Example.com", kind: "INVITE", name: "Ram Bahadur" },
      admin,
    );

    expect(result).not.toHaveProperty("credentials");
    expect(mocks.userCreate).not.toHaveBeenCalled();

    const row = mocks.cookCreate.mock.calls[0][0];
    expect(row.kind).toBe("INVITE");
    expect(row.status).toBe("INVITED");
    expect(row.loginEmail).toBe("ram@example.com");
    // The token is the whole authorisation, so it never leaves the database.
    expect(row.invitationToken).toBeTruthy();
    expect(JSON.stringify(result.cook)).not.toContain(row.invitationToken);
    expect(result.cook.invitationPending).toBe(true);
  });

  it("refuses a second invitation to an address that is already a cook here", async () => {
    mocks.cookFindOne.mockReturnValue(queryResult({ _id: cookRowId }));

    await expect(
      addCookAccount({ email: "ram@example.com", kind: "INVITE", name: "Ram" }, admin),
    ).rejects.toMatchObject({ errorCode: "COOK_ALREADY_INVITED", status: 409 });
  });

  it("caps how many live cooks a hostel can hold", async () => {
    mocks.cookCount.mockResolvedValue(10);

    await expect(
      addCookAccount({ kind: "CREDENTIAL", name: "Eleventh Cook" }, admin),
    ).rejects.toMatchObject({ errorCode: "COOK_LIMIT_REACHED", status: 409 });
  });
});

describe("rotating a cook password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", slug: "sunrise-hostel" }),
    );
    mocks.cookFind.mockReturnValue(queryResult([]));
    mocks.userFind.mockReturnValue(leanResult([]));
    mocks.hostelMemberFind.mockReturnValue(leanResult([]));
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("issues a fresh password and signs every open session out", async () => {
    cookLookup(cookRow(), cookRow());
    mocks.cookFindOneAndUpdate.mockReturnValue(leanResult(cookRow()));

    const result = await updateCookAccount(cookRowId.toString(), { rotate: true }, admin);

    expect(result.credentials?.temporaryPassword).toHaveLength(8);
    expect(mocks.userUpdateOne.mock.calls[0][1].$set.mustChangePassword).toBe(true);
    // A rotation that left the leaked session signed in would not be one.
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(
      { revokedAt: null, userId: cookUserId },
      expect.objectContaining({ $set: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });

  it("refuses to rotate a cook who signs in with their own email", async () => {
    cookLookup(cookRow({ kind: "INVITE", loginEmail: "ram@example.com" }));

    await expect(
      updateCookAccount(cookRowId.toString(), { rotate: true }, admin),
    ).rejects.toMatchObject({ errorCode: "COOK_NOT_CREDENTIAL", status: 409 });
  });
});

describe("removing a cook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Boys Hostel", slug: "sunrise-boys-hostel" }),
    );
    mocks.cookFind.mockReturnValue(queryResult([]));
    mocks.cookFindOne.mockReturnValue(queryResult(null));
  });

  it("deletes a generated account and keeps its work under a frozen name", async () => {
    cookLookup(cookRow());
    mocks.cookFindOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult({ ...cookRow(), ...update.$set }),
    );

    const { cook } = await removeCookAccount(cookRowId.toString(), admin);

    expect(cook.status).toBe("REMOVED");
    // The point of the whole removal path: the meals this cook announced are
    // still attributable afterwards, under the hostel's first word.
    expect(cook.historicalName).toBe("Previous Sunrise cook");

    const accountUpdate = mocks.userUpdateOne.mock.calls[0][1];
    expect(accountUpdate.$set.isDeleted).toBe(true);
    // A credential nobody can use should not still be sitting in the database.
    expect(accountUpdate.$unset).toEqual({ passwordHash: "" });
    expect(mocks.sessionUpdateMany).toHaveBeenCalled();
  });

  it("hands an invited cook their own account back rather than deleting it", async () => {
    cookLookup(cookRow({ kind: "INVITE", loginEmail: "ram@example.com" }));
    mocks.cookFindOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult({ ...cookRow({ kind: "INVITE" }), ...update.$set }),
    );

    await removeCookAccount(cookRowId.toString(), admin);

    const accountUpdate = mocks.userUpdateOne.mock.calls[0][1];
    // Their account is theirs. It stops being a cook; it does not stop existing.
    expect(accountUpdate.$set.role).toBe(Role.PUBLIC);
    expect(accountUpdate.$set.isDeleted).toBeUndefined();
    expect(accountUpdate.$pull.hostelIds.toString()).toBe(hostelId);
  });

  it("turns the portal off once the last cook is gone", async () => {
    // No primary left behind, which is the case this is about.
    cookLookup(cookRow(), null);
    mocks.cookFindOneAndUpdate.mockImplementation((_filter, update) =>
      leanResult({ ...cookRow(), ...update.$set }),
    );

    await removeCookAccount(cookRowId.toString(), admin);

    // `syncPrimaryCook` found nobody, so the switch follows the roster: an
    // enabled portal with no key behind it is a door that lies.
    expect(mocks.settingsUpdateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ cookPortalEnabled: false }),
      }),
      expect.anything(),
    );
  });
});

describe("accepting a cook invitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", slug: "sunrise-hostel" }),
    );
    mocks.cookFind.mockReturnValue(queryResult([]));
    mocks.registerOrUpgrade.mockResolvedValue({
      created: true,
      upgraded: false,
      user: { email: "ram@example.com", id: cookUserId.toString() },
    });
  });

  it("upgrades the invited address and burns the token", async () => {
    mocks.cookFindOne.mockReturnValue(
      queryResult(
        cookRow({
          kind: "INVITE",
          loginEmail: "ram@example.com",
          status: "INVITED",
          userId: undefined,
        }),
      ),
    );

    const result = await acceptCookInvitation({ token: "a".repeat(32) });

    expect(result.accepted).toBe(true);
    expect(mocks.registerOrUpgrade.mock.calls[0][0].role).toBe(Role.COOK);
    // No session is minted: opening a mailbox proves a mailbox, not a person.
    expect(result).not.toHaveProperty("accessToken");

    const update = mocks.cookUpdateOne.mock.calls[0][1];
    expect(update.$set.status).toBe("ACTIVE");
    expect(update.$unset).toEqual({ invitationToken: "" });
  });

  it("expires an old link instead of honouring it", async () => {
    mocks.cookFindOne.mockReturnValue(
      queryResult(
        cookRow({
          invitationExpiresAt: new Date(Date.now() - 1000),
          kind: "INVITE",
          status: "INVITED",
          userId: undefined,
        }),
      ),
    );

    await expect(acceptCookInvitation({ token: "a".repeat(32) })).rejects.toMatchObject({
      errorCode: "COOK_INVITATION_EXPIRED",
      status: 410,
    });
    expect(mocks.registerOrUpgrade).not.toHaveBeenCalled();
  });
});

describe("attributing past kitchen work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names a live cook by name and a removed one by their frozen label", async () => {
    const departed = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");

    mocks.cookFind.mockReturnValue(
      queryResult([
        { name: "Gita", status: "ACTIVE", userId: cookUserId },
        {
          historicalName: "Previous Sunrise cook",
          name: "Ram",
          status: "REMOVED",
          userId: departed,
        },
      ]),
    );

    const labels = await resolveCookLabels(hostelId, [cookUserId, departed]);

    expect(labels.get(cookUserId.toString())).toBe("Gita");
    // Not "Ram": the name of somebody who no longer has access is not what a
    // resident should be reading beside last month's dinner.
    expect(labels.get(departed.toString())).toBe("Previous Sunrise cook");
  });

  it("does not query at all when there is nothing to attribute", async () => {
    expect((await resolveCookLabels(hostelId, [undefined])).size).toBe(0);
    expect(mocks.cookFind).not.toHaveBeenCalled();
  });
});
