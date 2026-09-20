import { describe, expect, it } from "vitest";

import {
  AUTH_CLIENT_HEADER,
  isMobileAuthClient,
  readBodyRefreshToken,
  shouldExposeRefreshToken,
} from "@/lib/mobile-auth";

describe("mobile auth contract", () => {
  it("exposes refresh tokens only for explicit mobile clients", () => {
    expect(
      shouldExposeRefreshToken(new Headers({ [AUTH_CLIENT_HEADER]: "mobile" })),
    ).toBe(true);
    expect(isMobileAuthClient(new Headers({ [AUTH_CLIENT_HEADER]: "MOBILE" }))).toBe(
      true,
    );
    expect(shouldExposeRefreshToken(new Headers())).toBe(false);
  });

  it("reads refresh tokens from JSON bodies for mobile refresh/logout", async () => {
    const request = new Request("https://hostelpalika.local/api/v1/auth/refresh", {
      body: JSON.stringify({ refreshToken: " refresh-token-value " }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    await expect(readBodyRefreshToken(request)).resolves.toBe("refresh-token-value");
  });

  it("ignores missing or blank refresh-token bodies", async () => {
    const missingRequest = new Request("https://hostelpalika.local/api/v1/auth/refresh", {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const blankRequest = new Request("https://hostelpalika.local/api/v1/auth/refresh", {
      body: JSON.stringify({ refreshToken: "   " }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    await expect(readBodyRefreshToken(missingRequest)).resolves.toBeNull();
    await expect(readBodyRefreshToken(blankRequest)).resolves.toBeNull();
  });
});
