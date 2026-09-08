import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_MINUTES,
  MEAL_ANNOUNCE_LATE_MINUTES,
  MEAL_ANNOUNCE_LEAD_MINUTES,
  canAnnounceMeal,
  formatMinuteOfDay,
  mealAnnounceState,
  mealClosesAtMinute,
  mealOpensAtMinute,
  nepalDayKey,
  nepalMinuteOfDay,
  nepalWeekday,
  parseMealWindow,
} from "@hostel/shared/food/meal-window";

/**
 * The meal-window rule, tested from here for the reason `bs-calendar.test.ts`
 * is: the shared package has no runner of its own, and the web suite already
 * resolves `@hostel/shared` to the same source both apps ship.
 *
 * The cook portal's button gate and the server's announce guard are both this
 * file, so a bad parse here is a kitchen that cannot call dinner. The cases
 * below are the strings the product actually produces: the four seeded defaults
 * from the admin form, and the shapes hostels type over them with.
 */
describe("parseMealWindow", () => {
  it("reads the four timings the admin form seeds", () => {
    expect(parseMealWindow("6:00 AM - 7:00 AM")).toEqual({
      endMinute: 7 * 60,
      startMinute: 6 * 60,
    });
    expect(parseMealWindow("8:45 AM - 12:00 PM")).toEqual({
      endMinute: 12 * 60,
      startMinute: 8 * 60 + 45,
    });
    expect(parseMealWindow("3:00 PM - 5:00 PM")).toEqual({
      endMinute: 17 * 60,
      startMinute: 15 * 60,
    });
    expect(parseMealWindow("7:00 PM - 8:45 PM")).toEqual({
      endMinute: 20 * 60 + 45,
      startMinute: 19 * 60,
    });
  });

  it("reads a single time, with or without a meridiem", () => {
    expect(parseMealWindow("7 PM")).toEqual({ endMinute: null, startMinute: 19 * 60 });
    expect(parseMealWindow("18:30")).toEqual({
      endMinute: null,
      startMinute: 18 * 60 + 30,
    });
  });

  /*
   * A phone keyboard produces an en dash, and `7:00–8:45` is one token to
   * whitespace splitting. Hostels also write the separator as a word.
   */
  it("accepts dashes of every kind and separators written out", () => {
    const evening = { endMinute: 20 * 60 + 45, startMinute: 19 * 60 };

    expect(parseMealWindow("7:00 PM–8:45 PM")).toEqual(evening);
    expect(parseMealWindow("7:00 PM — 8:45 PM")).toEqual(evening);
    expect(parseMealWindow("7:00 PM to 8:45 PM")).toEqual(evening);
    expect(parseMealWindow("7:00 PM till 8:45 PM")).toEqual(evening);
  });

  /*
   * The case a bare-hour window turns on. `6:00 - 7:00 AM` has to be a morning
   * window; reading the 6 as 24-hour would be right by luck here and wrong for
   * `7:00 - 8:45 PM`, which is dinner and not a twelve-hour-earlier breakfast.
   */
  it("lends the second reading's meridiem to a bare first one", () => {
    expect(parseMealWindow("6:00 - 7:00 AM")).toEqual({
      endMinute: 7 * 60,
      startMinute: 6 * 60,
    });
    expect(parseMealWindow("7:00 - 8:45 PM")).toEqual({
      endMinute: 20 * 60 + 45,
      startMinute: 19 * 60,
    });
  });

  /*
   * ...but only when it does not invert the window. `11:00 - 1:00 PM` is a late
   * breakfast that ends after lunch starts, not an 11pm one.
   */
  it("keeps a start that borrowing would push past the end", () => {
    expect(parseMealWindow("11:00 - 1:00 PM")).toEqual({
      endMinute: 13 * 60,
      startMinute: 11 * 60,
    });
  });

  it("handles the two hours the 12-hour clock disagrees with arithmetic on", () => {
    expect(parseMealWindow("12:00 AM")).toEqual({ endMinute: null, startMinute: 0 });
    expect(parseMealWindow("12:30 PM")).toEqual({
      endMinute: null,
      startMinute: 12 * 60 + 30,
    });
  });

  it("tolerates punctuation and prose around the clock", () => {
    expect(parseMealWindow("  7:00 p.m.  ")).toEqual({
      endMinute: null,
      startMinute: 19 * 60,
    });
    expect(parseMealWindow("Sharp at 7:00 PM, please")).toEqual({
      endMinute: null,
      startMinute: 19 * 60,
    });
  });

  /*
   * `null` is not an error path — it is what turns the gate off, so a hostel
   * that writes something we cannot read keeps a working button.
   */
  it("returns null when there is no clock in the string", () => {
    expect(parseMealWindow("")).toBeNull();
    expect(parseMealWindow(undefined)).toBeNull();
    expect(parseMealWindow("after evening prayers")).toBeNull();
    expect(parseMealWindow("25:00")).toBeNull();
    expect(parseMealWindow("7:99")).toBeNull();
  });
});

describe("mealOpensAtMinute", () => {
  it("unlocks the announce button one lead ahead of service", () => {
    expect(mealOpensAtMinute("6:00 AM - 7:00 AM")).toBe(
      6 * 60 - MEAL_ANNOUNCE_LEAD_MINUTES,
    );
  });

  /*
   * A meal that must never be callable "yesterday". Clamped rather than
   * wrapped, which is the one direction this arithmetic must not go.
   */
  it("clamps a meal served just after midnight to midnight itself", () => {
    expect(mealOpensAtMinute("12:15 AM")).toBe(0);
  });

  it("is null when the timing carries no clock, which means no gate", () => {
    expect(mealOpensAtMinute("whenever it's ready")).toBeNull();
  });
});

