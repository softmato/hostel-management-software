import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  cookCount: vi.fn(),
  cookCreate: vi.fn(),
  cookFind: vi.fn(),
  cookFindOne: vi.fn(),
  cookUpdateOne: vi.fn(),
  connectToDatabase: vi.fn(),
  routineFindOne: vi.fn(),
  foodReadyCreate: vi.fn(),
  foodReadyFind: vi.fn(),
  foodReadyFindOne: vi.fn(),
  platformSettingFindOne: vi.fn(),
  hostelFindOne: vi.fn(),
  hostelMemberFind: vi.fn(),
  notificationCreate: vi.fn(),
  dispatchPush: vi.fn(),
  residentFind: vi.fn(),
  sendPushToUsers: vi.fn(),
  sendEmail: vi.fn(),
  settingsFindOne: vi.fn(),
  settingsFindOneAndUpdate: vi.fn(),
  settingsUpdateOne: vi.fn(),
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  userCreate: vi.fn(),
  userFindOneAndUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  userUpdateOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/AuditLog", () => ({
  AuditLogModel: { create: mocks.auditCreate },
}));

vi.mock("@hostel/db/models/CookAccount", () => ({
  CookAccountModel: {
    countDocuments: mocks.cookCount,
    create: mocks.cookCreate,
    find: mocks.cookFind,
    findOne: mocks.cookFindOne,
    findOneAndUpdate: vi.fn(),
    updateOne: mocks.cookUpdateOne,
  },
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
    updateOne: mocks.settingsUpdateOne,
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
    create: mocks.userCreate,
    find: mocks.userFind,
    findOne: mocks.userFindOne,
    findOneAndUpdate: mocks.userFindOneAndUpdate,
    updateMany: mocks.userUpdateMany,
    updateOne: mocks.userUpdateOne,
  },
}));

vi.mock("@hostel/shared/email/sender", () => ({ sendEmail: mocks.sendEmail }));

/*
 * Expo is the one dependency in this file that would otherwise reach the
 * network. Mocked at the module rather than at `fetch` so the assertions can
 * read the audience and the priority the service chose, which is the whole
 * point of the batched send.
 */
vi.mock("@/modules/notifications/push.service", () => ({
  dispatchPush: mocks.dispatchPush,
  sendPushToUsers: mocks.sendPushToUsers,
}));

