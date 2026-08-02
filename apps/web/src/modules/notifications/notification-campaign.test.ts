import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  campaignCreate: vi.fn(),
  campaignFind: vi.fn(),
  campaignFindById: vi.fn(),
  campaignFindOneAndUpdate: vi.fn(),
  campaignUpdateOne: vi.fn(),
  connectToDatabase: vi.fn(),
  guardianAccessFind: vi.fn(),
  notificationAggregate: vi.fn(),
  notificationInsertMany: vi.fn(),
  residentFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/GuardianAccess", () => ({
  GuardianAccessModel: { find: mocks.guardianAccessFind },
}));

vi.mock("@hostel/db/models/NotificationCampaign", () => ({
  NotificationCampaignModel: {
    create: mocks.campaignCreate,
    find: mocks.campaignFind,
    findById: mocks.campaignFindById,
    findOneAndUpdate: mocks.campaignFindOneAndUpdate,
    updateOne: mocks.campaignUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: {
    aggregate: mocks.notificationAggregate,
    insertMany: mocks.notificationInsertMany,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));

import {
  createHostelNotificationCampaign,
  dispatchDueCampaigns,
} from "@/modules/notifications/notification-campaign.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const otherHostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a2");
const campaignId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3");
const residentUserA = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a4");
const residentUserB = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a5");

const principal = {
  hostelIds: [hostelId.toString()],
  role: "HOSTEL_ADMIN",
  userId: "64f0f0f0f0f0f0f0f0f0f0a6",
} as never;

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

const savedCampaign = {
  _id: campaignId,
  audience: "ALL" as const,
  body: "Water supply resumes at 6pm.",
  category: "ANNOUNCEMENT",
  hostelId,
  priority: "NORMAL" as const,
  scope: "HOSTEL" as const,
  status: "SCHEDULED" as const,
  title: "Water notice",
};

describe("notification campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campaignCreate.mockResolvedValue(savedCampaign);
    mocks.campaignFindById.mockReturnValue(leanResult(savedCampaign));
    mocks.campaignUpdateOne.mockResolvedValue({});
    mocks.notificationInsertMany.mockResolvedValue([]);
    mocks.auditCreate.mockResolvedValue({});
    mocks.residentFind.mockReturnValue(
      queryResult([
        { _id: new Types.ObjectId(), userId: residentUserA },
        { _id: new Types.ObjectId(), userId: residentUserB },
      ]),
    );
  });

  it("sends immediately when no schedule is given", async () => {
    await createHostelNotificationCampaign(
      {
        audience: "ALL",
        body: "Water supply resumes at 6pm.",
        category: "ANNOUNCEMENT",
        priority: "NORMAL",
        residentIds: [],
        title: "Water notice",
      } as never,
      principal,
    );

    expect(mocks.notificationInsertMany).toHaveBeenCalledTimes(1);
    expect(mocks.notificationInsertMany.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.campaignUpdateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      expect.objectContaining({
        $set: expect.objectContaining({ recipientCount: 2, status: "SENT" }),
      }),
    );
  });

  it("does not send a scheduled campaign in the same request", async () => {
    await createHostelNotificationCampaign(
      {
        audience: "ALL",
        body: "Water supply resumes at 6pm.",
        category: "ANNOUNCEMENT",
        priority: "NORMAL",
        residentIds: [],
        scheduledFor: new Date(Date.now() + 3_600_000),
        title: "Water notice",
      } as never,
      principal,
    );

    expect(mocks.notificationInsertMany).not.toHaveBeenCalled();
  });

  it("refuses a delivery time in the past", async () => {
    await expect(
      createHostelNotificationCampaign(
        {
          audience: "ALL",
          body: "Water supply resumes at 6pm.",
          category: "ANNOUNCEMENT",
          priority: "NORMAL",
          residentIds: [],
          scheduledFor: new Date(Date.now() - 86_400_000),
          title: "Water notice",
        } as never,
        principal,
      ),
    ).rejects.toMatchObject({ errorCode: "NOTIFICATION_SCHEDULE_IN_PAST" });

    expect(mocks.campaignCreate).not.toHaveBeenCalled();
  });

  it("rejects a hostel the principal does not hold", async () => {
    await expect(
      createHostelNotificationCampaign(
        {
          audience: "ALL",
          body: "Water supply resumes at 6pm.",
          category: "ANNOUNCEMENT",
          hostelId: otherHostelId.toString(),
          priority: "NORMAL",
          residentIds: [],
          title: "Water notice",
        } as never,
        principal,
      ),
    ).rejects.toThrow();

    expect(mocks.campaignCreate).not.toHaveBeenCalled();
  });

  it("targets guardian logins, not resident logins, for a GUARDIANS campaign", async () => {
    mocks.guardianAccessFind.mockReturnValue(
      queryResult([{ userId: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1") }]),
    );
    mocks.campaignCreate.mockResolvedValue({ ...savedCampaign, audience: "GUARDIANS" });
    mocks.campaignFindById.mockReturnValue(
      leanResult({ ...savedCampaign, audience: "GUARDIANS" }),
    );

    await createHostelNotificationCampaign(
      {
        audience: "GUARDIANS",
        body: "Fee reminder.",
        category: "ANNOUNCEMENT",
        priority: "NORMAL",
        residentIds: [],
        title: "Fees",
      } as never,
      principal,
    );

    const written = mocks.notificationInsertMany.mock.calls[0][0];
    expect(written).toHaveLength(1);
    expect(written[0].userId).toBe("64f0f0f0f0f0f0f0f0f0f0b1");
  });
});

describe("scheduled notification dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.campaignUpdateOne.mockResolvedValue({});
    mocks.notificationInsertMany.mockResolvedValue([]);
    mocks.residentFind.mockReturnValue(
      queryResult([{ _id: new Types.ObjectId(), userId: residentUserA }]),
    );
  });

  it("claims each due campaign before writing its receipts", async () => {
    mocks.campaignFind.mockReturnValue(queryResult([savedCampaign]));
    mocks.campaignFindOneAndUpdate.mockReturnValue(leanResult(savedCampaign));

    const result = await dispatchDueCampaigns(new Date("2030-01-01T00:00:00.000Z"));

    expect(result).toMatchObject({ dispatched: 1, failed: 0, recipients: 1 });
    // The claim filter is what stops two overlapping cron runs double-sending.
    expect(mocks.campaignFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: campaignId, status: "SCHEDULED" },
      expect.anything(),
      expect.anything(),
    );
  });

  it("skips a campaign another run already claimed", async () => {
    mocks.campaignFind.mockReturnValue(queryResult([savedCampaign]));
    mocks.campaignFindOneAndUpdate.mockReturnValue(leanResult(null));

    const result = await dispatchDueCampaigns(new Date("2030-01-01T00:00:00.000Z"));

    expect(result.dispatched).toBe(0);
    expect(mocks.notificationInsertMany).not.toHaveBeenCalled();
  });

  it("marks a failing campaign FAILED instead of retrying it forever", async () => {
    mocks.campaignFind.mockReturnValue(queryResult([savedCampaign]));
    mocks.campaignFindOneAndUpdate.mockReturnValue(leanResult(savedCampaign));
    mocks.notificationInsertMany.mockRejectedValue(new Error("write failed"));

    const result = await dispatchDueCampaigns(new Date("2030-01-01T00:00:00.000Z"));

    expect(result).toMatchObject({ dispatched: 0, failed: 1 });
    expect(mocks.campaignUpdateOne).toHaveBeenCalledWith(
      { _id: campaignId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});
