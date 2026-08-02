import { afterEach, describe, expect, it } from "vitest";

import { validateCronRequest } from "@/lib/cron-auth";

const ORIGINAL = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/v1/cron/purge-expired-otps", {
    method: "POST",
    headers,
  });
}

describe("validateCronRequest", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL;
    }
  });

  it("returns 500 when CRON_SECRET is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(validateCronRequest(req({ "x-cron-secret": "anything" }))).toMatchObject({
      ok: false,
      status: 500,
    });
  });

  it("returns 401 when the secret is missing or wrong", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(validateCronRequest(req())).toMatchObject({ ok: false, status: 401 });
    expect(validateCronRequest(req({ "x-cron-secret": "nope" }))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("accepts the x-cron-secret header", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(validateCronRequest(req({ "x-cron-secret": "s3cret-value" }))).toEqual({
      ok: true,
    });
  });

  it("accepts Authorization: Bearer <secret> and the raw secret", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(validateCronRequest(req({ authorization: "Bearer s3cret-value" }))).toEqual({
      ok: true,
    });
    expect(validateCronRequest(req({ authorization: "s3cret-value" }))).toEqual({
      ok: true,
    });
  });
});
