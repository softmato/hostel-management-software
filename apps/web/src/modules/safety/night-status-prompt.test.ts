import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { verifyAccessToken, verifyPurposeToken } from "@/lib/auth";
import {
  duePrompts,
  nightAnswerData,
  promptMessage,
} from "@/modules/safety/night-status-prompt.service";
import {
  isCurrentNight,
  isSameNight,
  nightEndsAt,
  nightKey,
  parsePromptTime,
  askingEndsAt,
  promptRound,
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

describe("promptRound", () => {
  it("is round 0 from the hostel's hour until the first repeat", () => {
    expect(promptRound("20:00", 30, nepal("2026-09-08", "20:00"))).toBe(0);
    expect(promptRound("20:00", 30, nepal("2026-09-08", "20:29"))).toBe(0);
    expect(promptRound("20:00", 30, nepal("2026-09-08", "20:30"))).toBe(1);
  });

  it("is not asking before the hour", () => {
    expect(promptRound("20:00", 30, nepal("2026-09-08", "19:59"))).toBeNull();
  });

  it("keeps asking past midnight and stops at 01:00", () => {
    // The owner's rule: five hours after the hour, never past one in the morning.
    expect(promptRound("20:00", 30, nepal("2026-09-09", "00:59"))).toBe(9);
    expect(promptRound("20:00", 30, nepal("2026-09-09", "01:00"))).toBeNull();
    expect(promptRound("20:00", 30, nepal("2026-09-09", "03:00"))).toBeNull();
  });

  it("stops five hours after an early hour", () => {
    expect(promptRound("18:00", 60, nepal("2026-09-08", "22:59"))).toBe(4);
    expect(promptRound("18:00", 60, nepal("2026-09-08", "23:00"))).toBeNull();
  });

  it("caps a late hour at 01:00 rather than five hours on", () => {
    expect(promptRound("22:30", 30, nepal("2026-09-09", "00:59"))).toBe(4);
    expect(promptRound("22:30", 30, nepal("2026-09-09", "01:30"))).toBeNull();
  });

  it("uses 30 minutes for an interval that is not one of the choices", () => {
    // Including the `remindAfterMinutes: 0` older documents still carry.
    for (const every of [undefined, null, 0, 45, 180]) {
      expect(promptRound("20:00", every, nepal("2026-09-08", "21:00"))).toBe(2);
    }
  });

  it("is never asking for an unreadable or out-of-range hour", () => {
    expect(promptRound("16:00", 30, nepal("2026-09-08", "16:00"))).toBeNull();
    expect(promptRound("nonsense", 30, nepal("2026-09-08", "20:00"))).toBeNull();
    expect(promptRound(null, 30, nepal("2026-09-08", "20:00"))).toBeNull();
  });
});

describe("askingEndsAt", () => {
  it("names the time a hostel stops asking", () => {
    expect(askingEndsAt("20:00")).toBe("01:00");
    expect(askingEndsAt("18:15")).toBe("23:15");
    expect(askingEndsAt("23:45")).toBe("01:00");
    expect(askingEndsAt("nonsense")).toBeNull();
  });
});

describe("duePrompts", () => {
  it("returns the hostel whose hour just passed", () => {
    const due = duePrompts(settings(), nepal("2026-09-08", "20:10"));

    expect(due).toHaveLength(1);
    expect(due[0].promptTime).toBe("20:00");
    expect(due[0].hostelId).toBe(HOSTEL);
  });

  it("skips a hostel that has explicitly turned the prompt off", () => {
    expect(
      duePrompts(settings({ promptEnabled: false }), nepal("2026-09-08", "20:10")),
    ).toHaveLength(0);
  });

  it("prompts a hostel that has never opened its settings", () => {
    /*
     * The prompt is on by default, so **absence has to mean on**.
     *
     * This is the case a truthiness check gets wrong, and it gets it wrong
     * silently and for every existing customer: a hostel whose warden has never
     * touched the settings screen has no `nightStatus` object at all, and one
     * that saved settings before the field existed has the object without the
     * key. Under `if (!config?.promptEnabled)` both read as "off", and
     * "on by default" would have reached nobody who was already a customer.
     */
    const noSettingsDocument = [{ hostelId: HOSTEL }];
    const noAttendanceBlock = [{ attendance: {}, hostelId: HOSTEL }];
    const noNightStatusKey = [
      { attendance: { nightStatus: {} }, hostelId: HOSTEL },
    ];

    for (const rows of [noSettingsDocument, noAttendanceBlock, noNightStatusKey]) {
      expect(duePrompts(rows, nepal("2026-09-08", "20:10"))).toHaveLength(1);
      // And at the default hour, not at some other one.
      expect(duePrompts(rows, nepal("2026-09-08", "19:50"))).toHaveLength(0);
    }
  });

  it("treats only an explicit false as off", () => {
    // `undefined` is not `false`. The distinction is the whole feature here.
    expect(
      duePrompts(settings({ promptEnabled: undefined }), nepal("2026-09-08", "20:10")),
    ).toHaveLength(1);
  });

  it("falls back to the default hour when none was ever set", () => {
    // The schema default only reaches documents written after the field
    // existed. A hostel that enables the prompt on an older settings row would
    // otherwise be skipped forever, silently.
    for (const promptTime of [undefined, "", "   "]) {
      expect(duePrompts(settings({ promptTime }), nepal("2026-09-08", "20:10"))).toHaveLength(
        1,
      );
      expect(duePrompts(settings({ promptTime }), nepal("2026-09-08", "19:50"))).toHaveLength(
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

describe("duePrompts and the repeats", () => {
  it("returns one candidate per hostel per run, with its round", () => {
    const rows = settings({ promptTime: "20:00", repeatEveryMinutes: 30 });

    expect(duePrompts(rows, nepal("2026-09-08", "20:05"))).toEqual([
      expect.objectContaining({ kind: "PROMPT", round: 0 }),
    ]);
    expect(duePrompts(rows, nepal("2026-09-08", "21:05"))).toEqual([
      expect.objectContaining({ kind: "REMINDER", round: 2 }),
    ]);
  });

  it("stops asking when the window closes", () => {
    const rows = settings({ promptTime: "20:00", repeatEveryMinutes: 30 });

    expect(duePrompts(rows, nepal("2026-09-09", "01:05"))).toHaveLength(0);
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

describe("the answer token", () => {
  it("expires when its night ends, at 17:00 the next day in Nepal", () => {
    expect(nightEndsAt("2026-09-14")).toEqual(nepal("2026-09-15", "17:00"));
    // Month and year roll over like any other day.
    expect(nightEndsAt("2026-12-31")).toEqual(nepal("2027-01-01", "17:00"));
  });

  it("names the resident, hostel and night, and cannot pass as an access token", async () => {
    process.env.JWT_ACCESS_SECRET ??= "test-access-secret";

    const { answerPath, answerToken } = await nightAnswerData(
      { hostelId: "hostel-1", night: "2026-09-14", userId: "user-1" },
      nepal("2026-09-14", "20:00"),
    );
    const claims = await verifyPurposeToken(answerToken, "night-status-answer");

    expect(answerPath).toBe("/api/v1/resident/night-status/answer");
    expect(claims).toMatchObject({ hostelId: "hostel-1", night: "2026-09-14", sub: "user-1" });
    // Twenty-one hours from 20:00 to 17:00 the next day.
    expect(Number(claims.exp) - Number(claims.iat)).toBeGreaterThan(20 * 3600);
    await expect(verifyAccessToken(answerToken)).rejects.toThrow();
  });
});
