import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  noticeCreate: vi.fn(),
  notificationCreate: vi.fn(),
  platformSettingFindOne: vi.fn(),
  residentFind: vi.fn(),
  sendEmail: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/Notice", () => ({
  NoticeModel: {
    create: mocks.noticeCreate,
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/NoticeReadStatus", () => ({
  NoticeReadStatusModel: { find: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind, findOne: vi.fn() },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: vi.fn(), findOne: mocks.userFindOne },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { create: mocks.notificationCreate },
}));

vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: { findOne: mocks.platformSettingFindOne },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import { createNotice } from "@/modules/notices/notice.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const residentUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");

const staffPrincipal = {
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
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

const noticeInput = {
  category: "URGENT" as const,
  content: "Water supply will be cut from 9am to 1pm tomorrow.",
  isUrgent: true,
  targetAudience: "ALL" as const,
  title: "Water supply interruption",
};

describe("notice broadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.residentFind.mockReturnValue(
      leanResult([
        {
          _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3"),
          email: "asha@example.com",
          firstName: "Asha",
          lastName: "Rai",
          userId: residentUserId,
        },
      ]),
    );
    mocks.notificationCreate.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ sent: true });
    mocks.noticeCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a9"),
      }),
    );
  });

  it("notifies and emails active residents when a notice is published", async () => {
    const result = await createNotice(noticeInput, staffPrincipal);

    expect(result.delivery).toEqual({ emailed: 1, notified: 1 });
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: "NOTICE", userId: residentUserId.toString() }),
    );
    expect(mocks.sendEmail.mock.calls[0][0].subject).toContain("Urgent notice");
  });

  it("still records in-app notifications when notice emails are switched off", async () => {
    mocks.platformSettingFindOne.mockReturnValue(
      leanResult({ key: "operations", value: { sendNoticeEmails: false } }),
    );

    const result = await createNotice(noticeInput, staffPrincipal);

    expect(result.delivery).toEqual({ emailed: 0, notified: 1 });
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("publishes the notice even if the broadcast fails", async () => {
    mocks.residentFind.mockImplementation(() => {
      throw new Error("resident lookup failed");
    });

    const result = await createNotice(noticeInput, staffPrincipal);

    expect(result.notice.title).toBe(noticeInput.title);
    expect(result.delivery).toEqual({ emailed: 0, notified: 0 });
  });
});
