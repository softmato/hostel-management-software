"use client";

import { useCallback, useState } from "react";

import { usePortalResource, type PortalResource } from "@/lib/portal-query";

/**
 * Client half of the pagination contract in API.md §1.4.
 *
 * Every paginated list endpoint returns a `pagination` block next to its
 * collection. These helpers turn that into a page cursor the screens can drive
 * without each one re-implementing "append ?page= to a URL that may already
 * have a query string".
 */

export type PaginationMeta = {
  hasMore: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Paginated<T> = T & { pagination?: PaginationMeta };

/** Appends `page` to a URL that may already carry filters. */
export function withPage(url: string, page: number) {
  if (page <= 1) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
}

export type PagedResource<T> = PortalResource<Paginated<T>> & {
  page: number;
  pagination?: PaginationMeta;
  setPage: (page: number) => void;
};

/**
 * A portal read that carries a page cursor.
 *
 * The page number is part of the fetched URL, so it is also part of the query
 * cache key — going back to page 1 is served from cache rather than refetched,
 * and invalidating a mutation still refreshes the page being viewed.
 */
export function usePagedPortalResource<T>(
  url: string | null,
  options?: { errorMessage?: string },
): PagedResource<T> {
  const [page, setPageState] = useState(1);
  const resource = usePortalResource<Paginated<T>>(
    url ? withPage(url, page) : null,
    options,
  );

  const setPage = useCallback((next: number) => {
    setPageState(Math.max(1, next));
  }, []);

  return {
    ...resource,
    page,
    pagination: resource.data?.pagination,
    setPage,
  };
}
