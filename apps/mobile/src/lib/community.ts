/**
 * Community logic and wording, kept out of the components so it can be tested.
 *
 * Ported from `community-post-card.tsx` and `community-page.tsx`, including their
 * judgement calls — the deterministic avatar tone, the short relative time, the
 * collapse-a-subtree rule, and which space a post is about to land in.
 */

import type {
  CommunityComment,
  CommunityPost,
  CommunitySpace,
  CommunitySpaces,
} from "@/lib/community-api";
import type { ReactionType } from "@/lib/community-enums";

/* -------------------------------------------------------------------------- */
/* Reactions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * All six the API accepts.
 *
 * The web shows four as pills and calls the other two unused, but a phone row of
 * six emoji at 30dp still fits a 320dp screen — and offering four of six values
 * the server takes is the kind of quiet narrowing that becomes permanent. Labels
 * are the web's.
 */
export const REACTIONS: { emoji: string; label: string; type: ReactionType }[] = [
  { emoji: "👍", label: "Like", type: "LIKE" },
  { emoji: "❤️", label: "Love", type: "LOVE" },
  { emoji: "😄", label: "Haha", type: "LAUGH" },
  { emoji: "😢", label: "Sad", type: "SAD" },
  { emoji: "😠", label: "Angry", type: "ANGRY" },
  { emoji: "🤝", label: "Support", type: "SUPPORT" },
];

/**
 * What a reaction tap will do, given what the viewer already has.
 *
 * `reactToPost` toggles: the same type clears, a different type replaces. The
 * count moves by 0 or 1 accordingly — replacing a reaction does not change the
 * total, which is the case an optimistic `+1` gets wrong.
 */
export function nextReaction(
  current: ReactionType | null,
  tapped: ReactionType,
): { countDelta: number; reaction: ReactionType | null } {
  if (current === tapped) {
    return { countDelta: -1, reaction: null };
  }

  return { countDelta: current ? 0 : 1, reaction: tapped };
}

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `now` · `12m` · `3h` · `2d`, then a date.
 *
 * A feed is read in glances and a full timestamp on every card is noise — the
 * web's reasoning, and the same thresholds. Deliberately not `lib/format.ts`'s
 * `formatRelativeDay`, which answers "Today/Yesterday": in a feed the useful
 * distinction is minutes and hours, not calendar days.
 */
export function feedTime(value: string | null | undefined, now = new Date()): string {
  if (!value) {
    return "";
  }

  const then = new Date(value);

  if (Number.isNaN(then.getTime())) {
    return "";
  }

  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) {
    return "now";
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h`;
  }

  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d`;
  }

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return `${then.getUTCDate()} ${months[then.getUTCMonth()]}`;
}

/* -------------------------------------------------------------------------- */
/* Avatars                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The web's five avatar tones, as `[background, foreground]`.
 *
 * Fixed hexes rather than theme tokens, like the web's, so the same person is the
 * same colour in both clients and across light and dark — the colour is an
 * identity cue, and one that changed with the theme would stop being one.
 */
export const AVATAR_TONES: [string, string][] = [
  ["#163a2a", "#ffffff"],
  ["#c9ead2", "#163a2a"],
  ["#f0e3c8", "#7a5b1a"],
  ["#e0d6f0", "#4a2e7a"],
  ["#f0c8d6", "#7a1a3f"],
];

/** Deterministic per name, so one person keeps one colour everywhere. */
export function avatarTone(name: string): [string, string] {
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }

  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Anything a client can load on its own: an absolute URL, or inline data. */
const SELF_CONTAINED = /^(?:[a-z][a-z\d+\-.]*:)?\/\/|^data:/i;

/**
 * `authorImage`, but only when it is safe to render.
 *
 * `authorImage` is `User.image`, and `resident-identity.service.ts` keeps that
 * field in step with the ID-card photo by storing
 * **`/api/v1/users/resident-identity/photo?v=…`** — a route with *no id in the
 * path*, which by design returns only the **caller's own** photo. Rendering it for
 * another author therefore paints the viewer's own face onto someone else's post.
 * (It leaks nothing: the route cannot be pointed at anybody else. It is simply
 * wrong, and `apps/web` does it today — §1 has the row.)
 *
 * An absolute URL is a different thing entirely — a Google sign-in photo — and
 * loads correctly for everyone. So: absolute wins, anything relative falls back to
 * the initial.
 */
export function usableAvatarUrl(authorImage: string | null | undefined): string | null {
  const url = authorImage?.trim();

  return url && SELF_CONTAINED.test(url) ? url : null;
}

/* -------------------------------------------------------------------------- */
/* Comments                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every descendant of a comment — what collapsing it hides.
 *
 * The server returns the tree already flattened into display order with a
 * `depth` on each row, so this walks `parentId` rather than rebuilding it.
 */
