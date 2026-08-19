import { describe, expect, it } from "vitest";

import type { CommunityComment, CommunitySpaces } from "@/lib/community-api";
import { REACTION_TYPES } from "@/lib/community-enums";
import {
  audienceOptions,
  avatarTone,
  canPublish,
  commentCountLabel,
  compactCount,
  composerTarget,
  descendantIds,
  emptyFeedMessage,
  feedTime,
  hiddenCommentIds,
  MAX_POST_BODY,
  nextReaction,
  nextVote,
  postVisibility,
  REACTIONS,
  reactionTally,
  replyCounts,
  reportReasonError,
  spaceBadge,
  spaceChips,
  usableAvatarUrl,
} from "@/lib/community";

function comment(overrides: Partial<CommunityComment> = {}): CommunityComment {
  return {
    authorImage: null,
    authorName: "Sita",
    body: "…",
    depth: 0,
    id: "c1",
    isMine: false,
    parentId: null,
    score: 0,
    viewerVote: 0,
    ...overrides,
  };
}

function spaces(overrides: Partial<CommunitySpaces["viewer"]> = {}): CommunitySpaces {
  return {
    spaces: [
      { id: "public", isMine: false, name: "Public", postCount: 12 },
      { id: "h1", isMine: true, name: "Green View", postCount: 5 },
      { id: "h2", isMine: false, name: "Blue Sky", postCount: 3 },
    ],
    viewer: {
      canPost: true,
      hostelId: null,
      hostelName: null,
      spaceType: null,
      ...overrides,
    },
  };
}

describe("REACTIONS", () => {
  /*
   * The web renders four pills and calls the other two unused. Offering four of
   * six values the API accepts is the kind of quiet narrowing that becomes
   * permanent, and six emoji still fit a phone row.
   */
  it("covers every type the API accepts", () => {
    expect(REACTIONS.map((reaction) => reaction.type).sort()).toEqual(
      [...REACTION_TYPES].sort(),
    );
  });
});

describe("nextReaction", () => {
  it("adds one when there was none", () => {
    expect(nextReaction(null, "LIKE")).toEqual({ countDelta: 1, reaction: "LIKE" });
  });

  // The server deletes the row when the same type is sent again.
  it("clears when the same type is tapped", () => {
    expect(nextReaction("LIKE", "LIKE")).toEqual({ countDelta: -1, reaction: null });
  });

  /*
   * The case an optimistic `+1` gets wrong: `reactionCount` is one per *user*, so
   * swapping Like for Angry leaves the total alone.
   */
  it("does not move the count when swapping one reaction for another", () => {
    expect(nextReaction("LIKE", "ANGRY")).toEqual({ countDelta: 0, reaction: "ANGRY" });
  });
});

describe("reactionTally", () => {
  it("adds to a type nobody had chosen", () => {
    expect(reactionTally({}, null, "LIKE")).toEqual({ LIKE: 1 });
    expect(reactionTally({ LIKE: 4 }, null, "LIKE")).toEqual({ LIKE: 5 });
  });

  /*
   * The case the *total* gets right by doing nothing and the breakdown does not:
   * one key has to come down as the other goes up.
   */
  it("moves the count across when swapping one reaction for another", () => {
    expect(reactionTally({ ANGRY: 2, LIKE: 4 }, "LIKE", "ANGRY")).toEqual({
      ANGRY: 3,
      LIKE: 3,
    });
  });

  // Absent means nobody, in the tally and in the payload it mirrors — so the
  // last person to un-react takes the key with them.
  it("drops a key that reaches zero rather than leaving it at 0", () => {
    expect(reactionTally({ LIKE: 1 }, "LIKE", "LIKE")).toEqual({});
    expect(reactionTally({ LIKE: 1, LOVE: 2 }, "LIKE", "LOVE")).toEqual({ LOVE: 3 });
  });

  it("does not mutate the tally it was given", () => {
    const counts = { LIKE: 1 };

    reactionTally(counts, null, "LOVE");

    expect(counts).toEqual({ LIKE: 1 });
  });
});

describe("compactCount", () => {
  it("prints small counts as they are", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
  });

  it("shortens thousands with one decimal, and drops it past ten thousand", () => {
    expect(compactCount(1_000)).toBe("1k");
    expect(compactCount(1_250)).toBe("1.2k");
    expect(compactCount(47_800)).toBe("47k");
  });

  // `toFixed` would round this to "1000k". Truncating cannot.
  it("does not round up into the next unit", () => {
    expect(compactCount(999_999)).toBe("999k");
    expect(compactCount(1_000_000)).toBe("1m");
  });
});

describe("commentCountLabel", () => {
  // An empty thread invites the first reply rather than reporting a zero.
  it("asks for the first comment when there are none", () => {
    expect(commentCountLabel(0)).toBe("Comment");
  });

  it("counts, singular where it should be", () => {
    expect(commentCountLabel(1)).toBe("1 comment");
    expect(commentCountLabel(4)).toBe("4 comments");
  });
});

