import { REALTIME_TOPIC } from "@/constants/topics";
import {
  getOwnProvider,
  listProviderJobs,
  type ProviderApplication,
  type ProviderJob,
} from "@/lib/provider-api";
import { defineQuery, prefetchQuery, type Query } from "@/lib/query-cache";

/**
 * The service provider's two reads, named once.
 *
 * The last portal without a registry, and it had both shapes of the problem the
 * others were built to fix:
 *
 * - **The same question asked by three screens.** `getOwnProvider()` is read by
 *   the provider's own card, by the browsing account's Profile tab (to decide
 *   whether to offer "apply" or "your application") and by the marketing screen
 *   at `/service-providers`. Unkeyed, each of those paid for its own request and
 *   its own spinner for an answer that changes when a platform admin decides it.
 * - **A detail screen refetching the list it was opened from.** `job/[id].tsx`
 *   has no endpoint of its own — it finds its job inside `listProviderJobs()` —
 *   so tapping a job threw away the list the tap came from and asked for it
 *   again behind a full-screen spinner. One key, and the job opens instantly.
 *
 * `maintenance` is the jobs topic because a provider's work *is* the hostel's
 * maintenance queue: the same `resource:changed` that moves an admin's repair
 * list moves this one.
 */

export type ProviderQuery<T> = Query<T>;

export const providerQuery = {
  /** This account's application, or `null` when it has never made one. */
  application: (): ProviderQuery<ProviderApplication | null> =>
    defineQuery("provider:application", [REALTIME_TOPIC.SERVICE_PROVIDERS], () =>
      getOwnProvider(),
    ),

  jobs: (): ProviderQuery<ProviderJob[]> =>
    defineQuery("provider:jobs", [REALTIME_TOPIC.MAINTENANCE], () => listProviderJobs()),
} as const;

/** Warms one descriptor. Never throws, never re-asks something already fresh. */
export function prefetchProviderQuery<T>(query: ProviderQuery<T>) {
  prefetchQuery(query.key, query.load, { topics: query.topics });
}
