import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  planId: "pro" as string | null,
  residents: 0,
}));

const lean = <T>(value: () => T) => ({ select: () => ({ lean: async () => value() }) });

vi.mock("@hostel/db/models/HostelSubscription", () => ({
  HostelSubscriptionModel: { findOne: () => lean(() => (mocks.planId ? { planId: mocks.planId } : null)) },
}));
vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { countDocuments: async () => mocks.residents },
}));
vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { findById: () => lean(() => ({ slug: "sunrise" })) } }));
vi.mock("@hostel/db/models/HostelMember", () => ({ HostelMemberModel: {} }));
vi.mock("@hostel/db/models/CookAccount", () => ({ CookAccountModel: {} }));
vi.mock("@/modules/platform-config/site-config.service", () => ({
  getSiteConfigSection: async () => ({
    plans: [{ id: "pro", maxResidents: 100, name: "Pro", portalAccess: { cooks: 3, wardens: 2 } }],
  }),
}));
vi.mock("@/modules/residents/resident-notify", () => ({
  resolveHostelAdminContacts: async () => [{ email: "a@b.c", userId: "u1" }],
}));
vi.mock("@/modules/notifications/notification.service", () => ({ createInAppNotification: mocks.notify }));

import { assertPlanRoom } from "@/modules/billing/plan-limits";

const hostelId = new Types.ObjectId();

describe("assertPlanRoom", () => {
  beforeEach(() => {
    mocks.notify.mockReset().mockResolvedValue(undefined);
    mocks.planId = "pro";
  });

  it("lets the 100th resident in and stops the 101st, telling the admins", async () => {
    mocks.residents = 99;
    await expect(assertPlanRoom(hostelId, "residents")).resolves.toBeUndefined();

    mocks.residents = 100;
    await expect(assertPlanRoom(hostelId, "residents")).rejects.toMatchObject({
      errorCode: "PLAN_LIMIT_REACHED",
      message: expect.stringContaining("Please upgrade your plan"),
      status: 409,
    });
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ category: "PAYMENT", data: expect.objectContaining({ type: "PLAN_DUE" }) }),
    );
  });

  it("counts a whole list being added at once", async () => {
    mocks.residents = 90;
    await expect(assertPlanRoom(hostelId, "residents", 11)).rejects.toMatchObject({ status: 409 });
  });

  it("never blocks a hostel with no plan chosen", async () => {
    mocks.planId = null;
    mocks.residents = 10_000;
    await expect(assertPlanRoom(hostelId, "residents")).resolves.toBeUndefined();
  });
});
