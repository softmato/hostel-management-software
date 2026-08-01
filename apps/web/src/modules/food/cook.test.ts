import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  connectToDatabase: vi.fn(),
  routineFindOne: vi.fn(),
  foodReadyCreate: vi.fn(),
  foodReadyFind: vi.fn(),
  foodReadyFindOne: vi.fn(),
  platformSettingFindOne: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  notificationCreate: vi.fn(),
  residentFind: vi.fn(),
  sendEmail: vi.fn(),
  settingsFindOne: vi.fn(),
  settingsFindOneAndUpdate: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/FoodRoutine", () => ({
  FoodRoutineModel: { findOne: mocks.routineFindOne },
}));

vi.mock("@hostel/db/models/FoodReadyLog", () => ({
  FoodReadyLogModel: {
    create: mocks.foodReadyCreate,
    find: mocks.foodReadyFind,
    findOne: mocks.foodReadyFindOne,
  },
}));

vi.mock("@hostel/db/models/PlatformSetting", () => ({
  PlatformSettingModel: { findOne: mocks.platformSettingFindOne },
}));

vi.mock("@hostel/db/models/Hostel", () => ({
  HostelModel: { findOne: mocks.hostelFindOne },
}));

vi.mock("@hostel/db/models/HostelSettings", () => ({
  HostelSettingsModel: {
    findOne: mocks.settingsFindOne,
    findOneAndUpdate: mocks.settingsFindOneAndUpdate,
  },
}));

vi.mock("@hostel/db/models/HostelMember", () => ({
  HostelMemberModel: { find: mocks.hostelMemberFind },
}));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { create: mocks.notificationCreate },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { find: mocks.residentFind },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    find: mocks.userFind,
    findOne: mocks.userFindOne,
    findOneAndUpdate: mocks.userFindOneAndUpdate,
    updateOne: mocks.userUpdateOne,
  },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

import {
  announceFoodReady,
  getCookPortalSettings,
  updateCookPortal,
} from "@/modules/food/cook.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0a2";
const cookUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const residentUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-1",
  userId: "64f0f0f0f0f0f0f0f0f0f0a4",
};

