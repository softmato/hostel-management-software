import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  batched: vi.fn(),
  connectToDatabase: vi.fn(),
  postFindOne: vi.fn(),
  postUpdateOne: vi.fn(),
  reactionCountDocuments: vi.fn(),
  reactionDeleteOne: vi.fn(),
  reactionFindOne: vi.fn(),
  reactionUpdateOne: vi.fn(),
  residentFindOne: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/CommunityPost", () => ({
  CommunityPostModel: {
    countDocuments: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    findOne: mocks.postFindOne,
    findOneAndUpdate: vi.fn(),
    updateOne: mocks.postUpdateOne,
  },
}));

vi.mock("@hostel/db/models/CommunityComment", () => ({
  CommunityCommentModel: { countDocuments: vi.fn(), create: vi.fn(), find: vi.fn() },
}));

vi.mock("@hostel/db/models/CommunityReaction", () => ({
  CommunityReactionModel: {
    countDocuments: mocks.reactionCountDocuments,
    deleteOne: mocks.reactionDeleteOne,
    find: vi.fn(),
    findOne: mocks.reactionFindOne,
    updateOne: mocks.reactionUpdateOne,
  },
}));

vi.mock("@hostel/db/models/CommunityReport", () => ({
  CommunityReportModel: { create: vi.fn(), findOne: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({ UserModel: { find: vi.fn() } }));
vi.mock("@hostel/db/models/AuditLog", () => ({ AuditLogModel: { create: vi.fn() } }));

vi.mock("@/modules/community/community-settings", () => ({
  getCommunitySettings: vi
    .fn()
    .mockResolvedValue({ enabled: true, profanityFilterEnabled: true }),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(),
  createOrUpdateBatchedNotification: mocks.batched,
}));

import { reactToPost } from "@/modules/community/community.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0fb01";
const authorUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fb02");
const reactorUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fb03");
const postId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fb04");

function principalFor(userId: Types.ObjectId) {
  return {
    hostelIds: [hostelId],
    role: Role.RESIDENT,
    sessionId: "session-r",
    userId: userId.toString(),
  };
}

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function post() {
  return {
    _id: postId,
    authorId: authorUserId,
    body: "Anyone up for futsal on Saturday?",
    commentCount: 0,
    hostelId: new Types.ObjectId(hostelId),
    isAnnouncement: false,
    media: [],
    spaceType: "HOSTEL" as const,
    reactionCount: 0,
    reportCount: 0,
    status: "VISIBLE" as const,
    visibility: "HOSTEL_ONLY" as const,
  };
}

function residentIn(userId: Types.ObjectId) {
  return leanResult({
    _id: new Types.ObjectId(),
    depositAmount: 0,
    firstName: "Bina",
    hostelId: new Types.ObjectId(hostelId),
    lastName: "Thapa",
    moveInDate: new Date("2030-01-01T00:00:00.000Z"),
    phone: "9800000000",
    roomType: "DOUBLE",
    status: "ACTIVE",
    userId,
  });
}

describe("community reaction notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postFindOne.mockReturnValue(leanResult(post()));
    mocks.residentFindOne.mockReturnValue(residentIn(reactorUserId));
    mocks.reactionFindOne.mockReturnValue(leanResult(null));
    mocks.reactionCountDocuments.mockResolvedValue(1);
  });

  it("notifies the author, batched under one dedupe key per post", async () => {
    await reactToPost(postId.toString(), { type: "LIKE" }, principalFor(reactorUserId));

    expect(mocks.batched).toHaveBeenCalledTimes(1);
    const call = mocks.batched.mock.calls[0][0];

    expect(call.userId).toBe(authorUserId.toString());
    expect(call.category).toBe("COMMUNITY");
    expect(call.dedupeKey).toBe(`community-reaction:${postId.toString()}`);
    expect(call.body).toBe("Someone reacted to your community post.");
  });

  it("counts reactors rather than emitting one notification each", async () => {
    mocks.reactionCountDocuments.mockResolvedValue(5);

    await reactToPost(postId.toString(), { type: "LOVE" }, principalFor(reactorUserId));

    expect(mocks.batched).toHaveBeenCalledTimes(1);
    expect(mocks.batched.mock.calls[0][0].body).toBe(
      "5 people reacted to your community post.",
    );
  });

  it("never names the reactor", async () => {
    await reactToPost(postId.toString(), { type: "LIKE" }, principalFor(reactorUserId));

    expect(JSON.stringify(mocks.batched.mock.calls[0][0])).not.toContain(
      reactorUserId.toString(),
    );
  });

  it("says nothing when the author reacts to their own post", async () => {
    mocks.residentFindOne.mockReturnValue(residentIn(authorUserId));

    await reactToPost(postId.toString(), { type: "LIKE" }, principalFor(authorUserId));

    expect(mocks.batched).not.toHaveBeenCalled();
  });

  it("says nothing when an existing reactor only switches reaction type", async () => {
    mocks.reactionFindOne.mockReturnValue(
      leanResult({ _id: new Types.ObjectId(), type: "LIKE" }),
    );

    await reactToPost(postId.toString(), { type: "LOVE" }, principalFor(reactorUserId));

    expect(mocks.batched).not.toHaveBeenCalled();
  });

  it("says nothing when a reaction is removed", async () => {
    mocks.reactionFindOne.mockReturnValue(
      leanResult({ _id: new Types.ObjectId(), type: "LIKE" }),
    );

    const result = await reactToPost(
      postId.toString(),
      { type: "LIKE" },
      principalFor(reactorUserId),
    );

    expect(result.reaction).toBeNull();
    expect(mocks.batched).not.toHaveBeenCalled();
  });

  it("still records the reaction when the notification fails", async () => {
    mocks.batched.mockRejectedValue(new Error("mongo down"));

    const result = await reactToPost(
      postId.toString(),
      { type: "LIKE" },
      principalFor(reactorUserId),
    );

    expect(result.reaction).toBe("LIKE");
    expect(mocks.reactionUpdateOne).toHaveBeenCalled();
  });
});
