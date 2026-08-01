import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complaintFind: vi.fn(),
  complaintUpdateMany: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  notificationCreate: vi.fn(),
  sendEmail: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/Complaint", () => ({
  ComplaintModel: { find: mocks.complaintFind, updateMany: mocks.complaintUpdateMany },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.hostelMemberFind },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: mocks.userFind },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.notificationCreate,
}));

import { runComplaintSlaCheck } from "@/modules/complaints/complaint-sla.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f1");
const ownerId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f2");
const now = new Date("2030-04-10T09:00:00.000Z");

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

describe("complaint SLA cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.complaintUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel", ownerId }));
    mocks.hostelMemberFind.mockReturnValue(leanResult([]));
    mocks.userFind.mockReturnValue(
      leanResult([{ _id: ownerId, email: "owner@example.com", name: "Owner" }]),
    );
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.notificationCreate.mockResolvedValue({});
  });

  it("flags overdue complaints once and alerts the hostel", async () => {
    mocks.complaintFind.mockReturnValue(
      queryResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f3"),
          category: "MAINTENANCE",
          hostelId,
          slaDueAt: new Date("2030-04-08T09:00:00.000Z"),
          title: "Leaking tap",
        },
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0f4"),
          category: "FOOD",
          hostelId,
          slaDueAt: new Date("2030-04-09T09:00:00.000Z"),
          title: "Cold dinner",
        },
      ]),
    );

    const result = await runComplaintSlaCheck(now);

    expect(result).toMatchObject({ flagged: 2, hostelsNotified: 1 });
    // The flag is what makes the job idempotent — it must be written.
    expect(mocks.complaintUpdateMany).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { slaBreachedAt: now } },
    );
    expect(mocks.complaintFind).toHaveBeenCalledWith(
      expect.objectContaining({ slaBreachedAt: { $exists: false } }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail.mock.calls[0][0].subject).toContain("2 overdue complaints");
  });

  it("does nothing when no complaint has breached", async () => {
    mocks.complaintFind.mockReturnValue(queryResult([]));

    const result = await runComplaintSlaCheck(now);

    expect(result.flagged).toBe(0);
    expect(mocks.complaintUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
