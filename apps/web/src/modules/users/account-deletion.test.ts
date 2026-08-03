import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  deletionFindOne: vi.fn(),
  deletionFindOneAndUpdate: vi.fn(),
  deviceTokenDeleteMany: vi.fn(),
  guardianAccessUpdateMany: vi.fn(),
  hostelFind: vi.fn(),
  residentFindOne: vi.fn(),
  sendNotificationEmail: vi.fn(),
  sessionUpdateMany: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AccountDeletionRequest", () => ({
  AccountDeletionRequestModel: {
    countDocuments: vi.fn().mockResolvedValue(0),
    find: vi.fn(),
    findOne: mocks.deletionFindOne,
    findOneAndUpdate: mocks.deletionFindOneAndUpdate,
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    find: mocks.userFind,
    findOne: mocks.userFindOne,
    findOneAndUpdate: mocks.userFindOneAndUpdate,
    updateOne: mocks.userUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { find: mocks.hostelFind } }));

vi.mock("@hostel/db/models/Session", () => ({
  SessionModel: { updateMany: mocks.sessionUpdateMany },
}));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: { deleteMany: mocks.deviceTokenDeleteMany },
}));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: { updateMany: mocks.guardianAccessUpdateMany },
}));

// Returns a promise: the service chains `.catch()` on every audit write so a
// logging failure cannot fail the request.
vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(),
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  appUrl: (path: string) => `https://hostelhub.local${path}`,
  sendNotificationEmail: mocks.sendNotificationEmail,
}));

vi.mock("@/lib/auth", () => ({
  signPurposeToken: vi.fn().mockResolvedValue("cancel-token"),
  verifyPurposeToken: vi.fn(),
}));

import { verifyPurposeToken } from "@/lib/auth";
import {
  cancelAccountDeletionByToken,
  getAccountDeletionStatus,
  requestAccountDeletion,
} from "@/modules/users/account-deletion.service";

const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0dd01");
const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0dd02");

function principal(role: Role) {
  return {
    hostelIds: [hostelId.toString()],
    role,
    sessionId: "session-d",
    userId: userId.toString(),
  };
}

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function selectResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value), select: vi.fn().mockReturnThis() };
}

function userOf(role: Role) {
  return leanResult({
    _id: userId,
    email: "person@example.test",
    hostelIds: [hostelId],
    name: "Bina Thapa",
    role,
    status: "ACTIVE",
  });
}

const input = { reason: "I no longer live in a hostel and want my data removed." };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindOne.mockReturnValue(userOf(Role.PUBLIC));
  mocks.residentFindOne.mockReturnValue(selectResult(null));
  mocks.hostelFind.mockReturnValue(selectResult([{ name: "Sunrise Hostel" }]));
  mocks.deletionFindOne.mockReturnValue(leanResult(null));
  mocks.deletionFindOneAndUpdate.mockReturnValue(
    leanResult({
      _id: new Types.ObjectId(),
      kind: "SELF_SERVICE",
      reason: input.reason,
      requestedAt: new Date("2030-01-01T00:00:00.000Z"),
      requestedEmail: "person@example.test",
      requestedRole: Role.PUBLIC,
      userId,
    }),
  );
  mocks.userFind.mockReturnValue(selectResult([]));
  mocks.userFindOneAndUpdate.mockReturnValue(leanResult({ _id: userId }));
  mocks.sendNotificationEmail.mockResolvedValue({ sent: true });
});

