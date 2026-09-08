import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { duePrompts, promptMessage } from "@/modules/safety/night-status-prompt.service";
import {
  isCurrentNight,
  isSameNight,
  nightKey,
  parsePromptTime,
  promptIsDue,
  reminderIsDue,
} from "@hostel/shared/night/night-window";

/**
 * The night prompt's arithmetic, which is where every bug in this feature will
 * be.
 *
 * Two things are being pinned here and they fail in opposite directions:
 *
 * 1. **The night boundary**, which decides whether an answer counts as tonight's.
 *    Get it wrong and a resident who checked in at 23:30 is asked again at
 *    midnight — the exact failure the 17:00 rule exists to prevent, now with a
 *    push notification attached to it.
 * 2. **The due window**, which decides whether the hostel is asked at all. Get it
 *    wrong in one direction and nobody is prompted; in the other, everybody is
 *    prompted on every run for the rest of the evening.
 *
 * Nepal is UTC+05:45 throughout, with no daylight saving, so every instant below
 * is written as the UTC time that corresponds to the Nepali wall clock in its
 * name. `2026-09-08T14:15:00Z` is 20:00 in Kathmandu.
 */

/** A Nepali wall-clock time, as the instant it actually is. */
function nepal(date: string, time: string) {
  return new Date(`${date}T${time}:00.000+05:45`);
}

const HOSTEL = new Types.ObjectId();

function settings(overrides: Record<string, unknown> = {}) {
  return [
    {
      attendance: {
        nightStatus: { promptEnabled: true, promptTime: "20:00", ...overrides },
      },
      hostelId: HOSTEL,
    },
  ];
}

describe("parsePromptTime", () => {
  it("reads a clock time as minutes since midnight", () => {
    expect(parsePromptTime("20:00")).toBe(20 * 60);
    expect(parsePromptTime("21:30")).toBe(21 * 60 + 30);
  });

  it("refuses an hour before the night starts", () => {
    // 16:59 is still the afternoon. Filing an answer given then under "tonight"
    // would put it on the wrong side of the 17:00 boundary.
    expect(parsePromptTime("16:59")).toBeNull();
    expect(parsePromptTime("17:00")).toBe(17 * 60);
  });

  it("refuses an hour that would cross midnight", () => {
    // A prompt at 23:50 is sent on the calendar day after the night it asks
    // about, and every claim row and board query would disagree about which
    // night that was.
    expect(parsePromptTime("23:45")).toBe(23 * 60 + 45);
    expect(parsePromptTime("23:46")).toBeNull();
  });

  it("refuses anything that is not HH:mm", () => {
    for (const value of ["", "  ", "8pm", "9:00", "20:0", "24:00", "20:60", null]) {
      expect(parsePromptTime(value)).toBeNull();
    }
  });
});

describe("nightKey", () => {
  it("gives an evening and the small hours after it the same key", () => {
    // The whole reason the boundary is 17:00 rather than midnight.
    expect(nightKey(nepal("2026-09-08", "23:30"))).toBe(
      nightKey(nepal("2026-09-09", "01:00")),
    );
    expect(isSameNight(nepal("2026-09-08", "20:00"), nepal("2026-09-09", "04:00"))).toBe(
      true,
    );
  });

  it("starts a new night at 17:00, not at midnight", () => {
    expect(isSameNight(nepal("2026-09-09", "16:59"), nepal("2026-09-09", "17:01"))).toBe(
      false,
    );
  });

  it("does not depend on the machine's own timezone", () => {
    // Same instant, two ways of writing it. A server in UTC and a handset left
    // on London time have to agree, which is the bug that makes this worth a
    // test at all.
    expect(nightKey(new Date("2026-09-08T18:15:00.000Z"))).toBe(
      nightKey(nepal("2026-09-09", "00:00")),
    );
  });
});

describe("isCurrentNight", () => {
  it("counts an answer given earlier the same night", () => {
    expect(
      isCurrentNight(nepal("2026-09-08", "20:05").toISOString(), nepal("2026-09-09", "01:00")),
    ).toBe(true);
  });

  it("does not count last night's answer", () => {
    // The failure this whole field exists for: a status row is upserted and
    // never cleared, so without the night key an answer is true forever.
    expect(
      isCurrentNight(nepal("2026-09-07", "20:05").toISOString(), nepal("2026-09-08", "20:05")),
    ).toBe(false);
  });

  it("treats a missing or unreadable timestamp as unanswered", () => {
    expect(isCurrentNight(null)).toBe(false);
    expect(isCurrentNight(undefined)).toBe(false);
    expect(isCurrentNight("not a date")).toBe(false);
  });
});

describe("promptIsDue", () => {
  it("is due on the minute and through the grace window", () => {
    expect(promptIsDue("20:00", nepal("2026-09-08", "20:00"))).toBe(true);
    expect(promptIsDue("20:00", nepal("2026-09-08", "20:44"))).toBe(true);
  });

  it("is not due before the hour", () => {
    expect(promptIsDue("20:00", nepal("2026-09-08", "19:59"))).toBe(false);
  });

  it("stops being due once the grace window closes", () => {
    // The important half. "minuteOfDay >= promptMinute" is true for the rest of
    // the evening, which would re-send on every run until midnight — the claim
    // row would stop the duplicates, but the first run after a deploy at 23:00
    // would still buzz everybody.
    expect(promptIsDue("20:00", nepal("2026-09-08", "20:46"))).toBe(false);
    expect(promptIsDue("20:00", nepal("2026-09-08", "23:30"))).toBe(false);
  });

  it("is never due for an unreadable or out-of-range hour", () => {
    expect(promptIsDue("16:00", nepal("2026-09-08", "16:00"))).toBe(false);
    expect(promptIsDue("nonsense", nepal("2026-09-08", "20:00"))).toBe(false);
    expect(promptIsDue(null, nepal("2026-09-08", "20:00"))).toBe(false);
  });
});

