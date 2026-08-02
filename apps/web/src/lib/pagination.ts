import { z } from "zod";

/**
 * Pagination for list endpoints (API.md §1.4, RULES.md §6).
 *
 * Before this existed every list was a bare `.limit(100)` with no page
 * parameter and no total, so a hostel with 101 residents could not reach the
 * 101st and was never told the list had been cut. The cap looked like a
 * safeguard and behaved like silent data loss.
 *
 * **Envelope shape.** API.md §1.4 originally specified renaming every list
 * payload's array to `items`. That would have been a breaking change across
 * ~184 route files and the mobile client for no behavioural gain, so the
 * collection keeps its descriptive key (`residents`, `payments`, `complaints`)
 * and carries a sibling `pagination` block. API.md was corrected to describe
 * this. The rule that matters — no unbounded array, always a total — holds
 * either way.
 */

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard ceiling on `pageSize`. A client asking for more gets this, not an
 * error — a report script requesting 10,000 rows should be clamped, not
 * broken, and the `total` in the response tells it how many pages remain.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Spread into a list endpoint's query schema.
 *
 * Both fields are `.optional()` rather than `.default()` on purpose: defaults
 * are applied in exactly one place — `paginationRange()` — so a service called
 * directly (a test, a cron job, another service) behaves identically to one
 * called through a route, and there is no second copy of the numbers to drift.
 */
export const paginationQuerySchema = {
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
};

/**
 * Both fields are optional so a service can be called directly — from a test,
 * a cron job, or another service — without restating defaults the Zod schema
 * would have supplied at the route boundary.
 */
export type PaginationQuery = {
  page?: number;
  pageSize?: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

/** Mongo `skip`/`limit` for a page request. */
export function paginationRange(query: PaginationQuery = {}) {
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);

  return { limit: pageSize, page, pageSize, skip: (page - 1) * pageSize };
}

/**
 * Builds the `pagination` block. `total` is the count of matching documents
 * **before** skip/limit — always run it against the same filter as the query
 * it describes, or the page count lies.
 */
export function paginationMeta(
  query: PaginationQuery = {},
  total: number,
): PaginationMeta {
  const { page, pageSize } = paginationRange(query);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    hasMore: page * pageSize < total,
    page,
    pageSize,
    total,
    totalPages,
  };
}