const cookPrincipal = {
  hostelIds: [hostelId],
  role: Role.COOK,
  sessionId: "session-2",
  userId: cookUserId.toString(),
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

/** A routine serving `items` for lunch on every day, so "today" always hits. */
function routineWithLunch(items: string[]) {
  return leanResult({
    meals: DAY_NAMES.map((dayOfWeek) => ({
      dayOfWeek,
      items,
      mealType: "LUNCH",
    })),
    timings: { LUNCH: "12 PM" },
  });
}

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

describe("cook portal setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", slug: "sunrise-hostel" }),
    );
    mocks.settingsFindOne.mockReturnValue(leanResult(null));
    mocks.hostelMemberFind.mockReturnValue(leanResult([]));
    mocks.userFind.mockReturnValue(leanResult([]));
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("creates a COOK account with a generated login and returns credentials once", async () => {
    mocks.userFindOneAndUpdate.mockReturnValue(leanResult({ _id: cookUserId }));
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookName: "Sunrise Hostel Cook", cookPortalEnabled: true }),
    );

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(result.credentialsIssued).toBe(true);
    expect(result.credentials?.email).toBe("cook@sunrise-hostel.hostelhub.local");
    expect(result.credentials?.temporaryPassword).toBeTruthy();

    const update = mocks.userFindOneAndUpdate.mock.calls[0][1];
    expect(update.$set.role).toBe(Role.COOK);
    // Only the hash is persisted — the plaintext exists solely in this response.
    expect(update.$set.passwordHash).not.toBe(result.credentials?.temporaryPassword);
  });

  it("forces the first cook to replace the emailed hand-off password", async () => {
    mocks.userFindOneAndUpdate.mockReturnValue(leanResult({ _id: cookUserId }));
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: true }),
    );

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(mocks.userFindOneAndUpdate.mock.calls[0][1].$set.mustChangePassword).toBe(
      true,
    );
    expect(result.settings.initialPasswordPending).toBe(true);
  });

  it("rotating issues a different password each time", async () => {
    mocks.userFindOneAndUpdate.mockReturnValue(leanResult({ _id: cookUserId }));
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: true }),
    );

    const first = await updateCookPortal({ enabled: true }, staffPrincipal);
    const second = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(first.credentials?.temporaryPassword).not.toBe(
      second.credentials?.temporaryPassword,
    );
  });

  it("exposes the login and password status to the dashboard, never the password", async () => {
    mocks.settingsFindOne.mockReturnValue(
      leanResult({
        cookCredentialIssuedAt: new Date("2030-01-05T00:00:00.000Z"),
        cookName: "Sunrise Hostel Cook",
        cookPortalEnabled: true,
        cookUserId,
      }),
    );
    mocks.userFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        email: "cook@sunrise-hostel.hostelhub.local",
        mustChangePassword: false,
      }),
      select: vi.fn().mockReturnThis(),
    });

    const { settings } = await getCookPortalSettings(staffPrincipal);

    expect(settings.cookEmail).toBe("cook@sunrise-hostel.hostelhub.local");
    // Cook has chosen their own password: pending flag clears, and no password
    // field is exposed anywhere in the payload.
    expect(settings.initialPasswordPending).toBe(false);
    expect(settings.credentialIssuedAt).toBe("2030-01-05T00:00:00.000Z");
    expect(JSON.stringify(settings)).not.toMatch(/password.*:.*"[^"]/i);
  });

  it("suspends the cook account when the portal is turned off", async () => {
    mocks.settingsFindOne.mockReturnValue(leanResult({ cookUserId }));
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: false }),
    );

    const result = await updateCookPortal({ enabled: false }, staffPrincipal);

    expect(result.credentialsIssued).toBe(false);
    expect(mocks.userUpdateOne).toHaveBeenCalledWith(
      { _id: cookUserId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "SUSPENDED" }) }),
    );
  });

  it("refuses a hostel outside the admin's scope", async () => {
    await expect(
      updateCookPortal({ enabled: true, hostelId: otherHostelId }, staffPrincipal),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("food ready announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.foodReadyFindOne.mockReturnValue(queryResult(null));
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
    mocks.foodReadyCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...input, _id: new Types.ObjectId() }),
    );
  });

  it("builds the announcement from today's menu and notifies active residents", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal", "Bhat", "Tarkari"]));

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.message).toBe("Today's lunch: Dal, Bhat, Tarkari");
    expect(result.announcement.notifiedCount).toBe(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: "FOOD", userId: residentUserId.toString() }),
    );
  });

  it("falls back to a plain ready ping when no menu is published", async () => {
    mocks.routineFindOne.mockReturnValue(leanResult(null));

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "DINNER", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.message).toBe("Dinner is ready.");
  });

  it("prefers a custom message over the menu", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));

    const result = await announceFoodReady(
      {
        deviceInfo: {},
        mealType: "BREAKFAST",
        message: "Breakfast is ready in the hall.",
        useMenuDescription: true,
      },
      cookPrincipal,
    );

    expect(result.announcement.message).toBe("Breakfast is ready in the hall.");
  });

  it("refuses a repeat announcement for the same meal inside the cooldown", async () => {
    mocks.routineFindOne.mockReturnValue(leanResult(null));
    mocks.foodReadyFindOne.mockReturnValue(
      queryResult({ announcedAt: new Date(Date.now() - 10 * 60 * 1000) }),
    );

    await expect(
      announceFoodReady(
        { deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true },
        cookPrincipal,
      ),
    ).rejects.toMatchObject({ errorCode: "FOOD_READY_COOLDOWN", status: 429 });

    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.foodReadyCreate).not.toHaveBeenCalled();
  });

  it("allows a repeat once the cooldown is disabled", async () => {
    mocks.platformSettingFindOne.mockReturnValue(
      leanResult({ key: "operations", value: { foodReadyCooldownMinutes: 0 } }),
    );
    mocks.routineFindOne.mockReturnValue(leanResult(null));
    mocks.foodReadyFindOne.mockReturnValue(
      queryResult({ announcedAt: new Date(Date.now() - 60 * 1000) }),
    );

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.notifiedCount).toBe(1);
  });

  it("keeps a cook inside their own hostel", async () => {
    await expect(
      announceFoodReady(
        {
          deviceInfo: {},
          hostelId: otherHostelId,
          mealType: "LUNCH",
          useMenuDescription: true,
        },
        cookPrincipal,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
