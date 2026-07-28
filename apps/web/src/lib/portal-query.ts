"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { browserApi } from "@/lib/browser-api";
import type { LoadState } from "@/app/_components/core-portal-shared";

/**
 * Portal data fetching on top of TanStack Query.
 *
 * Portal pages used to keep their rows in local `useState` and refill them from
 * a mount `useEffect`, which meant every tab switch threw the data away and
 * replayed a full-page spinner. Routing every read through the shared query
 * cache keyed by URL means:
 *
 *  - returning to a screen paints instantly from cache, then revalidates
 *    quietly in the background once the data goes stale (see QueryProvider);
 *  - pages that read the same endpoint (dashboard / hostels / listings all read
 *    `/api/v1/platform/hostels`) share one request instead of racing three.
 *
 * The return shape deliberately mirrors the old `{ data, state, message }`
 * locals so a page converts without touching its rendering code.
 */

export type PortalResource<T> = {
  /** Cached payload. `undefined` until the first successful load. */
  data: T | undefined;
  /** True while revalidating cached data — for subtle "refreshing" affordances. */
  isRefreshing: boolean;
  /** Error text, empty when there is nothing to report. */
  message: string;
  /** Force a refetch, e.g. after a mutation on this same page. */
  refresh: () => void;
  /**
   * Same refetch, awaitable — for the few callers that must not tear down
   * optimistic UI until the refreshed rows are actually in hand.
   */
  refreshAsync: () => Promise<void>;
  /** `loading` only when there is nothing cached to show yet. */
  state: LoadState;
};

/** Query key for a portal endpoint. Keyed by URL so any page hitting the same
 *  endpoint shares one cache entry. */
export function resourceKey(url: string) {
  return ["portal-resource", url] as const;
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Read a portal endpoint through the shared cache.
 *
 * Pass `null` as the url to keep the query idle (e.g. a detail panel that has
 * no selection yet) — it will start as soon as a real url arrives.
 */
export function usePortalResource<T>(
  url: string | null,
  options?: { errorMessage?: string },
): PortalResource<T> {
  const fallback = options?.errorMessage ?? "Could not load this data.";
  const enabled = Boolean(url);

  const query = useQuery({
    enabled,
    queryFn: () => browserApi<T>(url as string),
    queryKey: resourceKey(url ?? "idle"),
  });

  const { refetch } = query;
  const refreshAsync = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const refresh = useCallback(() => {
    void refreshAsync();
  }, [refreshAsync]);

  let state: LoadState = "ready";

  if (!enabled) {
    state = "idle";
  } else if (query.isPending) {
    state = "loading";
  } else if (query.isError && query.data === undefined) {
    state = "error";
  }

  return {
    data: query.data,
    isRefreshing: query.isFetching && !query.isPending,
    message: query.isError ? errorText(query.error, fallback) : "",
    refresh,
    refreshAsync,
    state,
  };
}

/**
 * Collapse several resources into the single `{ state, message }` pair a page
 * header renders. Loading wins over error so a partially cached page keeps
 * showing its skeleton rather than flashing a failure.
 */
export function combineResources(
  ...resources: Array<Pick<PortalResource<unknown>, "message" | "state">>
): { message: string; state: LoadState } {
  const active = resources.filter((resource) => resource.state !== "idle");

  if (active.length === 0) {
    return { message: "", state: "idle" };
  }

  const message = active.find((resource) => resource.message)?.message ?? "";

  if (active.some((resource) => resource.state === "loading")) {
    return { message, state: "loading" };
  }

  if (active.every((resource) => resource.state === "error")) {
    return { message: message || "Could not load this data.", state: "error" };
  }

  return { message, state: "ready" };
}

/**
 * Patch one endpoint's cached payload in place, for mutations whose result is
 * already known locally — a "mark as read" tick should land on the row the
 * moment the request succeeds, not one refetch later.
 */
export function useUpdateResource() {
  const client = useQueryClient();

  return useCallback(
    <T>(url: string, update: (current: T) => T) => {
      client.setQueryData<T>(resourceKey(url), (current) =>
        current === undefined ? current : update(current),
      );
    },
    [client],
  );
}

/**
 * Invalidate cached endpoints after a mutation. Accepts exact urls, or a url
 * prefix ending in `*` to drop a whole family (e.g. every hostel detail).
 */
export function useInvalidateResources() {
  const client = useQueryClient();

  return useCallback(
    (...urls: string[]) => {
      for (const url of urls) {
        if (url.endsWith("*")) {
          const prefix = url.slice(0, -1);

          void client.invalidateQueries({
            predicate: (query) => {
              const [scope, key] = query.queryKey as [string, string];
              return scope === "portal-resource" && key.startsWith(prefix);
            },
          });
          continue;
        }

        void client.invalidateQueries({ queryKey: resourceKey(url) });
      }
    },
    [client],
  );
}