describe("canAnnounceMeal", () => {
  const dinner = "7:00 PM - 8:45 PM";

  it("refuses before the lead and allows from it onwards", () => {
    expect(canAnnounceMeal(dinner, 18 * 60 + 29)).toBe(false);
    expect(canAnnounceMeal(dinner, 18 * 60 + 30)).toBe(true);
    expect(canAnnounceMeal(dinner, 19 * 60)).toBe(true);
  });

  /*
   * Food runs late far more often than early, so service ending is not the
   * cut-off — a dinner served at half nine still has to reach the building.
   */
  it("stays open for an hour past the end of service", () => {
    expect(canAnnounceMeal(dinner, 21 * 60 + 30)).toBe(true);
    expect(canAnnounceMeal(dinner, 21 * 60 + 45)).toBe(true);
  });

  /*
   * And then it shuts. The window closing is what lets the cook's screen say
   * `Not announced in time` — a button left live all evening records nothing.
   */
  it("closes once the grace has run out", () => {
    expect(canAnnounceMeal(dinner, 21 * 60 + 46)).toBe(false);
    expect(canAnnounceMeal(dinner, 23 * 60 + 59)).toBe(false);
  });

  it("allows anything when the timing cannot be read", () => {
    expect(canAnnounceMeal("", 0)).toBe(true);
    expect(canAnnounceMeal("after evening prayers", 3 * 60)).toBe(true);
  });
});

describe("mealClosesAtMinute", () => {
  it("shuts an hour after service ends", () => {
    expect(mealClosesAtMinute("7:00 PM - 8:45 PM")).toBe(
      20 * 60 + 45 + MEAL_ANNOUNCE_LATE_MINUTES,
    );
  });

  /* A single written time is a start, so something has to end it. */
  it("gives a single time a default stretch of service first", () => {
    expect(mealClosesAtMinute("7 PM")).toBe(
      19 * 60 + DEFAULT_SERVICE_MINUTES + MEAL_ANNOUNCE_LATE_MINUTES,
    );
  });

  /*
   * A late dinner's grace must not spill into tomorrow, where it would collide
   * with breakfast and reopen a meal a day after it was missed.
   */
  it("never runs past the end of the day", () => {
    expect(mealClosesAtMinute("11:30 PM")).toBe(24 * 60 - 1);
  });

  it("is null when there is no gate", () => {
    expect(mealClosesAtMinute("when the bell rings")).toBeNull();
  });
});

describe("mealAnnounceState", () => {
  const dinner = "7:00 PM - 8:45 PM";

  /*
   * The three states have to be distinguishable, not just "allowed or not":
   * the app writes `Opens 6:30 PM` for one and `Not announced in time` for the
   * other, and the server returns a different error code for each.
   */
  it("names which side of the window the meal is on", () => {
    expect(mealAnnounceState(dinner, 18 * 60 + 29)).toBe("EARLY");
    expect(mealAnnounceState(dinner, 18 * 60 + 30)).toBe("OPEN");
    expect(mealAnnounceState(dinner, 21 * 60 + 45)).toBe("OPEN");
    expect(mealAnnounceState(dinner, 21 * 60 + 46)).toBe("MISSED");
  });

  it("is ungated when the timing carries no clock", () => {
    expect(mealAnnounceState("after evening prayers", 3 * 60)).toBe("ANY");
    expect(mealAnnounceState("", 23 * 60)).toBe("ANY");
  });
});

describe("formatMinuteOfDay", () => {
  it("writes the 12-hour clock a cook reads off the wall", () => {
    expect(formatMinuteOfDay(0)).toBe("12:00 AM");
    expect(formatMinuteOfDay(5 * 60 + 30)).toBe("5:30 AM");
    expect(formatMinuteOfDay(12 * 60)).toBe("12:00 PM");
    expect(formatMinuteOfDay(18 * 60 + 30)).toBe("6:30 PM");
  });
});

/*
 * NPT is UTC+05:45, so between 18:15 and 24:00 UTC the Nepali day is already
 * tomorrow — the window in which a dinner reminder is decided, and the one an
 * offset bug would land in.
 */
describe("the Nepali clock", () => {
  it("reads the minute of day in Nepal, not in UTC", () => {
    expect(nepalMinuteOfDay(new Date("2026-09-07T00:00:00.000Z"))).toBe(5 * 60 + 45);
    expect(nepalMinuteOfDay(new Date("2026-09-07T13:15:00.000Z"))).toBe(19 * 60);
  });

  it("rolls the day over at Nepali midnight, not UTC's", () => {
    // 18:14 UTC is 23:59 in Nepal; a minute later it is tomorrow there.
    expect(nepalDayKey(new Date("2026-09-07T18:14:00.000Z"))).toBe("2026-09-07");
    expect(nepalDayKey(new Date("2026-09-07T18:15:00.000Z"))).toBe("2026-09-08");
    expect(nepalWeekday(new Date("2026-09-07T18:14:00.000Z"))).toBe(1);
    expect(nepalWeekday(new Date("2026-09-07T18:15:00.000Z"))).toBe(2);
  });
});