describe("audienceOptions", () => {
  it("names the viewer's hostel as the narrower room", () => {
    expect(
      audienceOptions(
        spaces({ hostelId: "h1", hostelName: "Green View", spaceType: "HOSTEL" }),
      ),
    ).toEqual({ open: "Public", restricted: "Green View only" });
  });

  // Nothing loaded yet, or a viewer with no hostel: the control is not offered
  // in either case, so this only has to be a sentence rather than "undefined only".
  it("falls back to a neutral name with no hostel", () => {
    expect(audienceOptions(null).restricted).toBe("My hostel only");
  });
});

describe("feedTime", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");

  it("uses the web's thresholds", () => {
    expect(feedTime("2026-08-17T11:59:30.000Z", now)).toBe("now");
    expect(feedTime("2026-08-17T11:48:00.000Z", now)).toBe("12m");
    expect(feedTime("2026-08-17T09:00:00.000Z", now)).toBe("3h");
    expect(feedTime("2026-08-15T12:00:00.000Z", now)).toBe("2d");
  });

  it("falls back to a date past a week", () => {
    expect(feedTime("2026-08-01T12:00:00.000Z", now)).toBe("1 Aug");
  });

  it("survives a missing or unparseable timestamp", () => {
    expect(feedTime(undefined, now)).toBe("");
    expect(feedTime(null, now)).toBe("");
    expect(feedTime("not a date", now)).toBe("");
  });

  // A clock a few seconds behind the server must not print "-1m".
  it("never goes negative on a future timestamp", () => {
    expect(feedTime("2026-08-17T12:00:30.000Z", now)).toBe("now");
  });
});

describe("avatarTone", () => {
  it("is deterministic, so one person keeps one colour", () => {
    expect(avatarTone("Sita Sharma")).toEqual(avatarTone("Sita Sharma"));
  });

  it("spreads different names across the palette", () => {
    const tones = new Set(
      ["Sita", "Ram", "Hari", "Gita", "Bimal", "Anita"].map(
        (name) => avatarTone(name)[0],
      ),
    );

    expect(tones.size).toBeGreaterThan(1);
  });
});

describe("usableAvatarUrl", () => {
  /*
   * `User.image` is set to `/api/v1/users/resident-identity/photo?v=…` when a card
   * photo is saved — a route with no id in the path, which returns only the
   * *caller's* photo. Rendering it for another author paints the viewer's own face
   * onto someone else's post, which is what `apps/web` does today.
   */
  it("refuses the caller-scoped identity photo route", () => {
    expect(usableAvatarUrl("/api/v1/users/resident-identity/photo?v=17")).toBeNull();
  });

  it("refuses any relative path", () => {
    expect(usableAvatarUrl("/uploads/me.png")).toBeNull();
  });

  // A Google sign-in photo is absolute and resolves the same for everyone.
  it("keeps an absolute URL", () => {
    expect(usableAvatarUrl("https://lh3.googleusercontent.com/a/x")).toBe(
      "https://lh3.googleusercontent.com/a/x",
    );
  });

  it("treats absent or blank as no photo", () => {
    expect(usableAvatarUrl(null)).toBeNull();
    expect(usableAvatarUrl(undefined)).toBeNull();
    expect(usableAvatarUrl("   ")).toBeNull();
  });
});

describe("descendantIds / hiddenCommentIds", () => {
  const thread = [
    comment({ id: "a" }),
    comment({ id: "b", parentId: "a" }),
    comment({ id: "c", parentId: "b" }),
    comment({ id: "d" }),
  ];

  it("collects a whole subtree, not just direct replies", () => {
    expect([...descendantIds(thread, "a")].sort()).toEqual(["b", "c"]);
  });

  it("hides the subtree of every collapsed comment, but not the comment itself", () => {
    const hidden = hiddenCommentIds(thread, ["a"]);

    expect(hidden.has("a")).toBe(false);
    expect(hidden.has("b")).toBe(true);
    expect(hidden.has("c")).toBe(true);
    expect(hidden.has("d")).toBe(false);
  });

  it("hides nothing when nothing is collapsed", () => {
    expect(hiddenCommentIds(thread, []).size).toBe(0);
  });

  // A malformed parent chain must not spin forever.
  it("terminates on a cycle", () => {
    const cyclic = [
      comment({ id: "x", parentId: "y" }),
      comment({ id: "y", parentId: "x" }),
    ];

    expect([...descendantIds(cyclic, "x")].sort()).toEqual(["x", "y"]);
  });
});

describe("replyCounts", () => {
  it("counts direct replies only", () => {
    const counts = replyCounts([
      comment({ id: "a" }),
      comment({ id: "b", parentId: "a" }),
      comment({ id: "c", parentId: "a" }),
      comment({ id: "d", parentId: "b" }),
    ]);

    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.has("d")).toBe(false);
  });
});

