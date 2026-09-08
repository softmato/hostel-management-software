import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who is told that the rate card changed, and what they are told.
 *
 * The rule under test is that a resident hears about **their own** rent and
 * nothing else. Everything below is a way the naive version — "the card
 * changed, tell everybody" — says something false to somebody.
 */
const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  hostelName: vi.fn(),
  residents: vi.fn(),
  users: vi.fn(),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: mocks.createNotification,
}));

vi.mock("@/modules/residents/resident-notify", () => ({
  getHostelName: mocks.hostelName,
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: {
    find: () => ({ select: () => ({ lean: mocks.residents }) }),
  },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: {
    find: () => ({ select: () => ({ lean: mocks.users }) }),
  },
}));

import { notifyRateCardChanged } from "@/modules/finance/rate-card-notify";

const hostelId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0a1");
const ashaId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b1");
const binodId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0f0b2");

/** Both residents live, so `liveUserIds` is not what any test below turns on. */
function residentsAre(rows: { roomType: string; userId: Types.ObjectId }[]) {
  mocks.residents.mockResolvedValue(rows);
  mocks.users.mockResolvedValue(rows.map((row) => ({ _id: row.userId })));
}

function notify(overrides: Record<string, unknown> = {}) {
  return notifyRateCardChanged({
    effectiveFrom: new Date("2026-10-18T00:00:00.000Z"),
    hostelId,
    previousRates: [
      { monthlyAmount: 6000, roomType: "FOUR_SHARING" },
      { monthlyAmount: 18000, roomType: "SINGLE_ROOM" },
    ],
    rates: [
      { monthlyAmount: 7000, roomType: "FOUR_SHARING" },
      { monthlyAmount: 18000, roomType: "SINGLE_ROOM" },
    ],
    ...overrides,
  });
}

describe("notifyRateCardChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hostelName.mockResolvedValue("Everest Hostel");
    residentsAre([
      { roomType: "FOUR_SHARING", userId: ashaId },
      { roomType: "SINGLE_ROOM", userId: binodId },
    ]);
  });

  it("writes only to the residents whose own room type moved", async () => {
    await notify();

    expect(mocks.createNotification).toHaveBeenCalledTimes(1);

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.userId).toBe(ashaId.toString());
    expect(call.category).toBe("PAYMENT");
    expect(call.body).toContain("6,000");
    expect(call.body).toContain("7,000");
  });

  it("says the rent is going up, and names the month it starts", async () => {
    await notify();

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.title).toBe("Your rent is going up");
    // Bhadra-dated card lands in a BS month, not an ISO date.
    expect(call.body).toMatch(/From \w+/);
    expect(call.body).toContain("rises");
  });

  it("reports a reduction as a change rather than a rise", async () => {
    await notify({
      rates: [
        { monthlyAmount: 5000, roomType: "FOUR_SHARING" },
        { monthlyAmount: 18000, roomType: "SINGLE_ROOM" },
      ],
    });

    const call = mocks.createNotification.mock.calls[0][0];

    expect(call.title).toBe("Your rent is changing");
    expect(call.body).toContain("falls");
  });

  /**
   * The admission fee and the deposit are charged once, at intake. Somebody who
   * already lives here will never pay either again, so a card that moved only
   * those has changed nothing for them — and "your rent has changed" would be
   * a false statement sent to every resident of the hostel.
   */
  it("stays silent when no rent moved", async () => {
    await notify({
      rates: [
        { monthlyAmount: 6000, roomType: "FOUR_SHARING" },
        { monthlyAmount: 18000, roomType: "SINGLE_ROOM" },
      ],
    });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  /** A first card has priced nobody, so there is no "from" to name. */
  it("stays silent on a hostel's first rate card", async () => {
    await notify({ previousRates: null });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  /**
   * A gap in the card, not a rent of zero. Guessing a number here would be the
   * one thing worse than the silence this module exists to end.
   */
  it("skips a resident whose room type is absent from the new card", async () => {
    await notify({ rates: [{ monthlyAmount: 7000, roomType: "TWO_SHARING" }] });

    expect(mocks.createNotification).not.toHaveBeenCalled();
  });

  it("never lets a notification failure escape into the rate change", async () => {
    mocks.createNotification.mockRejectedValue(new Error("mongo is down"));

    await expect(notify()).resolves.toBeUndefined();
  });
});
