import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  create: vi.fn(),
  findOneAndUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/Notification", () => ({
  NotificationModel: {
    countDocuments: vi.fn(),
    create: mocks.create,
    find: vi.fn(),
    findOneAndUpdate: mocks.findOneAndUpdate,
    updateMany: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/DeviceToken", () => ({
  DeviceTokenModel: { deleteOne: vi.fn(), find: vi.fn(), findOneAndUpdate: vi.fn() },
}));

import { createOrUpdateBatchedNotification } from "@/modules/notifications/notification.service";

const userId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fc01").toString();

const input = {
  body: "3 people reacted to your community post.",
  category: "COMMUNITY",
  data: { postId: "post-1" },
  dedupeKey: "community-reaction:post-1",
  title: "New reaction",
  userId,
};

describe("createOrUpdateBatchedNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites the existing unread row instead of adding another", async () => {
    mocks.findOneAndUpdate.mockResolvedValue({ _id: "existing" });

    await createOrUpdateBatchedNotification(input);

    expect(mocks.create).not.toHaveBeenCalled();

    const [filter, update] = mocks.findOneAndUpdate.mock.calls[0];

    expect(filter["data.dedupeKey"]).toBe("community-reaction:post-1");
    expect(filter.category).toBe("COMMUNITY");
    // Reusing a read row would mutate something the user has already seen.
    expect(filter.readAt).toEqual({ $exists: false });
    expect(update.$set.body).toBe(input.body);
    // Bumped so the rewritten row surfaces at the top of the feed again.
    expect(update.$set.createdAt).toBeInstanceOf(Date);
  });

  it("writes a fresh row when no unread row matches the key", async () => {
    mocks.findOneAndUpdate.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ _id: "new" });

    await createOrUpdateBatchedNotification(input);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toEqual({
      dedupeKey: "community-reaction:post-1",
      postId: "post-1",
    });
  });

  it("keeps the dedupe key on the row so the next event can find it", async () => {
    mocks.findOneAndUpdate.mockResolvedValue({ _id: "existing" });

    await createOrUpdateBatchedNotification(input);

    expect(mocks.findOneAndUpdate.mock.calls[0][1].$set.data.dedupeKey).toBe(
      "community-reaction:post-1",
    );
  });
});