describe("duePrompts", () => {
  it("returns the hostel whose hour just passed", () => {
    const due = duePrompts(settings(), nepal("2026-09-08", "20:10"));

    expect(due).toHaveLength(1);
    expect(due[0].promptTime).toBe("20:00");
    expect(due[0].hostelId).toBe(HOSTEL);
  });

  it("skips a hostel that has not turned the prompt on", () => {
    expect(
      duePrompts(settings({ promptEnabled: false }), nepal("2026-09-08", "20:10")),
    ).toHaveLength(0);
  });

  it("falls back to the default hour when none was ever set", () => {
    // The schema default only reaches documents written after the field
    // existed. A hostel that enables the prompt on an older settings row would
    // otherwise be skipped forever, silently.
    for (const promptTime of [undefined, "", "   "]) {
      expect(duePrompts(settings({ promptTime }), nepal("2026-09-08", "20:10"))).toHaveLength(
        1,
      );
      expect(duePrompts(settings({ promptTime }), nepal("2026-09-08", "21:10"))).toHaveLength(
        0,
      );
    }
  });

  it("skips a hostel whose hour is unusable rather than substituting one", () => {
    // Never prompt at an hour nobody chose.
    for (const promptTime of ["16:00", "25:00", "8pm"]) {
      expect(
        duePrompts(settings({ promptTime }), nepal("2026-09-08", "20:10")),
      ).toHaveLength(0);
    }
  });

  it("honours a hostel's own hour", () => {
    const late = settings({ promptTime: "22:30" });

    expect(duePrompts(late, nepal("2026-09-08", "20:10"))).toHaveLength(0);
    expect(duePrompts(late, nepal("2026-09-08", "22:35"))).toHaveLength(1);
  });
});

describe("reminderIsDue", () => {
  it("is off unless a hostel asked for it", () => {
    // One notification a night is the promise; a second has to be asked for.
    expect(reminderIsDue("20:00", 0, nepal("2026-09-08", "21:00"))).toBe(false);
    expect(reminderIsDue("20:00", undefined, nepal("2026-09-08", "21:00"))).toBe(false);
  });

  it("comes due the configured number of minutes after the prompt", () => {
    expect(reminderIsDue("20:00", 60, nepal("2026-09-08", "21:00"))).toBe(true);
    expect(reminderIsDue("20:00", 60, nepal("2026-09-08", "20:59"))).toBe(false);
    expect(reminderIsDue("20:00", 60, nepal("2026-09-08", "21:46"))).toBe(false);
  });

  it("never lands after midnight", () => {
    /*
     * A chase at 00:30 would be delivered on the calendar day after the night
     * it asks about, while the claim row keys it under the night — and it wakes
     * somebody who is already asleep. The prompt still goes; only the chase is
     * dropped.
     */
    expect(reminderIsDue("22:00", 180, nepal("2026-09-09", "01:00"))).toBe(false);
    expect(reminderIsDue("22:00", 180, nepal("2026-09-08", "23:30"))).toBe(false);
  });
});

describe("duePrompts and the chase", () => {
  it("never returns both kinds for one hostel in one run", () => {
    // Two claims and two notifications inside the same minute.
    const rows = settings({ promptTime: "20:00", remindAfterMinutes: 30 });

    for (const time of ["20:00", "20:30", "20:40", "21:00"]) {
      const due = duePrompts(rows, nepal("2026-09-08", time));

      expect(due.length).toBeLessThanOrEqual(1);
    }
  });

  it("asks first, then chases", () => {
    const rows = settings({ promptTime: "20:00", remindAfterMinutes: 60 });

    expect(duePrompts(rows, nepal("2026-09-08", "20:05"))[0]?.kind).toBe("PROMPT");
    expect(duePrompts(rows, nepal("2026-09-08", "21:05"))[0]?.kind).toBe("REMINDER");
  });
});

describe("promptMessage", () => {
  it("quotes the hostel's own hour back", () => {
    expect(promptMessage("21:30").body).toContain("21:30");
  });

  it("says the chase is a chase", () => {
    // A second notification with the same words as the first reads as a bug,
    // and a resident who thinks the app is repeating itself stops reading both.
    const first = promptMessage("20:00", "PROMPT");
    const chase = promptMessage("20:00", "REMINDER");

    expect(chase.title).not.toBe(first.title);
    expect(chase.body).not.toBe(first.body);
  });

  it("does not name the buttons in the text", () => {
    // On a build where the category did not register, a body reading "tap
    // Inside or Outside" describes controls that are not on screen.
    const { body, title } = promptMessage("20:00");

    expect(`${title} ${body}`).not.toMatch(/\bInside\b|\bOutside\b/);
  });
});
