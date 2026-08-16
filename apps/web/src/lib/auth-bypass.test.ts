import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAuthBypassEnabled } from "@/lib/auth-bypass";

/**
 * The invariant here is one-directional and worth stating plainly: production
 * must never bypass the portal route guard, whatever else is set.
 *
 * `NEXT_PUBLIC_UI_PREVIEW` is a `NEXT_PUBLIC_` variable, so it is inlined at
 * build time and sits in the same environment list as every other key. The
 * failure this guards against is not someone deciding to open the portals — it
 * is a preview environment's variables being copied wholesale into production.
 */
describe("isAuthBypassEnabled", () => {
  const original = {
    NEXT_PUBLIC_UI_PREVIEW: process.env.NEXT_PUBLIC_UI_PREVIEW,
    NODE_ENV: process.env.NODE_ENV,
  };

  function setNodeEnv(value: string) {
    // `NODE_ENV` is typed as a readonly literal union; tests are the one place
    // that legitimately needs to move it.
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_UI_PREVIEW;
  });

  afterEach(() => {
    setNodeEnv(original.NODE_ENV ?? "test");

    if (original.NEXT_PUBLIC_UI_PREVIEW === undefined) {
      delete process.env.NEXT_PUBLIC_UI_PREVIEW;
    } else {
      process.env.NEXT_PUBLIC_UI_PREVIEW = original.NEXT_PUBLIC_UI_PREVIEW;
    }
  });

  it("never bypasses in production, even with the preview flag set", () => {
    setNodeEnv("production");
    process.env.NEXT_PUBLIC_UI_PREVIEW = "true";

    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("does not bypass in production by default", () => {
    setNodeEnv("production");

    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("bypasses in development", () => {
    setNodeEnv("development");

    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("bypasses outside production when the preview flag is set", () => {
    setNodeEnv("test");
    process.env.NEXT_PUBLIC_UI_PREVIEW = "true";

    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("does not bypass outside production without the flag", () => {
    setNodeEnv("test");

    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("treats any value other than the exact string 'true' as off", () => {
    setNodeEnv("test");

    for (const value of ["1", "yes", "TRUE", "on", ""]) {
      process.env.NEXT_PUBLIC_UI_PREVIEW = value;
      expect(isAuthBypassEnabled()).toBe(false);
    }
  });
});