describe("account deletion — which pathway an account gets", () => {
  it("gives a public account the 60-day self-service flow", async () => {
    const status = await getAccountDeletionStatus(principal(Role.PUBLIC));

    expect(status.pathway).toBe("SELF_SERVICE");
    expect(status.graceperiodDays).toBe(60);
  });

  it("refuses a resident who is still living in a hostel", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.RESIDENT));
    mocks.residentFindOne.mockReturnValue(selectResult({ _id: new Types.ObjectId() }));

    const status = await getAccountDeletionStatus(principal(Role.RESIDENT));

    expect(status.pathway).toBe("BLOCKED");
    expect(status.blockedReason).toContain("moved out");

    await expect(
      requestAccountDeletion(input, principal(Role.RESIDENT)),
    ).rejects.toMatchObject({ errorCode: "DELETION_NOT_ALLOWED", status: 409 });

    // Nothing was written and nothing was closed.
    expect(mocks.deletionFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
  });

  it("lets a moved-out resident through", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.RESIDENT));
    mocks.residentFindOne.mockReturnValue(selectResult(null));

    const status = await getAccountDeletionStatus(principal(Role.RESIDENT));

    expect(status.pathway).toBe("SELF_SERVICE");
  });

  it("routes a hostel owner to the platform owner instead of deleting", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.HOSTEL_ADMIN));

    const status = await getAccountDeletionStatus(principal(Role.HOSTEL_ADMIN));

    expect(status.pathway).toBe("PLATFORM_REVIEW");
    expect(status.hostelNames).toEqual(["Sunrise Hostel"]);
  });

  it("gives a guardian the release path, not deletion", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.GUARDIAN));

    const status = await getAccountDeletionStatus(principal(Role.GUARDIAN));

    expect(status.pathway).toBe("GUARDIAN_RELEASE");
  });

  it("tells staff to ask their admin", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.WARDEN));

    const status = await getAccountDeletionStatus(principal(Role.WARDEN));

    expect(status.pathway).toBe("BLOCKED");
    expect(status.blockedReason).toContain("administrator");
  });
});

describe("account deletion — self-service request", () => {
  it("closes the account, kills sessions and devices, and starts the clock", async () => {
    const result = await requestAccountDeletion(input, principal(Role.PUBLIC));

    expect(result.pathway).toBe("SELF_SERVICE");

    const update = mocks.userUpdateOne.mock.calls[0][1];
    expect(update.$set.status).toBe("SUSPENDED");
    // Revoking session rows alone would leave an unexpired access JWT working.
    expect(update.$inc.tokenVersion).toBe(1);

    expect(mocks.sessionUpdateMany).toHaveBeenCalled();
    expect(mocks.deviceTokenDeleteMany).toHaveBeenCalledWith({ userId });

    const written = mocks.deletionFindOneAndUpdate.mock.calls[0][1].$set;
    expect(written.kind).toBe("SELF_SERVICE");
    const days =
      (written.scheduledDeletionAt.getTime() - written.requestedAt.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(days).toBe(60);
  });

  it("emails the user a cancellation link, since they can no longer log in", async () => {
    await requestAccountDeletion(input, principal(Role.PUBLIC));

    const email = mocks.sendNotificationEmail.mock.calls[0][0];
    expect(email.to).toBe("person@example.test");
    expect(email.html).toContain("cancel-deletion?token=cancel-token");
  });

  it("still succeeds when the confirmation email fails", async () => {
    // The account is already closed by this point; a mail failure must not
    // surface as a 500 that suggests nothing happened.
    mocks.sendNotificationEmail.mockRejectedValue(new Error("smtp down"));

    await expect(
      requestAccountDeletion(input, principal(Role.PUBLIC)),
    ).resolves.toMatchObject({ pathway: "SELF_SERVICE" });
  });

  it("refuses a second request while one is open", async () => {
    mocks.deletionFindOne.mockReturnValue(leanResult({ _id: new Types.ObjectId() }));

    await expect(
      requestAccountDeletion(input, principal(Role.PUBLIC)),
    ).rejects.toMatchObject({ errorCode: "DELETION_ALREADY_REQUESTED", status: 409 });
  });
});

describe("account deletion — hostel owner request", () => {
  beforeEach(() => {
    mocks.userFindOne.mockReturnValue(userOf(Role.HOSTEL_ADMIN));
    mocks.deletionFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: new Types.ObjectId(),
        kind: "PLATFORM_REVIEW",
        reason: input.reason,
        requestedAt: new Date("2030-01-01T00:00:00.000Z"),
        requestedEmail: "person@example.test",
        requestedRole: Role.HOSTEL_ADMIN,
        reviewStatus: "PENDING",
        userId,
      }),
    );
  });

  it("leaves the account completely untouched until a superadmin acts", async () => {
    const result = await requestAccountDeletion(input, principal(Role.HOSTEL_ADMIN));

    expect(result.pathway).toBe("PLATFORM_REVIEW");
    // The hostel keeps its administrator: no suspension, no revoked sessions,
    // no removed devices.
    expect(mocks.userUpdateOne).not.toHaveBeenCalled();
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.deviceTokenDeleteMany).not.toHaveBeenCalled();
  });

  it("opens a PENDING review row with no deletion clock on it", async () => {
    await requestAccountDeletion(input, principal(Role.HOSTEL_ADMIN));

    const written = mocks.deletionFindOneAndUpdate.mock.calls[0][1].$set;
    expect(written.kind).toBe("PLATFORM_REVIEW");
    expect(written.reviewStatus).toBe("PENDING");
    // No schedule means the purge cron can never pick it up unapproved.
    expect(written.scheduledDeletionAt).toBeUndefined();
  });

  it("emails the platform owner, not the requester", async () => {
    mocks.userFind.mockReturnValue(
      selectResult([{ _id: new Types.ObjectId(), email: "owner@hostelhub.test" }]),
    );

    await requestAccountDeletion(input, principal(Role.HOSTEL_ADMIN));

    const recipients = mocks.sendNotificationEmail.mock.calls.map((call) => call[0].to);
    expect(recipients).toEqual(["owner@hostelhub.test"]);
  });
});

