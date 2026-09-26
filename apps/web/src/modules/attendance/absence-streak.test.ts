import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(),
}));
vi.mock("@/modules/residents/resident-notify", () => ({}));

import { absenceStreak } from "@/modules/attendance/attendance-jobs.service";

const today = new Date("2026-09-25T00:00:00.000Z");

describe("absenceStreak", () => {
  it("does not count days before the resident was registered", () => {
    const registeredYesterday = new Date("2026-09-24T00:00:00.000Z");

    expect(absenceStreak(new Map(), today, 14, registeredYesterday)).toBe(2);
  });

  it("still reaches the threshold for a long-standing silent resident", () => {
    expect(absenceStreak(new Map(), today, 14, new Date(0))).toBe(14);
  });

  it("stops at the first day the resident was seen", () => {
    const seen = new Map([["2026-09-23", "INSIDE" as const]]);

    expect(absenceStreak(seen, today, 14, new Date(0))).toBe(2);
  });
});
