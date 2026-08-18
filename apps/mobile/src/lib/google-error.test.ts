import { describe, expect, it } from "vitest";

import {
  GOOGLE_NOT_CONFIGURED_MESSAGE,
  GOOGLE_NO_TOKEN_MESSAGE,
  type GoogleStatusCodes,
  googleFailureMessage,
} from "@/lib/google-error";

/** Android's real values. iOS uses different ones — hence the injected map. */
const ANDROID: GoogleStatusCodes = {
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "12500",
  SIGN_IN_CANCELLED: "12501",
};

/** iOS. The point is that nothing in the module matches on a literal. */
const IOS: GoogleStatusCodes = {
  IN_PROGRESS: "-1",
  PLAY_SERVICES_NOT_AVAILABLE: "-1000",
  SIGN_IN_CANCELLED: "-5",
};

describe("googleFailureMessage", () => {
  it("says nothing when the user dismissed the account sheet", () => {
    expect(googleFailureMessage("12501", ANDROID)).toBeNull();
  });

  it("says nothing when a second tap arrives mid-flow", () => {
    expect(googleFailureMessage("ASYNC_OP_IN_PROGRESS", ANDROID)).toBeNull();
  });

  it("names Play services, and the way round it, when it is unavailable", () => {
    const message = googleFailureMessage("12500", ANDROID);

    expect(message).toContain("Play services");
    expect(message).toContain("email and password");
  });

  it("falls back to a retryable message for an unrecognised code", () => {
    expect(googleFailureMessage("DEVELOPER_ERROR", ANDROID)).toBe(
      "Could not sign in with Google. Try again, or use your email and password.",
    );
  });

  it("falls back when there is no code at all", () => {
    expect(googleFailureMessage(null, ANDROID)).not.toBeNull();
    expect(googleFailureMessage(undefined, ANDROID)).not.toBeNull();
  });

  /*
   * The regression this file exists for: Android's cancel code is a message on
   * iOS and vice versa. Hardcoding either would report a cancellation as a
   * failure on the other platform.
   */
  it("resolves cancellation against the platform's own codes, not literals", () => {
    expect(googleFailureMessage("-5", IOS)).toBeNull();
    expect(googleFailureMessage("-5", ANDROID)).not.toBeNull();
    expect(googleFailureMessage("12501", IOS)).not.toBeNull();
  });

  it("keeps the configuration failures distinct from the runtime ones", () => {
    expect(GOOGLE_NOT_CONFIGURED_MESSAGE).not.toBe(GOOGLE_NO_TOKEN_MESSAGE);
    expect(googleFailureMessage("12500", ANDROID)).not.toBe(GOOGLE_NO_TOKEN_MESSAGE);
  });
});
