import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  hostelFindOne: vi.fn(),
  notificationCreate: vi.fn(),
  paymentFind: vi.fn(),
  paymentUpdateOne: vi.fn(),
  platformSettingFindOne: vi.fn(),
  residentFind: vi.fn(),
  sendEmail: vi.fn(),
  userFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectToDatabase: mocks.connectToDatabase,
}));

vi.mock("@hostel/db/models/Payment", () => ({
  PaymentModel: {
    find: mocks.paymentFind,
    updateOne: mocks.paymentUpdateOne,
  },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    find: mocks.residentFind,
  },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: {
    findOne: mocks.hostelFindOne,
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    findOne: mocks.userFindOne,
  },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: vi.fn() },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: {
    create: mocks.notificationCreate,
  },
}));

vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: {
    findOne: mocks.platformSettingFindOne,
  },
}));

vi.mock("@hostel/shared/email/sender", () => ({
  sendEmail: mocks.sendEmail,
}));

import { runPaymentReminders } from "@/modules/payments/payment-reminders.service";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a3");
const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a4");

const NOW = new Date("2030-06-10T09:00:00.000Z");

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

function payment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a7"),
    dueAmount: 8500,
    dueDate: new Date("2030-06-13T00:00:00.000Z"),
    hostelId,
    month: "2030-06",
    paidAmount: 0,
    residentId,
    status: "UNPAID",
    ...overrides,
  };
}

function resident() {
  return {
    _id: residentId,
    email: "asha@example.com",
    firstName: "Asha",
    hostelId,
    lastName: "Rai",
    userId,
  };
}

describe("payment reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.residentFind.mockReturnValue(leanResult([resident()]));
    mocks.notificationCreate.mockResolvedValue({});
    mocks.sendEmail.mockResolvedValue({ sent: true });
  });

  it("reminds exactly paymentReminderDaysBefore days ahead of the due date", async () => {
    mocks.paymentFind.mockReturnValue(queryResult([payment()]));

    const result = await runPaymentReminders(NOW);

    expect(result.reminded).toBe(1);
    expect(result.markedOverdue).toBe(0);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "asha@example.com" }),
    );
    expect(mocks.sendEmail.mock.calls[0][0].subject).toContain("Payment due soon");
  });

  it("stays quiet on days that are neither the reminder day nor a chase day", async () => {
    mocks.paymentFind.mockReturnValue(
      queryResult([payment({ dueDate: new Date("2030-06-20T00:00:00.000Z") })]),
    );

    const result = await runPaymentReminders(NOW);

    expect(result.reminded).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("marks past-due payments OVERDUE and chases on the schedule", async () => {
    mocks.paymentFind.mockReturnValue(
      queryResult([payment({ dueDate: new Date("2030-06-09T00:00:00.000Z") })]),
    );

    const result = await runPaymentReminders(NOW);

    expect(result.markedOverdue).toBe(1);
    expect(result.overdueNotified).toBe(1);
    expect(mocks.paymentUpdateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: { status: "OVERDUE" },
    });
    expect(mocks.sendEmail.mock.calls[0][0].subject).toContain("Payment overdue");
  });

  it("marks overdue but skips the email on a non-chase day", async () => {
    mocks.paymentFind.mockReturnValue(
      queryResult([payment({ dueDate: new Date("2030-06-08T00:00:00.000Z") })]),
    );

    const result = await runPaymentReminders(NOW);

    expect(result.markedOverdue).toBe(1);
    expect(result.overdueNotified).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
