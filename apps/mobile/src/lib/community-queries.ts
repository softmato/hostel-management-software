/**
 * Every read the community makes, named once.
 *
 * The warden portal has `lib/admin-queries.ts` for this and the reasoning is
 * identical: a prefetch has to run the *same* request the screen will run, keyed
 * the *same* way, or it warms a key nobody reads and the screen loads twice.
 * What is different here is who the screens belong to. The board is not one
 * portal's — it is a tab in `(browse)`, `(resident)`, `(cook)`, `(guardian)`,
 * `(provider)` and `(admin)`, a pushed screen from three More menus, and the
 * landing place of every shared link and community push. `admin-queries.ts` says
 * in as many words why it refuses to warm it: the feed is platform-wide, and
 * making one shared board the warden portal's business would be wrong. So it has
 * a registry of its own, and every shell that shows the tab uses this one.
 *
 * ## Three tiers of warming, the same three
 *
 * 1. **{@link prefetchCommunity}**, a few seconds after a signed-in shell
 *    mounts — from `components/role-tabs.tsx`, which is the one place that knows
 *    whether Community is a tab in this role at all. Two reads: the spaces rail
 *    and the default feed.
 * 2. **{@link prefetchCommunity} again, on touch-down** of the Community row in
 *    a More menu, for the roles that reach it by a push.
 * 3. **{@link seedCommunityPost} and {@link prefetchCommunityComments}**, when a
 *    permalink is opened from a card. The post is not fetched at all — the feed
 *    is already holding it — so opening a post costs one request for its thread
 *    rather than two for a screen the reader can already see.
 *
 * ## The search feed is deliberately not in here
 *
 * `communityQuery.feed` takes the space and the sort and **not** the query
 * string. A key must contain everything that changes the answer, so the board
 * does not use this descriptor while a search is active — it falls back to its
 * own loader with no `cacheKey`, exactly as the whole screen behaved before this
 * module existed.
 *
 * That is a choice about *what is worth keeping*, not an oversight. `defineQuery`
 * holds a descriptor per key for the life of the process and the cache evicts at
 * forty entries; keying on free text would grow the first without limit and let
 * a reader who types four searches evict the warden portal out of the second, to
 * make going *back* to a search fast — which is not a thing people do.
 */

import { REALTIME_TOPIC } from "@/constants/topics";
import {
  type CommunityComment,
  type CommunityFeed,
  type CommunityPost,
  type CommunitySpaces,
  getCommunityFeed,
  getCommunityPost,
  getCommunitySpaces,
  getPostComments,
} from "@/lib/community-api";
import {
  defineQuery,
  prefetchQuery,
  type Query,
  writeQuery,
} from "@/lib/query-cache";

/** A community question. The shape and its guarantees live in `query-cache.ts`. */
export type CommunityQuery<T> = Query<T>;

/**
 * One topic for all of it.
 *
 * Posts, comments, reactions and votes are all `community` on the wire, so an
 * entry here goes stale when any of them moves. That is coarser than it could
 * be and deliberately so: the alternative is a topic per verb, and a comment
 * arriving on a post in the feed genuinely does change the feed's row.
 */
const COMMUNITY = [REALTIME_TOPIC.COMMUNITY] as const;

/** The board's own first question — and therefore what a warm-up must ask. */
export const DEFAULT_SPACE = "all";

/** Likewise the sort. `communityFeedQuerySchema` is `"new" | "top"`. */
export const DEFAULT_SORT = "new" as const;

function define<T>(key: string, load: () => Promise<T>): CommunityQuery<T> {
  return defineQuery(key, COMMUNITY, load);
}

/**
 * Every community question, by name.
 *
 * Parameterised ones are functions and their argument is in the key. Anything
 * that changes the answer must change the key — that is the whole contract
 * between a screen and a prefetch.
 */
export const communityQuery = {
  /** One post's whole thread, flat and in reading order. */
  comments: (postId: string): CommunityQuery<CommunityComment[]> =>
    define(`community:comments:${postId}`, () => getPostComments(postId)),

  /**
   * Page 1 of the feed, for a space and a sort.
   *
   * Page 1 only. Later pages are fetched imperatively by the board and kept
   * beside this one — see `components/community-board.tsx` — so what is cached
   * is what a screen paints with, not however far the last reader scrolled.
   */
  feed: (space: string, sort: "new" | "top"): CommunityQuery<CommunityFeed> =>
    define(`community:feed:${space}:${sort}`, () =>
      getCommunityFeed({ page: 1, sort, space }),
    ),

  post: (postId: string): CommunityQuery<CommunityPost> =>
    define(`community:post:${postId}`, () => getCommunityPost(postId)),

  /**
   * The spaces rail, and `viewer.canPost` with it.
   *
   * Shared by the board and the permalink screen on one key, which is most of
   * why the permalink opens drawn: arriving there from a card, the composer's
   * own question is already answered.
   */
  spaces: (): CommunityQuery<CommunitySpaces> =>
    define("community:spaces", () => getCommunitySpaces()),
} as const;

/** Warms one descriptor. Never throws, never re-asks something already fresh. */
export function prefetchCommunityQuery<T>(query: CommunityQuery<T>) {
  prefetchQuery(query.key, query.load, { topics: query.topics });
}

/**
 * The two reads the board makes on its first paint.
 *
 * Both, not just the feed: the spaces rail decides whether the composer or the
 * "sign in to post" line is drawn, and a board that painted its posts and then
 * grew a composer under them a moment later is the flicker this is here to
 * remove.
 *
 * Safe to call from a signed-out shell — `GET /community` and `/community/spaces`
 * both load an optional principal, which is why `(browse)` has the tab at all.
 */
export function prefetchCommunity() {
  prefetchCommunityQuery(communityQuery.spaces());
  prefetchCommunityQuery(communityQuery.feed(DEFAULT_SPACE, DEFAULT_SORT));
}

/** One post's thread, warmed from the control that is about to open it. */
export function prefetchCommunityComments(postId: string) {
  if (!postId) {
    return;
  }

  prefetchCommunityQuery(communityQuery.comments(postId));
}

/**
 * Files a post the feed already has under the permalink's key.
 *
 * A write rather than a fetch, and that is the point. `GET /community/<id>` runs
 * `decoratePosts` on one post — the very same function the feed ran on the row
 * the reader is looking at — so asking for it again would spend a request to be
 * told what is already on the screen.
 *
 * The permalink screen still revalidates behind it: `use-resource` treats a
 * seeded key exactly like a visited one, so this buys the first paint and
 * nothing else. If the post moved in the meantime the silent refetch corrects it
 * without the reader ever seeing a spinner.
 */
export function seedCommunityPost(post: CommunityPost) {
  writeQuery(communityQuery.post(post.id).key, post, COMMUNITY);
}
