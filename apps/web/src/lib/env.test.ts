import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serverEnvWarnings, validateServerEnv } from "@/lib/env";

/**
 * These cover the half of the boot check that has a decision in it: what stops
 * a production deployment, and what merely warns.
 *
 * The distinction is the whole design. A missing `R2_BUCKET_NAME` means every
 * upload throws, so the deploy should fail rather than accept traffic. A missing
 * Pusher key means the portals poll instead of streaming, which is a worse
 * product and a perfectly serviceable one — refusing to boot over it would be a
 * bigger outage than the thing it prevents.
 */
const PRODUCTION_MINIMUM = {
  APP_URL: "https://example.com",
  CRON_SECRET: "cron-secret-value",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  MONGODB_URI: "mongodb://localhost:27017/test",
  NEXT_PUBLIC_APP_URL: "https://example.com",
  R2_ACCESS_KEY_ID: "key-id",
  R2_BUCKET_PRIVATE: "softmato-data-private",
  R2_BUCKET_PUBLIC: "softmato-data-public",
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_SECRET_ACCESS_KEY: "secret-key",
};

describe("validateServerEnv", () => {
  const snapshot = { ...process.env };

  function setNodeEnv(value: string) {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, PRODUCTION_MINIMUM);
    setNodeEnv("production");
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, snapshot);
  });

  it("accepts a complete production environment", () => {
    expect(() => validateServerEnv()).not.toThrow();
  });

  it("rejects a JWT secret shorter than 32 characters", () => {
    process.env.JWT_ACCESS_SECRET = "too-short";

    expect(() => validateServerEnv()).toThrow();
  });

  it("rejects a missing MONGODB_URI in any environment", () => {
    delete process.env.MONGODB_URI;
    setNodeEnv("development");

    expect(() => validateServerEnv()).toThrow();
  });

  it.each([
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_PUBLIC",
    "R2_BUCKET_PRIVATE",
  ])(
    "refuses to boot production without %s",
    (key) => {
      delete process.env[key];

      expect(() => validateServerEnv()).toThrow(new RegExp(key));
    },
  );

  it("refuses to boot production without CRON_SECRET", () => {
    delete process.env.CRON_SECRET;

    expect(() => validateServerEnv()).toThrow(/CRON_SECRET/);
  });

  it("names every missing variable at once, not just the first", () => {
    delete process.env.CRON_SECRET;
    delete process.env.R2_BUCKET_PUBLIC;

    expect(() => validateServerEnv()).toThrow(/R2_BUCKET_PUBLIC.*CRON_SECRET/);
  });

  it("allows the same gaps outside production", () => {
    setNodeEnv("development");
    delete process.env.CRON_SECRET;
    delete process.env.R2_BUCKET_PUBLIC;

    expect(() => validateServerEnv()).not.toThrow();
  });
});

describe("serverEnvWarnings", () => {
  const snapshot = { ...process.env };

  function setNodeEnv(value: string) {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  }

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, PRODUCTION_MINIMUM);
    setNodeEnv("production");
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    Object.assign(process.env, snapshot);
  });

  it("warns about each silently-degrading group that is entirely absent", () => {
    const warnings = serverEnvWarnings().join("\n");

    expect(warnings).toMatch(/PUSHER_APP_ID/);
    expect(warnings).toMatch(/RESEND_API_KEY/);
    expect(warnings).toMatch(/PERSONAL_DATA_ENCRYPTION_KEY/);
    expect(warnings).toMatch(/FINANCE_MASTER_KEY/);
  });

  it("says what breaks, not merely that something is unset", () => {
    const pusher = serverEnvWarnings().find((line) => line.includes("PUSHER_APP_ID"));

    expect(pusher).toMatch(/polling/);
  });

  it("stops warning once the group is configured", () => {
    process.env.PUSHER_APP_ID = "app-id";
    process.env.PUSHER_KEY = "key";
    process.env.PUSHER_SECRET = "secret";
    process.env.PUSHER_CLUSTER = "ap2";

    expect(serverEnvWarnings().join("\n")).not.toMatch(/PUSHER/);
  });

  it("stays silent outside production", () => {
    setNodeEnv("development");

    expect(serverEnvWarnings()).toEqual([]);
  });
});
