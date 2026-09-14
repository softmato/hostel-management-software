import { describe, expect, it } from "vitest";

import { nepalWallClockToUtc, nextOccurrence } from "./platform-push-schedule";

// 2026-09-15 is a Tuesday. 09:00 Nepal = 03:15 UTC.
const at = (iso: string) => new Date(iso);

describe("nextOccurrence", () => {
  it("converts Nepal wall-clock to UTC", () => {
    expect(nepalWallClockToUtc("2026-09-15", "09:00").toISOString()).toBe(
      "2026-09-15T03:15:00.000Z",
    );
  });

  it("returns a future ONCE and nothing once it has passed", () => {
    const timing = { repeat: "ONCE" as const, startsOn: "2026-09-15", time: "09:00" };

    expect(nextOccurrence(timing, at("2026-09-15T03:00:00Z"))?.toISOString()).toBe(
      "2026-09-15T03:15:00.000Z",
    );
    expect(nextOccurrence(timing, at("2026-09-15T03:15:00Z"))).toBeNull();
  });

  it("rolls DAILY to tomorrow when today's time is gone", () => {
    const timing = { repeat: "DAILY" as const, startsOn: "2026-09-01", time: "09:00" };

    expect(nextOccurrence(timing, at("2026-09-15T05:00:00Z"))?.toISOString()).toBe(
      "2026-09-16T03:15:00.000Z",
    );
  });

  it("uses the Nepal date, not the UTC one, near midnight", () => {
    // 20:00 UTC on the 15th is 01:45 on the 16th in Nepal.
    const timing = { repeat: "DAILY" as const, startsOn: "2026-09-01", time: "06:00" };

    expect(nextOccurrence(timing, at("2026-09-15T20:00:00Z"))?.toISOString()).toBe(
      "2026-09-16T00:15:00.000Z",
    );
  });

  it("stops a repeat after endsOn", () => {
    const timing = {
      endsOn: "2026-09-15",
      repeat: "DAILY" as const,
      startsOn: "2026-09-01",
      time: "09:00",
    };

    expect(nextOccurrence(timing, at("2026-09-15T05:00:00Z"))).toBeNull();
  });

  it("finds the next picked weekday", () => {
    // Tuesday after 09:00 → next Friday (5).
    const timing = {
      repeat: "WEEKLY" as const,
      startsOn: "2026-09-01",
      time: "09:00",
      weekdays: [5],
    };

    expect(nextOccurrence(timing, at("2026-09-15T05:00:00Z"))?.toISOString()).toBe(
      "2026-09-18T03:15:00.000Z",
    );
    expect(nextOccurrence({ ...timing, weekdays: [] }, at("2026-09-15T05:00:00Z"))).toBeNull();
  });

  it("waits for a future startsOn", () => {
    const timing = { repeat: "DAILY" as const, startsOn: "2026-10-01", time: "09:00" };

    expect(nextOccurrence(timing, at("2026-09-15T05:00:00Z"))?.toISOString()).toBe(
      "2026-10-01T03:15:00.000Z",
    );
  });
});