describe("account deletion — guardian release", () => {
  it("demotes to a public account instead of destroying it", async () => {
    mocks.userFindOne.mockReturnValue(userOf(Role.GUARDIAN));

    const result = await requestAccountDeletion(input, principal(Role.GUARDIAN));

    expect(result.pathway).toBe("GUARDIAN_RELEASE");
    expect(mocks.guardianAccessUpdateMany).toHaveBeenCalledWith(
      { status: "ACTIVE", userId },
      { $set: { status: "REVOKED" } },
    );

    const update = mocks.userUpdateOne.mock.calls[0][1];
    expect(update.$set.role).toBe(Role.PUBLIC);
    // A public account has no tenant; leaving hostelIds would keep granting
    // hostel-scoped reads.
    expect(update.$set.hostelIds).toEqual([]);
    // The account itself survives.
    expect(update.$set.status).toBeUndefined();
  });
});

describe("account deletion — cancelling", () => {
  it("restores the account and confirms by email", async () => {
    vi.mocked(verifyPurposeToken).mockResolvedValue({
      sub: userId.toString(),
    } as never);
    mocks.deletionFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: new Types.ObjectId(),
        cancelled: true,
        kind: "SELF_SERVICE",
        reason: input.reason,
        requestedAt: new Date("2030-01-01T00:00:00.000Z"),
        requestedEmail: "person@example.test",
        requestedRole: Role.PUBLIC,
        userId,
      }),
    );
    mocks.userFindOneAndUpdate.mockReturnValue(
      leanResult({ _id: userId, email: "person@example.test", role: Role.PUBLIC }),
    );

    const result = await cancelAccountDeletionByToken("cancel-token");

    expect(result.request.cancelled).toBe(true);
    expect(mocks.userFindOneAndUpdate.mock.calls[0][1].$set.status).toBe("ACTIVE");
    expect(mocks.sendNotificationEmail.mock.calls[0][0].subject).toContain("reactivated");
  });

  it("cancels on the deletion clock rather than on the request kind", async () => {
    // An owner whose PLATFORM_REVIEW request was approved is on the same
    // countdown and gets the same link, so the query must not filter by kind.
    vi.mocked(verifyPurposeToken).mockResolvedValue({
      sub: userId.toString(),
    } as never);
    mocks.deletionFindOneAndUpdate.mockReturnValue(leanResult(null));

    await cancelAccountDeletionByToken("cancel-token").catch(() => undefined);

    const filter = mocks.deletionFindOneAndUpdate.mock.calls[0][0];
    expect(filter.kind).toBeUndefined();
    expect(filter.scheduledDeletionAt).toEqual({ $exists: true, $ne: null });
  });

  it("rejects a forged or expired link", async () => {
    vi.mocked(verifyPurposeToken).mockRejectedValue(new Error("bad token"));

    await expect(cancelAccountDeletionByToken("nope")).rejects.toMatchObject({
      errorCode: "INVALID_TOKEN",
      status: 400,
    });
  });

  it("404s when there is nothing to cancel", async () => {
    vi.mocked(verifyPurposeToken).mockResolvedValue({
      sub: userId.toString(),
    } as never);
    mocks.deletionFindOneAndUpdate.mockReturnValue(leanResult(null));

    await expect(cancelAccountDeletionByToken("cancel-token")).rejects.toMatchObject({
      errorCode: "NOT_FOUND",
      status: 404,
    });
  });
});
