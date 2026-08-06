import { describe, expect, it } from "vitest";

import { platformEndpoints } from "@/lib/platform-endpoints";

/**
 * Detail and action URLs used to be built by appending to the list constants —
 * but those carry `?pageSize=100`, so `${list}/${id}/approve` produced
 * `...?pageSize=100/<id>/approve`. Every moderation button on the Service
 * Providers, Reviews, Listings and Listing Flags screens 405'd silently.
 *
 * These tests pin the two halves of the contract: list URLs keep their query
 * string, and single-resource helpers never have one to append to.
 */
describe("platformEndpoints", () => {
  const singleResource = {
    hostel: platformEndpoints.hostel("abc123"),
    listingFlag: platformEndpoints.listingFlag("abc123"),
    review: platformEndpoints.review("abc123"),
    serviceProvider: platformEndpoints.serviceProvider("abc123"),
  };

  it.each(Object.entries(singleResource))(
    "%s() returns a query-free URL safe to append an action to",
    (_name, url) => {
      expect(url).not.toContain("?");
      expect(url.endsWith("/abc123")).toBe(true);
      // The shape every caller relies on.
      expect(`${url}/approve`).toMatch(/\/abc123\/approve$/);
    },
  );

  it("keeps the paging hint on list URLs", () => {
    for (const url of [
      platformEndpoints.hostels,
      platformEndpoints.listingFlags,
      platformEndpoints.reviews,
      platformEndpoints.serviceProviders,
    ]) {
      expect(url).toContain("pageSize=");
    }
  });

  it("points list and single-resource URLs at the same collection", () => {
    expect(platformEndpoints.serviceProviders.split("?")[0]).toBe(
      "/api/v1/platform/service-providers",
    );
    expect(platformEndpoints.serviceProvider("abc123")).toBe(
      "/api/v1/platform/service-providers/abc123",
    );
  });
});