describe("nextVote", () => {
  it("sets a vote from nothing", () => {
    expect(nextVote(0, 4, 1)).toEqual({ score: 5, value: 1 });
  });

  it("clears the vote when the same arrow is tapped", () => {
    expect(nextVote(1, 5, 1)).toEqual({ score: 4, value: 0 });
  });

  // Flipping crosses zero, so the score moves by two.
  it("moves by two when flipping a downvote to an upvote", () => {
    expect(nextVote(-1, 3, 1)).toEqual({ score: 5, value: 1 });
    expect(nextVote(1, 5, -1)).toEqual({ score: 3, value: -1 });
  });
});

describe("spaceChips", () => {
  it("flattens the web's rail into one row, in its order", () => {
    expect(spaceChips(spaces()).map((chip) => chip.name)).toEqual([
      "All",
      "Public",
      "Green View",
      "Blue Sky",
    ]);
  });

  it("offers 'mine' only to a viewer who has a hostel", () => {
    const withHostel = spaceChips(
      spaces({ hostelId: "h1", hostelName: "Green View", spaceType: "HOSTEL" }),
    );

    expect(withHostel.map((chip) => chip.id)).toContain("mine");
    expect(spaceChips(spaces()).map((chip) => chip.id)).not.toContain("mine");
  });

  /*
   * The viewer's own hostel is already reachable as "mine" — listing it again by
   * id would be two chips fetching the same posts.
   */
  it("does not list the viewer's own hostel twice", () => {
    const chips = spaceChips(
      spaces({ hostelId: "h1", hostelName: "Green View", spaceType: "HOSTEL" }),
    );

    expect(chips.filter((chip) => chip.name === "Green View")).toHaveLength(1);
    expect(chips.map((chip) => chip.id)).not.toContain("h1");
  });

  it("still returns the All chip with nothing loaded", () => {
    expect(spaceChips(null).map((chip) => chip.id)).toEqual(["all"]);
  });
});

describe("composerTarget / postVisibility", () => {
  /*
   * `createCommunityPost` forces `PUBLIC` for a public-space author — there is no
   * narrower room to fall back to — so only a hostel viewer is offered the choice.
   */
  it("offers the audience choice only to a hostel viewer", () => {
    expect(
      composerTarget(spaces({ hostelId: "h1", hostelName: "Green View", spaceType: "HOSTEL" })),
    ).toEqual({ canChooseAudience: true, label: "Posting to Green View" });

    expect(composerTarget(spaces({ spaceType: "PUBLIC" }))).toEqual({
      canChooseAudience: false,
      label: "Posting to Public",
    });
  });

  it("ignores members-only from a viewer who cannot choose", () => {
    expect(postVisibility(spaces({ spaceType: "PUBLIC" }), true)).toBe("PUBLIC");
  });

  it("honours members-only from a hostel viewer", () => {
    const hostelViewer = spaces({
      hostelId: "h1",
      hostelName: "Green View",
      spaceType: "HOSTEL",
    });

    expect(postVisibility(hostelViewer, true)).toBe("HOSTEL_ONLY");
    expect(postVisibility(hostelViewer, false)).toBe("PUBLIC");
  });
});

describe("spaceBadge", () => {
  it("reads Public for a public post", () => {
    expect(
      spaceBadge({ hostelName: null, spaceType: "PUBLIC", visibility: "PUBLIC" }),
    ).toBe("Public");
  });

  it("names the hostel, and says when it is members only", () => {
    expect(
      spaceBadge({ hostelName: "Green View", spaceType: "HOSTEL", visibility: "PUBLIC" }),
    ).toBe("Green View");
    expect(
      spaceBadge({
        hostelName: "Green View",
        spaceType: "HOSTEL",
        visibility: "HOSTEL_ONLY",
      }),
    ).toBe("Green View · members only");
  });
});

describe("canPublish", () => {
  it("needs some text", () => {
    expect(canPublish("", 0)).toBe(false);
    expect(canPublish("   ", 0)).toBe(false);
    expect(canPublish("Hello", 0)).toBe(true);
  });

  // Media alone is not a post — `body` is `min(1)` on the server.
  it("refuses media with no words", () => {
    expect(canPublish("  ", 2)).toBe(false);
  });

  it("holds the body and media caps", () => {
    expect(canPublish("x".repeat(MAX_POST_BODY), 0)).toBe(true);
    expect(canPublish("x".repeat(MAX_POST_BODY + 1), 0)).toBe(false);
    expect(canPublish("Hello", 7)).toBe(false);
  });
});

describe("reportReasonError", () => {
  it("holds the schema's 3–500 range", () => {
    expect(reportReasonError("no")).toBeTruthy();
    expect(reportReasonError("spam")).toBeNull();
    expect(reportReasonError("x".repeat(501))).toBeTruthy();
  });

  it("measures the trimmed reason", () => {
    expect(reportReasonError("  a  ")).toBeTruthy();
  });
});

describe("emptyFeedMessage", () => {
  it("blames the search when there is one", () => {
    expect(emptyFeedMessage("plumbing")).toContain("plumbing");
  });

  it("invites a post when there is not", () => {
    expect(emptyFeedMessage("  ")).toContain("Be the first");
  });
});
