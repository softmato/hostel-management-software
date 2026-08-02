import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginationMeta,
  paginationQuerySchema,
  paginationRange,
} from "@/lib/pagination";

const querySchema = z.object({ ...paginationQuerySchema });

describe("pagination", () => {
  it("defaults to page 1 at the default page size", () => {
    expect(paginationRange({})).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
    });
  });

  it("skips whole pages", () => {
    expect(paginationRange({ page: 3, pageSize: 20 })).toMatchObject({
      limit: 20,
      skip: 40,
    });
  });

  it("clamps a page size above the maximum instead of erroring", () => {
    // A report script asking for 10,000 rows should be trimmed, not broken —
    // `total` in the response tells it how many pages are left.
    expect(paginationRange({ pageSize: 10_000 }).limit).toBe(MAX_PAGE_SIZE);
  });

  it("clamps nonsense values rather than producing a negative skip", () => {
    expect(paginationRange({ page: 0, pageSize: 0 })).toMatchObject({
      limit: 1,
      page: 1,
      skip: 0,
    });
  });

  it("reports totals, page count and whether more pages exist", () => {
    expect(paginationMeta({ page: 1, pageSize: 20 }, 143)).toEqual({
      hasMore: true,
      page: 1,
      pageSize: 20,
      total: 143,
      totalPages: 8,
    });
  });

  it("closes hasMore on the final page", () => {
    expect(paginationMeta({ page: 8, pageSize: 20 }, 143)).toMatchObject({
      hasMore: false,
      totalPages: 8,
    });
  });

  it("reports zero pages for an empty result rather than one empty page", () => {
    expect(paginationMeta({ page: 1, pageSize: 20 }, 0)).toMatchObject({
      hasMore: false,
      total: 0,
      totalPages: 0,
    });
  });

  describe("query schema", () => {
    it("coerces string query parameters", () => {
      expect(querySchema.parse({ page: "2", pageSize: "50" })).toEqual({
        page: 2,
        pageSize: 50,
      });
    });

    it("leaves both fields undefined when absent, so defaults live in one place", () => {
      expect(querySchema.parse({})).toEqual({});
    });

    it("rejects a page size above the maximum at the route boundary", () => {
      expect(() => querySchema.parse({ pageSize: "500" })).toThrow();
    });

    it("rejects non-numeric and negative pages", () => {
      expect(() => querySchema.parse({ page: "abc" })).toThrow();
      expect(() => querySchema.parse({ page: "-1" })).toThrow();
    });
  });
});
