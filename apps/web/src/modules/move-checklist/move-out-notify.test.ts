import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What somebody is told when their stay is closed.
 *
 * The deposit is the point. A move-out checklist decides whether the resident
 * gets their money back, and that decision used to be recorded, audited and
 * never communicated — so every assertion below is about the sentence that
 * carries it.
 */
const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  hostelName: vi.fn(),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createNotification,
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  getHostelName: mocks.hostelName,
}));

import { notifyMoveOutCompleted } from "@/modules/move-checklist/move-out-notify";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");

function moveOut(overrides: Record<string, unknown> = {}) {
  return notifyMoveOutCompleted({
    depositAmount: 5000,
    depositDecision: "APPROVED",
    hostelId,
    resident: { userId },
    ...overrides,
  });
}

describe("notifyMoveOutCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelName.mockResolvedValue("Everest Hostel");
  });

  it("closes the stay and quotes an approved refund", async () => {
    await moveOut();

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.title).toBe("Your stay has ended");
    expect(call.body).toContain("closed");
    expect(call.body).toContain("5,000");
    expect(call.category).toBe("PAYMENT");
  });

  it("says nothing about a deposit when none was held", async () => {
    await moveOut({ depositAmount: 0 });

    expect(mocks.createNotification.mock.calls[0][0].body).toBe(
      "Your stay at Everest Hostel has been closed.",
    );
  });

  it("explains a partial refund rather than only naming the amount", async () => {
    await moveOut({ depositAmount: 3000, depositDecision: "PARTIAL" });

    const body = mocks.createNotification.mock.calls[0][0].body;

    expect(body).toContain("3,000");
    expect(body).toContain("the rest is held");
  });

  /** No amount is quoted for a forfeit — there is nothing coming back. */
  it("states a forfeit plainly and points at the office", async () => {
    await moveOut({ depositDecision: "FORFEITED" });

    const body = mocks.createNotification.mock.calls[0][0].body;

    expect(body).toContain("forfeited");
    expect(body).toContain("hostel office");
    expect(body).not.toContain("5,000");
  });

  /** Promising a number nobody has agreed to would be worse than saying so. */
  it("says the deposit is still open when no decision was taken", async () => {
    await moveOut({ depositDecision: "PENDING" });

    expect(mocks.createNotification.mock.calls[0][0].body).toContain(
      "still being settled",
    );
  });

  it("stays quiet for a resident with no linked account", async () => {
    await moveOut({ resident: { userId: null } });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("never lets a notification failure escape into the move-out", async () => {
    mocks.createNotification.mockRejectedValue(new Error("mongo is down"));

    await expect(moveOut()).resolves.toBeUndefined();
  });
});
