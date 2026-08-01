import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  postCreate: vi.fn(),
  postFind: vi.fn(),
  reactionFind: vi.fn(),
  residentFindOne: vi.fn(),
  userFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/CommunityPost", () => ({
  CommunityPostModel: {
    create: mocks.postCreate,
    find: mocks.postFind,
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/CommunityComment", () => ({
  CommunityCommentModel: { create: vi.fn(), find: vi.fn() },
}));

vi.mock("@hostel/db/models/CommunityReaction", () => ({
  CommunityReactionModel: {
    deleteOne: vi.fn(),
    find: mocks.reactionFind,
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/CommunityReport", () => ({
  CommunityReportModel: { create: vi.fn(), findOne: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@hostel/db/models/Resident", () => ({
  ResidentModel: { findOne: mocks.residentFindOne },
}));

vi.mock("@hostel/db/models/User", () => ({
  UserModel: { find: mocks.userFind },
}));

vi.mock("@hostel/db/models/AuditLog", () => ({ AuditLogModel: { create: vi.fn() } }));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(),
}));

import {
  createCommunityPost,
  listCommunityFeed,
  listCommunityForModeration,
} from "@/modules/community/community.service";
import { maskProfanity } from "@/modules/community/profanity";

const hostelId = "64f0f0f0f0f0f0f0f0f0fa01";
const residentId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fa02");
const authorUserId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fa03");
const postId = new Types.ObjectId("64f0f0f0f0f0f0f0f0f0fa04");

const residentPrincipal = {
  hostelIds: [hostelId],
  role: Role.RESIDENT,
  sessionId: "session-c",
  userId: authorUserId.toString(),
};

const staffPrincipal = {
  hostelIds: [hostelId],
  role: Role.HOSTEL_ADMIN,
  sessionId: "session-s",
  userId: "64f0f0f0f0f0f0f0f0f0fa05",
};

function leanResult<T>(value: T) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

function queryResult<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

function anonymousPost() {
  return {
    _id: postId,
    authorId: authorUserId,
    body: "The night warden is never at the desk.",
    commentCount: 0,
    hostelId: new Types.ObjectId(hostelId),
    isAnnouncement: false,
    isAnonymous: true,
    mediaAssetIds: [],
    reactionCount: 0,
    reportCount: 2,
    status: "VISIBLE" as const,
    visibility: "HOSTEL_ONLY" as const,
  };
}

describe("community anonymity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.residentFindOne.mockReturnValue(
      leanResult({
        _id: residentId,
        depositAmount: 0,
        firstName: "Asha",
        hostelId: new Types.ObjectId(hostelId),
        lastName: "Rai",
        moveInDate: new Date("2030-01-01T00:00:00.000Z"),
        phone: "9800000000",
        roomType: "DOUBLE",
        status: "ACTIVE",
        userId: authorUserId,
      }),
    );
    mocks.userFind.mockReturnValue(
      queryResult([{ _id: authorUserId, name: "Asha Rai" }]),
    );
    mocks.reactionFind.mockReturnValue(leanResult([]));
  });

  it("hides the author's name from other residents", async () => {
    mocks.postFind.mockReturnValue(queryResult([anonymousPost()]));

    const { posts } = await listCommunityFeed({ scope: "hostel" }, residentPrincipal);

    expect(posts[0].authorName).toBe("Anonymous Resident");
    expect(JSON.stringify(posts[0])).not.toContain("Asha Rai");
    // Report counts are moderation data, not feed data.
    expect(posts[0].reportCount).toBeUndefined();
  });

  it("still stores the real author id so moderation can act", async () => {
    mocks.postCreate.mockResolvedValue(anonymousPost());

    await createCommunityPost(
      {
        body: "The night warden is never at the desk.",
        isAnonymous: true,
        mediaAssetIds: [],
        visibility: "HOSTEL_ONLY",
      },
      residentPrincipal,
    );

    expect(mocks.postCreate).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: residentPrincipal.userId, isAnonymous: true }),
    );
  });

  it("reveals the author to a hostel admin reviewing reports", async () => {
    mocks.postFind.mockReturnValue(queryResult([anonymousPost()]));

    const { posts, summary } = await listCommunityForModeration({}, staffPrincipal);

    expect(posts[0].authorName).toBe("Asha Rai");
    expect(posts[0].reportCount).toBe(2);
    expect(summary).toMatchObject({ reported: 1, total: 1 });
  });

  it("masks obvious profanity on the way in", () => {
    expect(maskProfanity("this food is shit honestly")).toBe(
      "this food is **** honestly",
    );
    expect(maskProfanity("perfectly fine sentence")).toBe("perfectly fine sentence");
  });
});
