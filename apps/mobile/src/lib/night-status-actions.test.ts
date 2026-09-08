import { describe, expect, it } from "vitest";

import {
  NIGHT_STATUS_ACTIONS,
  NIGHT_STATUS_BUTTONS,
  NIGHT_STATUS_CATEGORY,
  NIGHT_STATUS_REASONS,
  isNightStatusPrompt,
  parseNightStatusAction,
  reasonLabel,
} from "@/lib/night-status-actions";

/**
 * The notification's buttons, and what a tap on one means.
 *
 * This is the only part of the shade path that can be tested off a device — the
 * registration and the network call both need a handset — so it is where the
 * decisions worth locking down live. The one that matters most is the last
 * describe block: a background handler that guesses turns an unrelated
 * notification into a status nobody chose, and nothing on the phone would ever
 * report that it had.
 */

describe("the registered category", () => {
  it("names the identifier the server stamps on the push", () => {
    // If these two ever drift, nothing throws and nothing logs — the
    // notification simply arrives with no buttons, which looks exactly like the
    // feature not having been built. The server's constant carries the mirror
    // of this comment.
    expect(NIGHT_STATUS_CATEGORY).toBe("night-status");
  });

  it("draws at most three buttons", () => {
    // Android renders three actions inline. A fourth would be invisible on the
    // surface this feature exists to be answered from.
    expect(NIGHT_STATUS_BUTTONS.length).toBeLessThanOrEqual(3);
  });

  it("gives exactly one button a text field", () => {
    // The OS allows one free-text field and no dropdown, chip row or radio
    // list. That constraint is why the presets are buttons, and a second text
    // field would mean the design had drifted away from it.
    const withInput = NIGHT_STATUS_BUTTONS.filter((button) => button.textInput);

    expect(withInput).toHaveLength(1);
    expect(withInput[0].identifier).toBe(NIGHT_STATUS_ACTIONS.OUTSIDE);
  });

  it("leads with Inside", () => {
    // The answer most people give most nights, and on a locked screen the first
    // button is the one pressed without reading.
    expect(NIGHT_STATUS_BUTTONS[0].identifier).toBe(NIGHT_STATUS_ACTIONS.INSIDE);
  });

  it("namespaces every identifier", () => {
    // `actionIdentifier` is a flat string shared with every other category and
    // with the OS's own default. A bare "inside" is one collision away from a
    // different feature's button marking somebody present.
    for (const button of NIGHT_STATUS_BUTTONS) {
      expect(button.identifier.startsWith("night-status:")).toBe(true);
    }
  });
});

describe("parseNightStatusAction", () => {
  it("reads a one-tap answer", () => {
    expect(parseNightStatusAction(NIGHT_STATUS_ACTIONS.INSIDE)).toEqual({
      status: "INSIDE_HOSTEL",
    });
  });

  it("fills the reason in for the preset button", () => {
    expect(parseNightStatusAction(NIGHT_STATUS_ACTIONS.HOME)).toEqual({
      reasonCode: "HOME",
      status: "OUTSIDE_HOSTEL",
    });
  });

  it("carries what they typed", () => {
    expect(
      parseNightStatusAction(NIGHT_STATUS_ACTIONS.OUTSIDE, "At my sister's in Pokhara"),
    ).toEqual({
      note: "At my sister's in Pokhara",
      reasonCode: "OTHER",
      status: "OUTSIDE_HOSTEL",
    });
  });

  it("still records the status when the field was left empty", () => {
    /*
     * Somebody who taps `Outside…` and sends nothing has told the hostel they
     * are out. `DESIGN.md` is explicit that being out is neutral rather than a
     * warning, so the reason stays optional here as everywhere else — refusing
     * the answer for want of an explanation teaches people to stop answering.
     *
     * And no `OTHER` code: an "Other" chip beside a blank on the warden's board
     * says nothing at all.
     */
    for (const text of ["", "   ", null, undefined]) {
      expect(parseNightStatusAction(NIGHT_STATUS_ACTIONS.OUTSIDE, text)).toEqual({
        status: "OUTSIDE_HOSTEL",
      });
    }
  });
});

describe("parseNightStatusAction refuses everything else", () => {
  it("ignores a plain tap on the notification body", () => {
    // The OS reports a body tap with its own default identifier. Treating that
    // as an answer would mark somebody present for reading the question.
    expect(
      parseNightStatusAction("expo.modules.notifications.actions.DEFAULT"),
    ).toBeNull();
  });

  it("ignores another feature's action", () => {
    expect(parseNightStatusAction("complaint:resolve")).toBeNull();
    expect(parseNightStatusAction("inside")).toBeNull();
  });

  it("ignores a missing identifier", () => {
    expect(parseNightStatusAction(null)).toBeNull();
    expect(parseNightStatusAction(undefined)).toBeNull();
    expect(parseNightStatusAction("")).toBeNull();
  });

  it("never invents a status from the text alone", () => {
    // Text without one of our identifiers is not our notification.
    expect(parseNightStatusAction("something:else", "Inside")).toBeNull();
  });
});

describe("the in-app reason list", () => {
  it("offers more than the shade can", () => {
    // The point of the list: a screen has room for the presets a notification
    // cannot draw.
    expect(NIGHT_STATUS_REASONS.length).toBeGreaterThan(
      NIGHT_STATUS_BUTTONS.filter((button) => button.answer.reasonCode).length,
    );
  });

  it("does not offer OTHER as a chip", () => {
    // On a screen with a real text field, "other" is what typing something
    // means. As a chip it is a button whose only effect is to leave the reason
    // blank.
    expect(
      NIGHT_STATUS_REASONS.some((reason) => String(reason.code) === "OTHER"),
    ).toBe(false);
  });

  it("names a code", () => {
    expect(reasonLabel("HOME")).toBe("At home");
    expect(reasonLabel("WORKING_LATE")).toBe("Working late");
    expect(reasonLabel(null)).toBe("");
    expect(reasonLabel("OTHER")).toBe("");
  });
});

describe("isNightStatusPrompt", () => {
  it("recognises the prompt by its category", () => {
    expect(isNightStatusPrompt({ category: "NIGHT_STATUS" })).toBe(true);
    expect(isNightStatusPrompt({ category: "PAYMENT" })).toBe(false);
    expect(isNightStatusPrompt({})).toBe(false);
    expect(isNightStatusPrompt(null)).toBe(false);
  });
});
