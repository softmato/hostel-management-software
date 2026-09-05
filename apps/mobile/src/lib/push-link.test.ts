import { describe, expect, it } from "vitest";

import { marksRoleChange, PUSH_FALLBACK_PATH, resolvePushPath } from "@/lib/push-link";

describe("resolvePushPath", () => {
  it("passes through a route that exists", () => {
    expect(resolvePushPath("/(resident)/payments")).toBe("/(resident)/payments");
    expect(resolvePushPath("/(admin)/alerts")).toBe("/(admin)/alerts");
    // The tabs the retab added. A push about money has somewhere to land that
    // can act on it.
    expect(resolvePushPath("/(admin)/money")).toBe("/(admin)/money");
    expect(resolvePushPath("/(admin)/today")).toBe("/(admin)/today");
    expect(resolvePushPath("/notifications")).toBe("/notifications");
  });

  /*
   * The one the server gets wrong rather than early: M3 put invoice detail on
   * the root stack, because a folder under a `<Tabs>` layout becomes a tab.
   */
  it("moves an invoice deep link onto the root stack", () => {
    expect(resolvePushPath("/(resident)/payments/64f0c1a2b3")).toBe("/invoice/64f0c1a2b3");
  });

  /*
   * M5.2 built these, on the root stack for the same reason invoices are there.
   * The list form matters as much as the detail one: without its own match the
   * `/(resident)/more/` rewrite would swallow it and send a complaint push to
   * the menu that links to complaints.
   */
  it("moves a complaint deep link onto the root stack", () => {
    expect(resolvePushPath("/(resident)/more/complaints")).toBe("/complaints");
    expect(resolvePushPath("/(resident)/more/complaints/abc123")).toBe(
      "/complaints/abc123",
    );
  });

  it("does not mistake a deeper complaints path for a detail route", () => {
    expect(resolvePushPath("/(resident)/more/complaints/abc/def")).toBe(
      "/(resident)/more",
    );
  });

  // M5.4. Ordered before the generic `/(resident)/more/` rewrite, which would
  // otherwise send it to the menu that links to it.
  it("moves a profile deep link onto the root stack", () => {
    expect(resolvePushPath("/(resident)/more/profile")).toBe("/profile");
  });

  // M5.7, same shape.
  it("moves a reviews deep link onto the root stack", () => {
    expect(resolvePushPath("/(resident)/more/reviews")).toBe("/review");
  });

  // M5.9, the last of them.
  it("moves a settings deep link onto the root stack", () => {
    expect(resolvePushPath("/(resident)/more/settings")).toBe("/settings");
  });

  /*
   * Attendance is the only `/(resident)/more/*` path left with no screen — it is
   * M7 work — so it is what keeps the generic rewrite earning its place.
   */
  it("still sends an unbuilt screen to the More tab that lists it", () => {
    expect(resolvePushPath("/(resident)/more/attendance")).toBe("/(resident)/more");
  });

  it("collapses a notice deep link onto the list, which is where reading happens", () => {
    expect(resolvePushPath("/(resident)/notices/abc123")).toBe("/(resident)/notices");
    expect(resolvePushPath("/(resident)/notices")).toBe("/(resident)/notices");
  });

  // M5.8. The one server path that was already right — the app puts community
  // where the web does — so these pass through rather than being rewritten.
  it("passes a community deep link straight through", () => {
    expect(resolvePushPath("/community")).toBe("/community");
    expect(resolvePushPath("/community/post-1")).toBe("/community/post-1");
  });

  it("still falls back for a community path with extra segments", () => {
    expect(resolvePushPath("/community/post-1/comments")).toBe(PUSH_FALLBACK_PATH);
  });

  /*
   * The server strips these before sending. Doing it again here is the point:
   * trusting a network-supplied path because another service promised to clean
   * it is one server bug away from routing anywhere.
   */
  it("refuses anything that is not a single-slash local path", () => {
    expect(resolvePushPath("//evil.example")).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath("https://evil.example/x")).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath("hostelhub://ref/ABC")).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath("(resident)/payments")).toBe(PUSH_FALLBACK_PATH);
  });

  it("survives a missing or non-string path", () => {
    expect(resolvePushPath(undefined)).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath(null)).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath(42)).toBe(PUSH_FALLBACK_PATH);
    expect(resolvePushPath("")).toBe(PUSH_FALLBACK_PATH);
  });

  it("ignores a trailing slash, a query string and a fragment", () => {
    expect(resolvePushPath("/(resident)/payments/")).toBe("/(resident)/payments");
    expect(resolvePushPath("/(resident)/payments?from=push")).toBe("/(resident)/payments");
    expect(resolvePushPath("/(resident)/food#today")).toBe("/(resident)/food");
    expect(resolvePushPath("  /(resident)/food  ")).toBe("/(resident)/food");
  });

  it("does not mistake a payments path with extra segments for an invoice", () => {
    expect(resolvePushPath("/(resident)/payments/abc/def")).toBe(PUSH_FALLBACK_PATH);
  });
});

/**
 * The one push that changes what app this is.
 *
 * `usePush` rotates the access token and replaces the shell when this is true,
 * so a false positive throws somebody out of the screen they are reading and a
 * false negative leaves a paid-up resident stuck in the browsing app until
 * their token expires. The string is frozen in two places on purpose — here,
 * and in the server's `resident-registered-notify.ts`.
 */
describe("marksRoleChange", () => {
  it("recognises the registration push", () => {
    expect(marksRoleChange({ type: "RESIDENT_REGISTERED" })).toBe(true);
    expect(marksRoleChange({ invoiceId: "inv-1", type: "RESIDENT_REGISTERED" })).toBe(
      true,
    );
  });

  it("ignores every other notification", () => {
    expect(marksRoleChange({ type: "DOWNLOAD_COMPLETE" })).toBe(false);
    expect(marksRoleChange({ invoiceId: "inv-1" })).toBe(false);
    expect(marksRoleChange({ category: "PAYMENT" })).toBe(false);
  });

  /*
   * `data` is network input written by many call sites, and an older server
   * build sends no `type` at all. None of those may throw inside a notification
   * listener — an exception there loses the tap.
   */
  it("survives a payload that is missing, empty or the wrong shape", () => {
    expect(marksRoleChange(undefined)).toBe(false);
    expect(marksRoleChange(null)).toBe(false);
    expect(marksRoleChange({})).toBe(false);
    expect(marksRoleChange("RESIDENT_REGISTERED")).toBe(false);
    expect(marksRoleChange({ type: 42 })).toBe(false);
  });
});