import {
  announceFoodReady,
  getCookPortalSettings,
  updateCookPortal,
} from "@/modules/food/cook.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0f0a1";
const otherHostelId = "64f0f0f0f0f0f0f0f0f0f0a2";
const cookUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c1");
const residentUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c2");
const ownerUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c3");
const wardenUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0c4");

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
    // Nothing on the roster and no account on the minted address: the default
    // is a hostel that has never had a cook.
    mocks.userFindOne.mockReturnValue(queryResult(null));
    mocks.cookFindOne.mockReturnValue(queryResult(null));
    mocks.cookFind.mockReturnValue(queryResult([]));
    mocks.cookCount.mockResolvedValue(0);
    mocks.cookCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...input, _id: new Types.ObjectId() }),
    );
    mocks.userCreate.mockResolvedValue({ _id: cookUserId });
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  });

  it("creates a COOK account with a short generated login", async () => {
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookName: "Sunrise Hostel Cook", cookPortalEnabled: true }),
    );

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(result.credentialsIssued).toBe(true);
    // The old address was `cook@<full-hostel-slug>.hostelhub.local`. Anything
    // that long is retyped wrong on a kitchen phone, so the stem is capped at
    // four letters and the suffix is a domain nobody has to spell out.
    expect(result.credentials?.email).toMatch(/^sunr[a-z0-9]*@cook\.local$/);
    expect(result.credentials?.email.length).toBeLessThan(20);
    expect(result.credentials?.temporaryPassword).toBeTruthy();

    const created = mocks.userCreate.mock.calls[0][0];
    expect(created.role).toBe(Role.COOK);
    // Only the hash is persisted — the plaintext exists solely in this response.
    expect(created.passwordHash).not.toBe(result.credentials?.temporaryPassword);
  });

  it("issues a password with no look-alike characters in it", async () => {
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: true }),
    );

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    // Read off a screen, written on a whiteboard, typed by a third person: a
    // password containing `l`/`1`/`I` or `O`/`0` is a support call.
    expect(result.credentials?.temporaryPassword).not.toMatch(/[lI1O0S5]/);
  });

  it("forces the first cook to replace the emailed hand-off password", async () => {
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: true }),
    );

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(mocks.userCreate.mock.calls[0][0].mustChangePassword).toBe(true);
    expect(result.settings.initialPasswordPending).toBe(true);
  });

  it("re-enabling a hostel that already has cooks does not mint another one", async () => {
    // The regression this guards: while a hostel could only have one cook, the
    // enable branch upserted by address and simply rotated. With a roster the
    // same call would add a *new* cook on every flip of the switch.
    mocks.cookFind.mockReturnValue(
      queryResult([{ _id: new Types.ObjectId(), name: "Gita", userId: cookUserId }]),
    );
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookName: "Gita", cookPortalEnabled: true }),
    );
    mocks.userFindOne.mockReturnValue(queryResult({ mustChangePassword: false }));

    const result = await updateCookPortal({ enabled: true }, staffPrincipal);

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.cookCreate).not.toHaveBeenCalled();
    expect(result.credentialsIssued).toBe(false);
    // The existing logins are woken back up instead.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: [cookUserId] } }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "ACTIVE" }) }),
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
        email: "sunr@cook.local",
        mustChangePassword: false,
      }),
      select: vi.fn().mockReturnThis(),
    });

    const { settings } = await getCookPortalSettings(staffPrincipal);

    expect(settings.cookEmail).toBe("sunr@cook.local");
    // Cook has chosen their own password: pending flag clears, and no password
    // field is exposed anywhere in the payload.
    expect(settings.initialPasswordPending).toBe(false);
    expect(settings.credentialIssuedAt).toBe("2030-01-05T00:00:00.000Z");
    expect(JSON.stringify(settings)).not.toMatch(/password.*:.*"[^"]/i);
  });

  it("suspends every cook on the roster when the portal is turned off", async () => {
    const secondCook = new Types.ObjectId();

    mocks.settingsFindOne.mockReturnValue(leanResult({ cookUserId }));
    mocks.cookFind.mockReturnValue(
      queryResult([{ userId: cookUserId }, { userId: secondCook }]),
    );
    mocks.settingsFindOneAndUpdate.mockReturnValue(
      leanResult({ cookPortalEnabled: false }),
    );

    const result = await updateCookPortal({ enabled: false }, staffPrincipal);

    expect(result.credentialsIssued).toBe(false);
    // Not just the one `cookUserId` names: a switch that closed the kitchen for
    // one of three logins would be a switch that lies.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: [cookUserId, secondCook] } },
      expect.objectContaining({ $set: expect.objectContaining({ status: "SUSPENDED" }) }),
    );
  });

  it("refuses a hostel outside the admin's scope", async () => {
    await expect(
      updateCookPortal({ enabled: true, hostelId: otherHostelId }, staffPrincipal),
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", status: 404 });
  });
});

