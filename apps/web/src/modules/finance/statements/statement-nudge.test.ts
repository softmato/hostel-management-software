/**
 * The upload nudge — Block 4 item 4.5 of docs/FINANCE_IMPLEMENTATION_PLAN.md
 * (target §6.4).
 *
 * Small, but the arithmetic is the whole feature: a nudge that never fires
 * leaves Tier 0.5 unused, and one that fires constantly gets dismissed as
 * furniture. Pure, so the clock is passed in.
 */
import { describe, expect, it } from "vitest";

import { buildStatementNudge } from "@/modules/finance/statements/statement-nudge";

const NOW = new Date(2026, 7, 20);

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 86_400_000);
}

describe("statement upload nudge", () => {
  it("nudges a hostel that has never uploaded, in its own words", () => {
    const nudge = buildStatementNudge({ cadenceDays: 7, lastUploadAt: null, now: NOW });

    expect(nudge.due).toBe(true);
    expect(nudge.daysSinceUpload).toBeNull();
    expect(nudge.message).toMatch(/first/i);
  });

  it("stays quiet inside the cadence", () => {
    expect(
      buildStatementNudge({ cadenceDays: 7, lastUploadAt: daysAgo(3), now: NOW }).due,
    ).toBe(false);
  });

  it("stays quiet on the cadence day itself", () => {
    // Exactly at the cadence is "on time", not "late" — nudging on day seven of
    // a seven-day rhythm means nudging somebody who is doing it right.
    expect(
      buildStatementNudge({ cadenceDays: 7, lastUploadAt: daysAgo(7), now: NOW }).due,
    ).toBe(false);
  });

  it("fires the day after", () => {
    const nudge = buildStatementNudge({
      cadenceDays: 7,
      lastUploadAt: daysAgo(8),
      now: NOW,
    });

    expect(nudge.due).toBe(true);
    expect(nudge.message).toContain("8 days");
  });

  it("honours a hostel's own cadence rather than a platform default", () => {
    expect(
      buildStatementNudge({ cadenceDays: 30, lastUploadAt: daysAgo(20), now: NOW }).due,
    ).toBe(false);
    expect(
      buildStatementNudge({ cadenceDays: 3, lastUploadAt: daysAgo(20), now: NOW }).due,
    ).toBe(true);
  });

  it("falls back to a weekly rhythm when the cadence is unusable", () => {
    expect(
      buildStatementNudge({ cadenceDays: 0, lastUploadAt: daysAgo(10), now: NOW }),
    ).toMatchObject({ cadenceDays: 7, due: true });
  });
});
