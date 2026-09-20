import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rateLimitPublicForm, resetPublicFormRateLimitForTests } from "@/lib/rate-limit";

function request(ip = "203.0.113.10") {
  return new NextRequest("https://hostelpalika.local/api/v1/public/test", {
    headers: {
      "user-agent": "vitest",
      "x-forwarded-for": ip,
    },
    method: "POST",
  });
}

describe("public form rate limit", () => {
  beforeEach(() => {
    resetPublicFormRateLimitForTests();
    process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "2";
    process.env.PUBLIC_FORM_RATE_LIMIT_WINDOW_SECONDS = "60";
  });

  afterEach(() => {
    resetPublicFormRateLimitForTests();
    delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX;
    delete process.env.PUBLIC_FORM_RATE_LIMIT_WINDOW_SECONDS;
  });

  it("blocks repeated submissions after the configured limit", async () => {
    expect(rateLimitPublicForm(request(), { namespace: "test-form" })).toBeNull();
    expect(rateLimitPublicForm(request(), { namespace: "test-form" })).toBeNull();

    const blocked = rateLimitPublicForm(request(), { namespace: "test-form" });

    expect(blocked?.status).toBe(429);
    await expect(blocked?.json()).resolves.toMatchObject({
      errorCode: "RATE_LIMITED",
      success: false,
    });
  });

  it("separates limits by namespace and client", () => {
    expect(rateLimitPublicForm(request(), { namespace: "first-form" })).toBeNull();
    expect(rateLimitPublicForm(request(), { namespace: "first-form" })).toBeNull();
    expect(
      rateLimitPublicForm(request("203.0.113.11"), { namespace: "first-form" }),
    ).toBeNull();
    expect(rateLimitPublicForm(request(), { namespace: "second-form" })).toBeNull();
  });
});
