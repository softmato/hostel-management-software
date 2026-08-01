import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guardianAccessFind: vi.fn(),
  guardianFind: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  notificationCreate: vi.fn(),
  sendEmail: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: { find: mocks.guardianAccessFind },
}));

vi.mock("@hostel/db/models/Guardian", () => ({
  GuardianModel: { find: mocks.guardianFind },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.hostelMemberFind },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: mocks.userFind },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@hostel/shared/email/sender", () => ({
  sendEmail: mocks.sendEmail,
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.notificationCreate,
}));

import { fanOutSOSAlert } from "@/modules/safety/safety-notify";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b2");
const ownerId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b3");
const wardenId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b4");
const guardianId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b5");
const guardianUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b6");

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function selectResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    select: vi.fn().mockReturnThis(),
  };
}

const input = {
  alertId: "64f0f0f0f0f0f0f0f0f0f0b9",
  guardianAlertEnabled: true,
  hostelId,
  message: "I feel unsafe outside the gate.",
  residentId,
  residentName: "Asha Rai",
  residentPhone: "9800000000",
  triggeredAt: new Date("2030-01-01T18:30:00.000Z"),
};

describe("SOS fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(selectResult({ name: "Sunrise Hostel", ownerId }));
    mocks.hostelMemberFind.mockReturnValue(leanResult([{ userId: wardenId }]));
    mocks.userFind.mockImplementation((filter: { _id: { $in: Types.ObjectId[] } }) => {
      const ids = filter._id.$in.map((id) => id.toString());

      return leanResult(
        [
          { _id: ownerId, email: "owner@example.com", name: "Owner" },
          { _id: wardenId, email: "warden@example.com", name: "Warden" },
        ].filter((user) => ids.includes(user._id.toString())),
      );
    });
    mocks.guardianAccessFind.mockReturnValue(
      leanResult([{ guardianId, userId: guardianUserId }]),
    );
    mocks.guardianFind.mockReturnValue(
      leanResult([
        {
          _id: guardianId,
          email: "guardian@example.com",
          firstName: "Bimala",
          lastName: "Rai",
        },
      ]),
    );
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.notificationCreate.mockResolvedValue({});
  });

  it("emails and notifies admins, wardens and the linked guardian", async () => {
    const result = await fanOutSOSAlert(input);

    expect(result).toMatchObject({ guardiansNotified: 1, staffNotified: 2 });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(3);
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(3);

    const recipients = mocks.sendEmail.mock.calls.map((call) => call[0].to).sort();

    expect(recipients).toEqual([
      "guardian@example.com",
      "owner@example.com",
      "warden@example.com",
    ]);
    expect(mocks.sendEmail.mock.calls[0][0].subject).toContain("URGENT");
    expect(mocks.notificationCreate.mock.calls[0][0]).toMatchObject({
      category: "SOS",
      data: expect.objectContaining({ priority: "URGENT" }),
    });
  });

  it("skips guardians when the resident switched guardian alerting off", async () => {
    const result = await fanOutSOSAlert({ ...input, guardianAlertEnabled: false });

    expect(result.guardiansNotified).toBe(0);
    expect(mocks.guardianAccessFind).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("still reports the staff it reached when an email bounces", async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error("smtp down"));

    const result = await fanOutSOSAlert(input);

    // The alert row is already persisted by this point — a failed send must not
    // surface as a thrown error to the resident pressing the button.
    expect(result.staffNotified).toBe(2);
    expect(result.failures).toBe(0);
  });
});