export function descendantIds(
  comments: Pick<CommunityComment, "id" | "parentId">[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>();
  const collect = (parentId: string) => {
    for (const comment of comments) {
      if (comment.parentId === parentId && !ids.has(comment.id)) {
        ids.add(comment.id);
        collect(comment.id);
      }
    }
  };

  collect(rootId);

  return ids;
}

/** Which rows are hidden, given the set of collapsed ones. */
export function hiddenCommentIds(
  comments: Pick<CommunityComment, "id" | "parentId">[],
  collapsed: Iterable<string>,
): Set<string> {
  const hidden = new Set<string>();

  for (const id of collapsed) {
    for (const descendant of descendantIds(comments, id)) {
      hidden.add(descendant);
    }
  }

  return hidden;
}

/** Direct reply counts, for the "collapse" affordance. */
export function replyCounts(
  comments: Pick<CommunityComment, "parentId">[],
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const comment of comments) {
    if (comment.parentId) {
      counts.set(comment.parentId, (counts.get(comment.parentId) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * The optimistic result of a vote tap.
 *
 * Tapping the arrow already chosen clears the vote — the web's behaviour and the
 * server's (`value: 0` deletes the row). The score moves by the difference, which
 * is 2 when flipping a downvote to an upvote.
 */
export function nextVote(
  current: number,
  score: number,
  direction: 1 | -1,
): { score: number; value: -1 | 0 | 1 } {
  const value = current === direction ? 0 : direction;

  return { score: score - current + value, value };
}

/* -------------------------------------------------------------------------- */
/* Spaces and the composer                                                    */
/* -------------------------------------------------------------------------- */

/** `communityPostCreateSchema`'s bounds. */
export const MAX_POST_BODY = 4000;
export const MAX_COMMENT_BODY = 2000;
export const MAX_POST_MEDIA = 6;
export const MIN_REPORT_REASON = 3;
export const MAX_REPORT_REASON = 500;

/**
 * The space list a phone shows, as a chip row.
 *
 * The web's left rail is three groups — Everything/Public/My hostel, then every
 * hostel that has posted, then trending tags. A phone has no rail, so the first
 * group and the hostels flatten into one scrollable row in the same order. "Mine"
 * is only offered when the viewer has a hostel, exactly as the rail does.
 */
export function spaceChips(spaces: CommunitySpaces | null): CommunitySpace[] {
  const viewer = spaces?.viewer;
  const hostels = (spaces?.spaces ?? []).filter((space) => space.id !== "public");

  return [
    { id: "all", isMine: false, name: "Everything", postCount: 0 },
    ...(spaces?.spaces ?? []).filter((space) => space.id === "public"),
    ...(viewer?.hostelId
      ? [
          {
            id: "mine",
            isMine: true,
            name: viewer.hostelName ?? "My hostel",
            postCount: 0,
          },
        ]
      : []),
    // The viewer's own hostel is already offered as "mine"; listing it twice
    // would be two chips that fetch the same posts.
    ...hostels.filter((space) => space.id !== viewer?.hostelId),
  ];
}

/**
 * Where a new post will land, in the words the composer shows.
 *
 * Only a `HOSTEL` viewer has an audience choice — `createCommunityPost` forces
 * `PUBLIC` for a public-space author, because there is no narrower room to fall
 * back to. So "members only" is offered to them and nobody else.
 */
export function composerTarget(spaces: CommunitySpaces | null): {
  canChooseAudience: boolean;
  label: string;
} {
  const viewer = spaces?.viewer;

  if (viewer?.spaceType === "HOSTEL") {
    return {
      canChooseAudience: true,
      label: `Posting to ${viewer.hostelName ?? "your hostel"}`,
    };
  }

  return { canChooseAudience: false, label: "Posting to Public" };
}

export function postVisibility(
  spaces: CommunitySpaces | null,
  membersOnly: boolean,
): "HOSTEL_ONLY" | "PUBLIC" {
  return composerTarget(spaces).canChooseAudience && membersOnly
    ? "HOSTEL_ONLY"
    : "PUBLIC";
}

/** The badge under an author's name. */
export function spaceBadge(
  post: Pick<CommunityPost, "hostelName" | "spaceType" | "visibility">,
): string {
  if (post.spaceType === "PUBLIC") {
    return "Public";
  }

  const name = post.hostelName ?? "Hostel";

  return post.visibility === "HOSTEL_ONLY" ? `${name} · members only` : name;
}

/** Trimmed and length-checked against `communityPostCreateSchema`. */
export function canPublish(body: string, mediaCount: number): boolean {
  const text = body.trim();

  return text.length >= 1 && text.length <= MAX_POST_BODY && mediaCount <= MAX_POST_MEDIA;
}

/** `communityReportSchema`: 3–500 characters after trimming. */
export function reportReasonError(raw: string): string | null {
  const reason = raw.trim();

  if (reason.length < MIN_REPORT_REASON) {
    return "Say what is wrong with it, in a few words.";
  }

  return reason.length > MAX_REPORT_REASON ? "That is too long." : null;
}

/** The empty-feed line, which differs when a search is what emptied it. */
export function emptyFeedMessage(query: string): string {
  return query.trim()
    ? `Nothing matches “${query.trim()}”.`
    : "Nothing here yet. Be the first to post.";
}
