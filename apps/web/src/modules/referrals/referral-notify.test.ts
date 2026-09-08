import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a referrer hears back after handing out their code.
 *
 * The interesting rule is the cancellation one: a reward is only ever announced
 * as cancelled when the referrer had already been told it was coming. Anything
 * else means telling somebody about a reward they never knew existed, in the
 * same breath as taking it away.
 */
const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  hostelName: vi.fn(),
  resident: vi.fn(),
  user: vi.fn(),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createNotification,
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  getHostelName: mocks.hostelName,
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: () => ({ select: () => ({ lean: mocks.resident }) }) },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { findOne: () => ({ select: () => ({ lean: mocks.user }) }) },
}));

import {
  notifyReferralJoined,
  notifyReferralReward,
} from "@/modules/referrals/referral-notify";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const referrerResidentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");

function reward(overrides: Record<string, unknown> = {}) {
  return notifyReferralReward({
    amount: 1500,
    hostelId,
    previousStatus: "PENDING",
    referrerResidentId,
    rewardType: "CASH",
    status: "PAID",
    ...overrides,
  });
}

describe("referral notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelName.mockResolvedValue("Everest Hostel");
    mocks.resident.mockResolvedValue({ userId });
    mocks.user.mockResolvedValue({ _id: userId });
  });

  it("tells the referrer when someone they referred joins", async () => {
    await notifyReferralJoined({ hostelId, referrerResidentId });

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.title).toBe("Your referral joined");
    expect(call.userId).toBe(userId.toString());
    expect(call.category).toBe("PAYMENT");
  });

  it("quotes the amount when a reward is paid", async () => {
    await reward();

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.title).toBe("Your referral reward is paid");
    expect(call.body).toContain("1,500");
    expect(call.body).toContain("cash reward");
  });

  it("says an approval is not yet paid out", async () => {
    await reward({ status: "APPROVED" });

    expect(mocks.createNotification.mock.calls[0][0].body).toContain("not paid out yet");
  });

  /**
   * `SERVICE_CREDIT` and `OTHER` are routinely recorded with the default amount
   * of 0, and "your reward of NPR 0" reads as a bug.
   */
  it("omits the amount when there is none", async () => {
    await reward({ amount: 0, rewardType: "SERVICE_CREDIT" });

    const body = mocks.createNotification.mock.calls[0][0].body;

    expect(body).toContain("service credit");
    expect(body).not.toContain("NPR");
  });

  it("stays quiet for a reward that is merely pending", async () => {
    await reward({ status: "PENDING" });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("announces a cancellation only after good news was already sent", async () => {
    await reward({ previousStatus: "APPROVED", status: "CANCELLED" });

    expect(mocks.createNotification.mock.calls[0][0].title).toBe(
      "Your referral reward was cancelled",
    );
  });

  it("stays quiet cancelling a reward the referrer was never promised", async () => {
    await reward({ previousStatus: "PENDING", status: "CANCELLED" });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("stays quiet for a referrer with no linked account", async () => {
    mocks.resident.mockResolvedValue({ userId: undefined });

    await reward();

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  /** A deleted account keeps its resident row; the notification has no reader. */
  it("stays quiet when the referrer's account is deleted", async () => {
    mocks.user.mockResolvedValue(null);

    await reward();

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("never lets a notification failure escape into the referral update", async () => {
    mocks.createNotification.mockRejectedValue(new Error("mongo is down"));

    await expect(reward()).resolves.toBeUndefined();
  });
});
