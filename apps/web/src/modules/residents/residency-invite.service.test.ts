/**
 * "Your hostel added you as a resident — is this you?"
 *
 * The cases are the ways a hostel's typo could reach the wrong person: an
 * unverified address, a staff account, an invite answered by an account whose
 * email does not match, and a "not me" that keeps coming back.
 */
import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  hostelFindOne: vi.fn(),
  inApp: vi.fn(),
  issueSession: vi.fn(),
  link: vi.fn(),
  residentFindOne: vi.fn(),
  residentUpdateOne: vi.fn(),
  staff: vi.fn(),
  userFindById: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/auth/auth.service", () => ({ issueSessionForUser: mocks.issueSession }));
vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.inApp,
}));
vi.mock("@/modules/residents/resident.service", () => ({ linkResidentAccount: mocks.link }));
vi.mock("@/modules/residents/resident-notify", () => ({ resolveHostelStaffUserIds: mocks.staff }));
vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { findOne: mocks.hostelFindOne } }));
vi.mock("@hostel/db/models/Invoice", () => ({ InvoiceModel: { aggregate: mocks.aggregate } }));
vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne, updateOne: mocks.residentUpdateOne },
}));
vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findById: mocks.userFindById, findOne: mocks.userFindOne },
}));

import {
  acceptResidencyInvite,
  declineResidencyInvite,
  findResidencyInvite,
} from "@/modules/residents/residency-invite.service";

const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const principal = { hostelIds: [], role: "PUBLIC", userId: userId.toString() } as never;

function chain<T>(value: T) {
  const query = { lean: vi.fn().mockResolvedValue(value), select: vi.fn(), sort: vi.fn() };

  query.select.mockReturnValue(query);
  query.sort.mockReturnValue(query);

  return query;
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    _id: userId,
    email: "Ram@Example.com",
    emailVerified: true,
    role: "PUBLIC",
    status: "ACTIVE",
    ...overrides,
  };
}

const resident = {
  _id: residentId,
  email: "ram@example.com",
  firstName: "Ram",
  hostelId,
  lastName: "Thapa",
  paidTill: "2083-06",
  roomType: "Double",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindOne.mockReturnValue(chain(account()));
  mocks.residentFindOne.mockReturnValue(chain(resident));
  mocks.hostelFindOne.mockReturnValue(chain({ name: "Education Light" }));
  mocks.aggregate.mockResolvedValue([]);
  mocks.link.mockResolvedValue({ linked: true, userId: userId.toString() });
  mocks.userFindById.mockReturnValue(chain({ ...account(), role: "RESIDENT" }));
  mocks.issueSession.mockResolvedValue({ accessToken: "a", refreshToken: "r", user: { role: "RESIDENT" } });
  mocks.staff.mockResolvedValue(["owner1"]);
});

describe("who is asked", () => {
  it("asks a verified public account whose email a hostel has, and says what is due", async () => {
    mocks.aggregate.mockResolvedValue([{ total: 26500 }]);

    await expect(findResidencyInvite(principal)).resolves.toEqual({
      dueAmount: 26500,
      firstName: "Ram",
      hostelName: "Education Light",
      paidTill: "Aswin 2083",
      residentId: residentId.toString(),
      roomType: "Double",
    });

    const filter = mocks.residentFindOne.mock.calls[0]![0];

    // Matched on the lower-cased address, only unlinked, and never after "not me".
    expect(filter).toMatchObject({ accountLinkDeclinedAt: null, email: "ram@example.com" });
  });

  it("does not ask when the email is not verified", async () => {
    mocks.userFindOne.mockReturnValue(chain(account({ emailVerified: false })));

    await expect(findResidencyInvite(principal)).resolves.toBeNull();
    expect(mocks.residentFindOne).not.toHaveBeenCalled();
  });

  it("does not ask a staff or resident account", async () => {
    mocks.userFindOne.mockReturnValue(chain(account({ role: "WARDEN" })));

    await expect(findResidencyInvite(principal)).resolves.toBeNull();
  });
});

describe("answering", () => {
  it("links the account on Continue and hands back a resident session", async () => {
    const result = await acceptResidencyInvite(principal, residentId.toString());

    expect(mocks.link).toHaveBeenCalledWith(
      resident,
      hostelId,
      principal,
      undefined,
      false,
      { email: "ram@example.com", userId },
    );
    expect(result).toEqual({
      residentId: residentId.toString(),
      session: { accessToken: "a", refreshToken: "r", user: { role: "RESIDENT" } },
    });
  });

  it("refuses an invite that does not belong to the signed-in email", async () => {
    mocks.residentFindOne.mockReturnValue(chain(null));

    await expect(acceptResidencyInvite(principal, residentId.toString())).rejects.toMatchObject({
      errorCode: "RESIDENCY_INVITE_NOT_FOUND",
      status: 404,
    });
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("says plainly when the account already lives somewhere else", async () => {
    mocks.link.mockResolvedValue({ linked: false, reason: "ACCOUNT_ALREADY_LINKED" });

    await expect(acceptResidencyInvite(principal, residentId.toString())).rejects.toMatchObject({
      message: expect.stringContaining("already a resident somewhere else"),
      status: 409,
    });
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it("records This is not me and tells the hostel to check the email", async () => {
    await declineResidencyInvite(principal, residentId.toString());

    expect(mocks.residentUpdateOne).toHaveBeenCalledWith(
      { _id: residentId },
      { $set: { accountLinkDeclinedAt: expect.any(Date), accountLinkDeclinedBy: userId } },
    );
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.inApp).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Someone signed in with ram@example.com and said they are not Ram Thapa. Check the email on their record.",
        title: "Check Ram Thapa's email",
        userId: "owner1",
      }),
    );
  });
});