describe("food ready announcements", () => {
  /*
   * The clock is pinned, because `announceFoodReady` now gates on it: a meal
   * can only be called between half an hour before service and an hour after
   * it ends. The fixture serves lunch at `12 PM`, so 12:30 in Nepal is inside
   * every window these tests exercise — and without pinning, the whole
   * describe would pass in the afternoon and fail in the morning.
   */
  const noonish = new Date(Date.UTC(2026, 8, 7, 12, 30) - (5 * 60 + 45) * 60_000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(noonish);
    vi.clearAllMocks();
    mocks.platformSettingFindOne.mockReturnValue(leanResult(null));
    mocks.foodReadyFindOne.mockReturnValue(queryResult(null));
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", slug: "sunrise-hostel" }),
    );
    // `resolveResidentContact` falls back to the User row for a resident with
    // no email of their own. Stated here rather than inherited from whatever
    // the previous describe happened to leave behind.
    mocks.userFindOne.mockImplementation((filter: { _id?: unknown }) =>
      leanResult({ _id: filter._id, email: `${String(filter._id)}@example.com` }),
    );
    mocks.sendPushToUsers.mockResolvedValue({ revoked: 0, sent: 1, skipped: false });
    // One `findOne` mock answers both `getHostelName` (name) and
    // `resolveHostelStaffUserIds` (ownerId).
    mocks.hostelFindOne.mockReturnValue(
      queryResult({ name: "Sunrise Hostel", ownerId: ownerUserId }),
    );
    mocks.hostelMemberFind.mockReturnValue(leanResult([{ userId: wardenUserId }]));
    mocks.userFind.mockReturnValue(
      queryResult([{ _id: ownerUserId }, { _id: wardenUserId }]),
    );
    /*
     * No email on this resident, on purpose. The fan-out used to run through
     * an email resolver and dropped phone-only residents — who are the majority
     * here — even when they had the app installed and signed in.
     */
    mocks.residentFind.mockReturnValue(queryResult([{ userId: residentUserId }]));
    mocks.notificationCreate.mockResolvedValue({});
    mocks.foodReadyCreate.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({ ...input, _id: new Types.ObjectId() }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * The gate the cook's four buttons draw, enforced. Both directions are here
   * because they are opposite facts with opposite fixes: one is a cook who is
   * early, the other is a meal that went out without the building being told.
   */
  it("refuses a meal that is not due yet, and says when it opens", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 7, 8, 0) - (5 * 60 + 45) * 60_000));

    await expect(
      announceFoodReady({ deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true }, cookPrincipal),
    ).rejects.toMatchObject({ errorCode: "MEAL_NOT_DUE", status: 409 });
  });

  it("refuses a meal whose window has closed, under its own error code", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));
    // Lunch is served at 12 PM, so the window shuts at 2 PM.
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 7, 16, 0) - (5 * 60 + 45) * 60_000));

    await expect(
      announceFoodReady({ deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true }, cookPrincipal),
    ).rejects.toMatchObject({ errorCode: "MEAL_WINDOW_CLOSED", status: 409 });
  });

  /*
   * The deliberate default, and the reason the gate cannot take a hostel's
   * kitchen down: an unreadable or absent timing is no gate at all.
   */
  it("does not gate a meal whose routine has no readable clock", async () => {
    mocks.routineFindOne.mockReturnValue(leanResult(null));
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 7, 2, 0) - (5 * 60 + 45) * 60_000));

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "DINNER", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.message).toBe("Dinner is ready.");
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

  it("sends one batched high-priority push rather than one per resident", async () => {
    const second = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0d1");

    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));
    mocks.residentFind.mockReturnValue(
      queryResult([{ userId: residentUserId }, { userId: second }]),
    );

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.notifiedCount).toBe(2);

    // Two durable rows, because those are per-recipient documents...
    const residentRows = mocks.notificationCreate.mock.calls.filter(
      ([row]) => row.title === "Food is ready",
    );
    expect(residentRows).toHaveLength(2);

    // ...but one push, carrying both of them, at the priority that wakes a
    // dozing handset. Each row must not fire its own — that is the fan-out
    // `after()` was silently truncating.
    expect(mocks.dispatchPush).not.toHaveBeenCalled();
    expect(mocks.sendPushToUsers).toHaveBeenCalledWith(
      [residentUserId.toString(), second.toString()],
      expect.objectContaining({
        body: "Today's lunch: Dal",
        category: "FOOD",
        priority: "HIGH",
        title: "Food is ready",
      }),
    );
  });

  it("tells the office the kitchen called it, with the reach and the handset", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));

    const result = await announceFoodReady(
      {
        deviceInfo: { brand: "Redmi", model: "Redmi Note 12" },
        mealType: "LUNCH",
        useMenuDescription: true,
      },
      cookPrincipal,
    );

    expect(result.announcement.staffNotifiedCount).toBe(2);

    const staffRows = mocks.notificationCreate.mock.calls.filter(
      ([row]) => row.title === "Kitchen announced lunch",
    );

    // Owner and warden, and a warden is not being told their dinner is ready.
    expect(staffRows.map(([row]) => row.userId)).toEqual([
      ownerUserId.toString(),
      wardenUserId.toString(),
    ]);
    expect(staffRows[0][0].body).toContain("1 resident(s) notified.");
    // The brand is not repeated: `Redmi Redmi Note 12` is what naive
    // concatenation produces on most Xiaomi handsets.
    expect(staffRows[0][0].body).toContain("Announced from Redmi Note 12.");
    expect(staffRows[0][0].body).toContain("Sunrise Hostel");
    // A shared kitchen login has no accountability beyond the handset, so this
    // must never quietly become an unresolved ACTION row in a warden's bell.
    expect(staffRows[0][0].kind).toBe("NORMAL");
    expect(staffRows[0][0].priority).toBe("NORMAL");
    // `audience` is what routes the tap to `(admin)/today` — see `push-routing`.
    expect(staffRows[0][0].data).toMatchObject({ audience: "STAFF", mealType: "LUNCH" });

    expect(mocks.sendPushToUsers).toHaveBeenCalledWith(
      [ownerUserId.toString(), wardenUserId.toString()],
      expect.objectContaining({ priority: "NORMAL", title: "Kitchen announced lunch" }),
    );
  });

  it("still announces when the hostel has no staff to tell", async () => {
    mocks.routineFindOne.mockReturnValue(routineWithLunch(["Dal"]));
    mocks.hostelFindOne.mockReturnValue(queryResult({ name: "Sunrise Hostel" }));
    mocks.hostelMemberFind.mockReturnValue(leanResult([]));

    const result = await announceFoodReady(
      { deviceInfo: {}, mealType: "LUNCH", useMenuDescription: true },
      cookPrincipal,
    );

    expect(result.announcement.staffNotifiedCount).toBe(0);
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
    ).rejects.toMatchObject({ errorCode: "NOT_FOUND", status: 404 });
  });
});
