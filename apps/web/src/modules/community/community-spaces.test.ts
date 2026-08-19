import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Role } from "@/lib/roles";

/**
 * The two rules that make `/community` one room instead of a leak.
 *
 * 1. The *author* never picks a space. Whether a post lands in the public space
 *    or a hostel's is decided by the account, so a public account cannot post
 *    into someone's hostel and a resident cannot quietly post around theirs.
 * 2. The *reader* never sees a HOSTEL_ONLY post they are not a member for —
 *    including a signed-out reader, who is exactly who the open feed exists for.
 *
 * Both are enforced in the service, so both are tested there. A UI that forgets
 * to hide the visibility toggle must not be able to widen anyone's audience.
 */

const mocks = vi.hoisted(() => ({
  connectToDatabase: vi.fn(),
  hostelFind: vi.fn(),
  userFind: vi.fn(),
  postCountDocuments: vi.fn(),
  postCreate: vi.fn(),
  postFind: vi.fn(),
  reactionFind: vi.fn(),
  reactionAggregate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ connectToDatabase: mocks.connectToDatabase }));

vi.mock("@hostel/db/models/CommunityPost", () => ({
  CommunityPostModel: {
    aggregate: vi.fn(),
    countDocuments: mocks.postCountDocuments,
    create: mocks.postCreate,
    find: mocks.postFind,
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/CommunityComment", () => ({
  CommunityCommentModel: { countDocuments: vi.fn(), create: vi.fn(), find: vi.fn() },
}));

vi.mock("@hostel/db/models/CommunityReaction", () => ({
  CommunityReactionModel: {
    aggregate: mocks.reactionAggregate,
    countDocuments: vi.fn(),
    deleteOne: vi.fn(),
    find: mocks.reactionFind,
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("@hostel/db/models/CommunityReport", () => ({
  CommunityReportModel: { create: vi.fn(), find: vi.fn(), findOne: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@hostel/db/models/Hostel", () => ({ HostelModel: { find: mocks.hostelFind } }));
vi.mock("@hostel/db/models/User", () => ({ UserModel: { find: mocks.userFind } }));
vi.mock("@hostel/db/models/AuditLog", () => ({ AuditLogModel: { create: vi.fn() } }));
vi.mock("@hostel/db/models/Resident", () => ({ ResidentModel: { findOne: vi.fn() } }));

vi.mock("@/modules/community/community-settings", () => ({
  getCommunitySettings: vi
    .fn()
    .mockResolvedValue({ enabled: true, profanityFilterEnabled: false }),
}));

vi.mock("@/modules/notifications/notification.service", () => ({
  createInAppNotification: vi.fn(),
  createOrUpdateBatchedNotification: vi.fn(),
}));

import {
  createCommunityPost,
  listCommunityFeed,
} from "@/modules/community/community.service";

const hostelId = "64f0f0f0f0f0f0f0f0f0fc01";
const userId = "64f0f0f0f0f0f0f0f0f0fc02";

function createdPost() {
  return {
    _id: new Types.ObjectId(),
    authorId: new Types.ObjectId(userId),
    body: "Hello",
    commentCount: 0,
    hostelId: null,
    isAnnouncement: false,
    media: [],
    reactionCount: 0,
    reportCount: 0,
    spaceType: "PUBLIC" as const,
    status: "VISIBLE" as const,
    visibility: "PUBLIC" as const,
  };
}

function chainableFind(rows: unknown[]) {
  const chain = {
    lean: vi.fn().mockResolvedValue(rows),
    limit: vi.fn(() => chain),
    skip: vi.fn(() => chain),
    sort: vi.fn(() => chain),
  };

  return chain;
}

describe("community spaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postCreate.mockResolvedValue(createdPost());
    mocks.postFind.mockReturnValue(chainableFind([]));
    mocks.postCountDocuments.mockResolvedValue(0);
    mocks.reactionFind.mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    // The per-type tally `decoratePosts` groups for the reaction row. Nothing in
    // this file asserts on it — these tests are about who can read what — so it
    // answers "no reactions" and stays out of the way.
    mocks.reactionAggregate.mockResolvedValue([]);
    const selectable = {
      lean: vi.fn().mockResolvedValue([]),
      select: vi.fn(() => selectable),
    };

    mocks.userFind.mockReturnValue(selectable);
    mocks.hostelFind.mockReturnValue(selectable);
  });

  it("posts a hostel-less account into the public space, forcing PUBLIC visibility", async () => {
    await createCommunityPost(
      { body: "Looking for a hostel near Baneshwor", media: [], visibility: "HOSTEL_ONLY" },
      { hostelIds: [], role: Role.PUBLIC, userId },
    );

    const created = mocks.postCreate.mock.calls[0][0];

    expect(created.spaceType).toBe("PUBLIC");
    expect(created.hostelId).toBeNull();
    // There is no smaller room for a public-space post to hide in, so the
    // author's HOSTEL_ONLY choice cannot be honoured — and must not be stored.
    expect(created.visibility).toBe("PUBLIC");
  });

  it("posts a resident into their own hostel's space and honours HOSTEL_ONLY", async () => {
    await createCommunityPost(
      { body: "Water is off in block B", media: [], visibility: "HOSTEL_ONLY" },
      { hostelIds: [hostelId], role: Role.RESIDENT, userId },
    );

    const created = mocks.postCreate.mock.calls[0][0];

    expect(created.spaceType).toBe("HOSTEL");
    expect(created.hostelId?.toString()).toBe(hostelId);
    expect(created.visibility).toBe("HOSTEL_ONLY");
  });

  it("never shows a signed-out reader anything but PUBLIC posts", async () => {
    await listCommunityFeed({ page: 1, pageSize: 20, sort: "new", space: "all" }, null);

    const filter = mocks.postFind.mock.calls[0][0];

    expect(filter.$and).toContainEqual({ $or: [{ visibility: "PUBLIC" }] });
    expect(filter.$and).toContainEqual({ status: "VISIBLE" });
  });

  it("widens the reader's filter to the hostels they belong to, and no further", async () => {
    await listCommunityFeed({ page: 1, pageSize: 20, sort: "new", space: "all" }, {
      hostelIds: [hostelId],
      role: Role.RESIDENT,
      userId,
    });

    const filter = mocks.postFind.mock.calls[0][0];
    const readable = filter.$and.find((clause: Record<string, unknown>) => "$or" in clause);

    expect(readable.$or).toHaveLength(2);
    expect(readable.$or[1].hostelId.$in.map(String)).toEqual([hostelId]);
  });

  it("gives a signed-out reader an empty 'my hostel' rather than everyone's", async () => {
    await listCommunityFeed({ page: 1, pageSize: 20, sort: "new", space: "mine" }, null);

    const filter = mocks.postFind.mock.calls[0][0];

    expect(filter.$and).toContainEqual({ hostelId: { $in: [] } });
  });
});
