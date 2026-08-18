import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/NotificationPreference", () => ({
  NotificationPreferenceModel: {
    find: mocks.find,
    findOne: mocks.findOne,
    findOneAndUpdate: mocks.findOneAndUpdate,
  },
}));

import {
  DEFAULT_NOTIFICATION_PREFERENCE,
  filterPushRecipients,
  getNotificationPreference,
} from "@/modules/notifications/notification-preference.service";

/** `find().lean()` — the chain the service calls. */
function rowsResolveTo(rows: unknown[]) {
  mocks.find.mockReturnValue({ lean: () => Promise.resolve(rows) });
}

const night = new Date("2026-08-18T18:00:00Z"); // 23:45 in Kathmandu

describe("getNotificationPreference", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the defaults for an account with no row, and writes nothing", () => {
    // Reading a settings screen is not a statement of intent. A GET that
    // upserted would also make "how many people changed this?" unanswerable.
    mocks.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    return getNotificationPreference("user-1").then((preference) => {
      expect(preference).toEqual(DEFAULT_NOTIFICATION_PREFERENCE);
      expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});

describe("filterPushRecipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drops accounts inside their quiet hours and keeps the rest", async () => {
    rowsResolveTo([
      {
        pushEnabled: true,
        quietHoursEnabled: true,
        quietHoursEnd: 7 * 60,
        quietHoursStart: 22 * 60,
        timeZone: "Asia/Kathmandu",
        userId: "sleeping",
      },
      { pushEnabled: true, quietHoursEnabled: false, userId: "awake" },
    ]);

    await expect(
      filterPushRecipients(["sleeping", "awake"], { now: night }),
    ).resolves.toEqual(["awake"]);
  });

  it("keeps an account that has never set a preference", async () => {
    // No row comes back for them at all. The absence of an opinion is not an
    // opinion — reading it as "wants nothing" would mute every existing user.
    rowsResolveTo([{ pushEnabled: false, userId: "opted-out" }]);

    await expect(
      filterPushRecipients(["opted-out", "never-touched-it"], { now: night }),
    ).resolves.toEqual(["never-touched-it"]);
  });

  it("keeps everyone for an urgent alert without even querying", async () => {
    // SOS. Short-circuited before the database so a safety alert never waits on
    // a preference lookup, let alone gets filtered by one.
    await expect(
      filterPushRecipients(["sleeping"], { isUrgent: true, now: night }),
    ).resolves.toEqual(["sleeping"]);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("keeps everyone when the lookup fails", async () => {
    // Over-delivering during a database blip is recoverable. Silence is the
    // failure nobody reports.
    mocks.find.mockImplementation(() => {
      throw new Error("connection reset");
    });

    await expect(filterPushRecipients(["a", "b"], { now: night })).resolves.toEqual([
      "a",
      "b",
    ]);
  });

  it("respects a muted category", async () => {
    rowsResolveTo([
      { mutedCategories: ["COMMUNITY"], pushEnabled: true, userId: "quiet-community" },
    ]);

    await expect(
      filterPushRecipients(["quiet-community"], { category: "COMMUNITY" }),
    ).resolves.toEqual([]);
    await expect(
      filterPushRecipients(["quiet-community"], { category: "PAYMENT" }),
    ).resolves.toEqual(["quiet-community"]);
  });
});
