import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  codeFindOne: vi.fn(),
  codeUpdateOne: vi.fn(),
  connectToDatabase: vi.fn(),
  referralCreate: vi.fn(),
  referralFindOne: vi.fn(),
  referralFindOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Inquiry", () => ({ InquiryModel: { create: vi.fn() } }));

vi.mock("@hostel/db/models/ReferralCode", () => ({
  ReferralCodeModel: {
    exists: vi.fn(),
    find: vi.fn(),
    findOne: mocks.codeFindOne,
    updateOne: mocks.codeUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Referral", () => ({
  ReferralModel: {
    create: mocks.referralCreate,
    find: vi.fn(),
    findOne: mocks.referralFindOne,
    findOneAndUpdate: mocks.referralFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/ReferralReward", () => ({
  ReferralRewardModel: { find: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@/modules/residents/resident-access", () => ({
  findCurrentResident: vi.fn(),
  normalizeObjectId: (value: string) => new Types.ObjectId(value),
  serializeResidentSummary: (value: unknown) => value,
}));

import {
  assertActiveReferralCode,
  linkReferralOnRegistration,
  markReferralConverted,
} from "@/modules/referrals/referral.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");
const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f9");
const codeId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f2");
const referrerResidentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f3");
const joinedResidentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f4");
const referralId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f5");
const paymentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f6");

const principal = {
  hostelIds: [hostelId.toString()],
  role: "HOSTEL_ADMIN",
  userId: "64f0f0f0f0f0f0f0f0f0f0f7",
} as never;

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

const activeCode = {
  _id: codeId,
  code: "HH12341234",
  hostelId,
  residentId: referrerResidentId,
  status: "ACTIVE" as const,
  userId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f8"),
};

describe("referral registration linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.codeFindOne.mockReturnValue(leanResult(activeCode));
    mocks.referralFindOne.mockReturnValue(leanResult(null));
    mocks.referralCreate.mockResolvedValue({
      _id: referralId,
      hostelId,
      name: "Bina",
      phone: "9800000000",
      referralCodeId: codeId,
      referrerResidentId,
      status: "JOINED",
    });
    mocks.codeUpdateOne.mockResolvedValue({});
    mocks.auditCreate.mockResolvedValue({});
  });

  it("rejects a code that belongs to another hostel", async () => {
    mocks.codeFindOne.mockReturnValue(leanResult(null));

    await expect(
      assertActiveReferralCode("HH12341234", otherHostelId),
    ).rejects.toMatchObject({ errorCode: "REFERRAL_CODE_NOT_FOUND", status: 404 });
    // The hostel has to be part of the lookup or a code from hostel A would
    // credit a leaderboard in hostel B.
    expect(mocks.codeFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ hostelId: otherHostelId, status: "ACTIVE" }),
    );
  });

  it("creates a JOINED referral and counts the join once", async () => {
    const result = await linkReferralOnRegistration({
      code: "hh12341234",
      hostelId,
      joinedResidentId,
      name: "Bina",
      phone: "9800000000",
      principal,
    });

    expect(result.code).toBe("HH12341234");
    expect(mocks.referralCreate).toHaveBeenCalledWith(
      expect.objectContaining({ joinedResidentId, status: "JOINED" }),
    );
    expect(mocks.codeUpdateOne).toHaveBeenCalledWith(
      { _id: codeId },
      { $inc: { joinedCount: 1 } },
    );
  });

  it("confirms the existing inquiry row instead of duplicating the person", async () => {
    mocks.referralFindOne.mockReturnValue(
      leanResult({
        _id: referralId,
        hostelId,
        name: "Bina",
        phone: "9800000000",
        referralCodeId: codeId,
        referrerResidentId,
        status: "INQUIRY_CREATED",
      }),
    );
    mocks.referralFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: referralId,
        hostelId,
        name: "Bina",
        phone: "9800000000",
        referralCodeId: codeId,
        referrerResidentId,
        status: "JOINED",
      }),
    );

    await linkReferralOnRegistration({
      code: "HH12341234",
      hostelId,
      joinedResidentId,
      name: "Bina",
      phone: "9800000000",
      principal,
    });

    expect(mocks.referralCreate).not.toHaveBeenCalled();
    expect(mocks.referralFindOneAndUpdate).toHaveBeenCalled();
    expect(mocks.codeUpdateOne).toHaveBeenCalledWith(
      { _id: codeId },
      { $inc: { joinedCount: 1 } },
    );
  });

  it("does not re-count a referral that was already confirmed by hand", async () => {
    mocks.referralFindOne.mockReturnValue(
      leanResult({
        _id: referralId,
        hostelId,
        name: "Bina",
        phone: "9800000000",
        referralCodeId: codeId,
        referrerResidentId,
        status: "JOINED",
      }),
    );
    mocks.referralFindOneAndUpdate.mockReturnValue(
      leanResult({
        _id: referralId,
        hostelId,
        name: "Bina",
        phone: "9800000000",
        referralCodeId: codeId,
        referrerResidentId,
        status: "JOINED",
      }),
    );

    await linkReferralOnRegistration({
      code: "HH12341234",
      hostelId,
      joinedResidentId,
      name: "Bina",
      phone: "9800000000",
      principal,
    });

    expect(mocks.codeUpdateOne).not.toHaveBeenCalled();
  });

  it("refuses a resident referring themselves", async () => {
    await expect(
      linkReferralOnRegistration({
        code: "HH12341234",
        hostelId,
        joinedResidentId: referrerResidentId,
        name: "Bina",
        phone: "9800000000",
        principal,
      }),
    ).rejects.toMatchObject({ errorCode: "REFERRAL_SELF_REFERENCE" });
  });
});

describe("referral conversion on verified payment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.codeUpdateOne.mockResolvedValue({});
  });

  it("marks the referral converted and bumps the code counter", async () => {
    mocks.referralFindOneAndUpdate.mockReturnValue(
      leanResult({ _id: referralId, hostelId, referralCodeId: codeId }),
    );

    const result = await markReferralConverted({
      hostelId,
      paymentId,
      residentId: joinedResidentId,
    });

    expect(result).toMatchObject({ converted: true });
    // The filter is what makes this idempotent: an already-converted referral
    // cannot match, so a second verified payment adds nothing.
    expect(mocks.referralFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        converted: { $ne: true },
        joinedResidentId,
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.codeUpdateOne).toHaveBeenCalledWith(
      { _id: codeId },
      { $inc: { convertedCount: 1 } },
    );
  });

  it("is a no-op for a resident nobody referred", async () => {
    mocks.referralFindOneAndUpdate.mockReturnValue(leanResult(null));

    const result = await markReferralConverted({
      hostelId,
      paymentId,
      residentId: joinedResidentId,
    });

    expect(result).toEqual({ converted: false });
    expect(mocks.codeUpdateOne).not.toHaveBeenCalled();
  });

  it("swallows a database failure so verification still succeeds", async () => {
    mocks.referralFindOneAndUpdate.mockImplementation(() => {
      throw new Error("mongo down");
    });

    await expect(
      markReferralConverted({ hostelId, paymentId, residentId: joinedResidentId }),
    ).resolves.toEqual({ converted: false });
  });
});
