import { REALTIME_TOPIC } from "@/constants/topics";
import { type GuardianDashboard, getGuardianDashboard } from "@/lib/guardian-api";
import { defineQuery, prefetchQuery, type Query } from "@/lib/query-cache";

/**
 * Every read the guardian portal makes, named once.
 *
 * The sibling of `resident-queries.ts` and `admin-queries.ts`, and the smallest
 * of the three by a long way — because the guardian portal genuinely has **one**
 * read behind all four of its tabs.
 *
 * ## Four tabs, one payload, and it was being fetched four times
 *
 * `/guardian/payments`, `/guardian/notices`, `/guardian/food` and
 * `/guardian/safety-summary` each call `getGuardianDashboard` on the server and
 * return a slice of it, so the screens correctly settled on fetching the whole
 * dashboard once per screen and slicing it locally. What they did *not* do was
 * share the result: every one of them called `useResource` with an inline
 * `useCallback` and **no `cacheKey`**, and `useResource` without a key holds its
 * payload in component state and loses it on unmount.
 *
 * So Home → Safety → Payments → Home was four full round trips for one object,
 * each with its own spinner, on the portal whose users are most likely to be on
 * a slow connection and least likely to know what to do about it. The resident
 * tabs had exactly this bug (§5.2) and the admin tabs never did.
 *
 * One descriptor, one key, four screens.
 *
 * ## Why the topic list is the union rather than per-screen
 *
 * Each screen used to name only the topics its own sections cared about —
 * Payments subscribed to `PAYMENTS`, Safety to `SAFETY`/`COMPLAINTS`/`NOTICES`.
 * With one shared cache entry that would mean the entry's freshness depended on
 * which tab happened to be mounted, and a notice arriving while the guardian sat
 * on Payments would leave a stale dashboard for Home to paint from.
 *
 * The payload is four domains, so the query names four topics. A guardian's
 * principal is granted `private-hostel-<id>` off the ward's hostel, which is
 * where all four are published.
 */

export type GuardianQuery<T> = Query<T>;

export const guardianQuery = {
  dashboard: (): GuardianQuery<GuardianDashboard> =>
    defineQuery(
      "guardian:dashboard",
      [
        REALTIME_TOPIC.PAYMENTS,
        REALTIME_TOPIC.NOTICES,
        REALTIME_TOPIC.FOOD,
        REALTIME_TOPIC.SAFETY,
      ],
      () => getGuardianDashboard(),
    ),
} as const;

/** Warms one descriptor. Never throws, never re-asks something already fresh. */
export function prefetchGuardianQuery<T>(query: GuardianQuery<T>) {
  prefetchQuery(query.key, query.load, { topics: query.topics });
}

/*
 * There is deliberately no `prefetchGuardianPortal`.
 *
 * The resident and admin portals warm the tabs a user is certain to reach but is
 * not landing on. Here every tab reads the *same* key as the one being landed
 * on, so a warm-up would be a second request racing Home's own for a cache entry
 * Home is already filling — the exact duplicate `resident-queries.ts` excludes
 * Home from its wave to avoid. The moment a guardian screen needs a read of its
 * own, this is where its descriptor and its warm-up go.
 */
