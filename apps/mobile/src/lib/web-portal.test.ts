import { describe, expect, it } from "vitest";

import { WEB_PORTAL_PATHS, webPortalUrl, type WebPortalKey } from "@/lib/web-portal";

describe("webPortalUrl", () => {
  /*
   * The whole point of the module: `portal-nav.ts` declares
   * `/hostel-admin/payments`, and `tenantHostelAdminHref` rewrites it to
   * `/{slug}/admin/payments` before anything renders it. Building the declared
   * form on mobile would 404 for every hostel.
   */
  it("builds the tenant-scoped path, not the legacy /hostel-admin one", () => {
    expect(webPortalUrl("https://hostelhub.test", "green-view-hostel", "finance")).toBe(
      "https://hostelhub.test/green-view-hostel/admin/payments",
    );
    expect(
      webPortalUrl("https://hostelhub.test", "green-view-hostel", "finance"),
    ).not.toContain("/hostel-admin/");
  });

  it("strips a trailing slash off the base url", () => {
    // `EXPO_PUBLIC_API_URL` and the dev LAN address are both user-supplied.
    expect(webPortalUrl("http://192.168.1.4:3000/", "sunrise", "dashboard")).toBe(
      "http://192.168.1.4:3000/sunrise/admin/dashboard",
    );
  });

  it("never emits a double slash for any key", () => {
    const keys = Object.keys(WEB_PORTAL_PATHS) as WebPortalKey[];

    for (const key of keys) {
      const url = webPortalUrl("https://hostelhub.test", "sunrise", key);

      expect(url.slice("https://".length)).not.toContain("//");
      expect(url.startsWith("https://hostelhub.test/sunrise/admin")).toBe(true);
    }
  });
});
