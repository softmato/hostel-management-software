import { describe, expect, it } from "vitest";

import {
  describeFanout,
  SOS_MESSAGE_MAX,
  sosMessagePayload,
  validateSosMessage,
} from "@/lib/sos";

function fanout(
  staff: number,
  guardians: number,
  guardianAlertEnabled = true,
) {
  return describeFanout({ guardianAlertEnabled, notified: { guardians, staff } });
}

describe("describeFanout", () => {
  it("never claims help is coming when nobody was reached", () => {
    // The whole reason this function exists. `fanOutSOSAlert` swallows its own
    // failures, so a 201 means "recorded", not "heard" — and the app must not
    // turn a pair of zeroes into a reassuring green tick.
    const outcome = fanout(0, 0);

    expect(outcome.tone).toBe("unreached");
    expect(outcome.title).toMatch(/nobody/i);
    expect(outcome.callToAction).toBe("Call your emergency contacts now.");
  });

  it("treats no staff reached as serious even when guardians were", () => {
    // Guardians are usually a phone call away in another city; the hostel is
    // the one that can walk down the corridor.
    const outcome = fanout(0, 2);

    expect(outcome.tone).toBe("partial");
    expect(outcome.callToAction).toBe("Call the hostel directly.");
    expect(outcome.detail).toContain("2 guardians");
  });

  it("does not report zero guardians as a failure when none were asked for", () => {
    const outcome = fanout(3, 0, false);

    expect(outcome.tone).toBe("reached");
    expect(outcome.detail).not.toMatch(/guardian/i);
    expect(outcome.callToAction).toBeNull();
  });

  it("does report zero guardians as a failure when they were asked for", () => {
    const outcome = fanout(3, 0, true);

    expect(outcome.tone).toBe("partial");
    expect(outcome.detail).toContain("No guardian could be notified");
  });

  it("reports both when both were reached", () => {
    const outcome = fanout(4, 1);

    expect(outcome.tone).toBe("reached");
    expect(outcome.detail).toContain("4 people");
    expect(outcome.detail).toContain("1 guardian");
  });

  it("agrees with itself about singular and plural", () => {
    // "1 people was alerted" on the screen someone reads in an emergency is the
    // detail that makes the whole thing look unmaintained.
    expect(fanout(1, 0, false).detail).toBe("1 person at your hostel was alerted.");
    expect(fanout(2, 0, false).detail).toBe("2 people at your hostel were alerted.");
    expect(fanout(0, 1).detail).toContain("1 guardian was alerted");
    expect(fanout(0, 3).detail).toContain("3 guardians were alerted");
  });

  it("treats a negative count as zero rather than rendering it", () => {
    // Defensive: these are counts off a network payload, and "-1 people were
    // alerted" is worse than being wrong quietly.
    expect(fanout(-1, -1).tone).toBe("unreached");
  });
});

describe("validateSosMessage", () => {
  it("allows an empty note — the message is optional", () => {
    expect(validateSosMessage("")).toBeNull();
  });

  it("measures the trimmed length, as the server does", () => {
    // The server trims before validating. A client that counts the whitespace
    // rejects a note the server would have accepted.
    expect(validateSosMessage(`${"x".repeat(SOS_MESSAGE_MAX)}   `)).toBeNull();
    expect(validateSosMessage("x".repeat(SOS_MESSAGE_MAX + 1))).toBeTruthy();
  });
});

describe("sosMessagePayload", () => {
  it("sends nothing rather than an empty string", () => {
    // Optional means absent. Posting "" stores an empty note, and the admin's
    // alert list then shows a blank line where "no note" was meant.
    expect(sosMessagePayload("")).toBeUndefined();
    expect(sosMessagePayload("   ")).toBeUndefined();
    expect(sosMessagePayload("  locked out  ")).toBe("locked out");
  });
});
