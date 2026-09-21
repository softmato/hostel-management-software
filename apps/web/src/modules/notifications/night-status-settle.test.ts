import { Types } from "mongoose";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/db", () => ({ connectToDatabase: vi.fn() }));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: { updateMany: mocks.updateMany },
}));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: { deleteOne: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn() },
}));

import { settleNightStatusNotifications } from "@/modules/notifications/notification.service";

const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fc01").toString();

describe("settleNightStatusNotifications", () => {
  it("writes the answer on tonight's row and dismisses older unanswered ones", async () => {
    mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
    const answer = { reasonCode: "HOME", status: "OUTSIDE_HOSTEL" };

    await settleNightStatusNotifications(userId, "2026-09-21", answer);

    const [[tonightFilter, tonightUpdate], [olderFilter, olderUpdate]] =
      mocks.updateMany.mock.calls;

    // Tonight's row is rewritten whatever its state, so a changed answer shows.
    expect(tonightFilter).toMatchObject({ category: "NIGHT_STATUS", "data.night": "2026-09-21" });
    expect(tonightFilter).not.toHaveProperty("actionState");
    expect(tonightUpdate.$set).toMatchObject({
      actionState: "COMPLETED",
      actionTakenKey: "OUTSIDE_HOSTEL",
      "data.answer": answer,
    });
    expect(olderFilter).toMatchObject({
      actionState: "PENDING",
      "data.night": { $ne: "2026-09-21" },
    });
    expect(olderUpdate.$set.actionState).toBe("DISMISSED");
  });
});
