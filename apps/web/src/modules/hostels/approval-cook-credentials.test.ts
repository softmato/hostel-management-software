import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  applicationUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelFindOneAndUpdate: vi.fn(),
  provisionCookAccount: vi.fn(),
  registerOrUpgradeUserByEmail: vi.fn(),
  sendEmail: vi.fn(),
  userFindOne: vi.fn(),
  userUpdateOne: vi.fn(),
  verificationFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: {
    findOne: mocks.hostelFindOne,
    findOneAndUpdate: mocks.hostelFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/HostelApplication", () => ({
  HostelApplicationModel: { updateMany: mocks.applicationUpdateMany },
}));

vi.mock("@hostel/db/models/HostelVerification", () => ({
  HostelVerificationModel: { findOneAndUpdate: mocks.verificationFindOneAndUpdate },
}));

vi.mock("@hostel/db/models/HostelDocument", () => ({
  HostelDocumentModel: { find: vi.fn(), findOne: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@hostel/db/models/Inquiry", () => ({ InquiryModel: { find: vi.fn() } }));

vi.mock("@hostel/db/models/RatingReview", () => ({
  RatingReviewModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: mocks.userFindOne, updateOne: mocks.userUpdateOne },
}));

vi.mock("@/modules/users/user.service", () => ({
  registerOrUpgradeUserByEmail: mocks.registerOrUpgradeUserByEmail,
}));

// Provisioning internals are covered in modules/food/cook.test.ts; here we pin
// the approval *wiring* — that approval issues a cook login and hands it to the
// owner in the approval email.
vi.mock("@/modules/food/cook.service", () => ({
  provisionCookAccount: mocks.provisionCookAccount,
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import { approvePlatformHostel } from "@/modules/hostels/hostel.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const ownerId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");

const platformPrincipal = {
  hostelIds: [],
  role: Role.SUPERADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function hostelRecord() {
  return {
    _id: new Types.ObjectId(hostelId),
    name: "Sunrise Hostel",
    ownerId,
    slug: "sunrise-hostel",
    status: "APPROVED",
    verificationStatus: "VERIFIED",
  };
}

describe("hostel approval issues cook credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOneAndUpdate.mockReturnValue(leanResult(hostelRecord()));
    mocks.hostelFindOne.mockReturnValue(queryResult(hostelRecord()));
    mocks.userFindOne.mockReturnValue(
      leanResult({ _id: ownerId, email: "owner@example.com", name: "Owner" }),
    );
    mocks.registerOrUpgradeUserByEmail.mockResolvedValue({ temporaryPassword: null });
    mocks.provisionCookAccount.mockResolvedValue({
      cookName: "Sunrise Hostel Cook",
      credentials: {
        email: "cook@sunrise-hostel.hostelhub.local",
        temporaryPassword: "cook-secret-pw",
      },
      settings: {},
    });
    mocks.sendEmail.mockResolvedValue({ sent: true });
  });

  it("provisions the shared cook account during approval", async () => {
    await approvePlatformHostel(hostelId, platformPrincipal);

    expect(mocks.provisionCookAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        hostelName: "Sunrise Hostel",
        hostelSlug: "sunrise-hostel",
      }),
    );
  });

  it("puts the cook credentials in the approval email", async () => {
    await approvePlatformHostel(hostelId, platformPrincipal);

    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.to).toBe("owner@example.com");
    expect(email.html).toContain("cook@sunrise-hostel.hostelhub.local");
    expect(email.html).toContain("cook-secret-pw");
    expect(email.html).toContain("Cook portal access");
  });

  it("warns the owner that the cook login is shared and limited", async () => {
    await approvePlatformHostel(hostelId, platformPrincipal);

    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.html).toContain("shared kitchen login");
    expect(email.html).toContain("cannot see payments");
  });

  it("explains that the first cook sets the shared password", async () => {
    await approvePlatformHostel(hostelId, platformPrincipal);

    const email = mocks.sendEmail.mock.calls[0][0];
    expect(email.html).toContain("First-time password");
    expect(email.html).toContain("becomes the kitchen's shared password");
  });

  it("still approves when cook provisioning fails", async () => {
    mocks.provisionCookAccount.mockRejectedValue(new Error("cook upsert failed"));

    const result = await approvePlatformHostel(hostelId, platformPrincipal);

    expect(result.hostel.status).toBe("APPROVED");
    expect(mocks.sendEmail).toHaveBeenCalled();
    expect(mocks.sendEmail.mock.calls[0][0].html).not.toContain("Cook portal access");
  });
});
