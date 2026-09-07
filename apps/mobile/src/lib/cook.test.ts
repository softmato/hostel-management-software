import { describe, expect, it } from "vitest";

import type {
  CookFoodPhoto,
  CookPhotoDay,
  FoodReadyAnnouncement,
  FoodReadySent,
} from "@/lib/cook-api";
import {
  announcedCount,
  announcementSummary,
  mealButtonLabel,
  mealButtons,
  mealLockNote,
  mealSubtitle,
  mealsToCall,
  openButtons,
  mergePhotoDays,
  nextUnannounced,
  searchCookResidents,
} from "@/lib/cook";
import type { RoutineMeal } from "@/lib/resident-api";

function meal(overrides: Partial<RoutineMeal> = {}): RoutineMeal {
  return {
    dayOfWeek: "MONDAY",
    items: ["Dal bhat"],
    mealType: "LUNCH",
    note: "",
    timing: "12:30",
    ...overrides,
  };
}

/**
 * A UTC instant that is `hh:mm` in Nepal, which is the only clock the meal gate
 * reads. Every test that cares about time pins one rather than letting
 * `new Date()` decide — a suite that passes before noon and fails after it is
 * worse than no suite.
 */
function nepalTime(hhmm: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);

  return new Date(Date.UTC(2026, 8, 7, hour, minute) - (5 * 60 + 45) * 60_000);
}

function announcement(
  overrides: Partial<FoodReadyAnnouncement> = {},
): FoodReadyAnnouncement {
  return {
    announcedAt: "2026-08-17T07:00:00.000Z",
    id: "log-1",
    mealType: "LUNCH",
    message: "Today's lunch: Dal bhat, chicken",
    notifiedCount: 38,
    ...overrides,
  };
}

describe("mealButtons", () => {
  /*
   * Always four. A kitchen serving an unplanned snack still needs to tell
   * people, and hiding the button because an admin left a cell blank makes the
   * app least useful exactly when the routine is out of date.
   */
  it("always offers all four meals in serving order", () => {
    const buttons = mealButtons([], []);

    expect(buttons.map((button) => button.mealType)).toEqual([
      "BREAKFAST",
      "LUNCH",
      "SNACKS",
      "DINNER",
    ]);
  });

  it("labels an unplanned meal rather than dropping it", () => {
    const [breakfast] = mealButtons([meal()], []);

    expect(breakfast?.items).toEqual([]);
    expect(mealSubtitle(breakfast!)).toBe("Nothing planned for today");
  });

  it("carries today's items and timing onto the button", () => {
    const buttons = mealButtons([meal()], []);
    const lunch = buttons.find((button) => button.mealType === "LUNCH");

    expect(lunch?.items).toEqual(["Dal bhat"]);
    expect(lunch?.timing).toBe("12:30");
  });

  it("marks a meal that has already gone out", () => {
    const buttons = mealButtons([meal()], [announcement()]);
    const lunch = buttons.find((button) => button.mealType === "LUNCH");

    expect(lunch?.sent?.notifiedCount).toBe(38);
    expect(announcedCount(buttons)).toBe(1);
  });

  it("keeps the latest announcement when a meal was called twice", () => {
    // Server order is newest first.
    const buttons = mealButtons(
      [meal()],
      [
        announcement({ id: "second", message: "Lunch is ready (second sitting)" }),
        announcement({ id: "first" }),
      ],
    );

    expect(buttons.find((button) => button.mealType === "LUNCH")?.sent?.id).toBe("second");
  });
});

describe("mealButtonLabel", () => {
  /*
   * Not a disabled button. The server owns the cooldown and returns a 429
   * naming the wait; a cook re-calling a late sitting must be able to try, and
   * a client-side rule would drift the moment `foodReadyCooldownMinutes`
   * changes.
   */
  it("offers a second announcement rather than locking the button", () => {
    const [, lunch] = mealButtons([meal()], [announcement()]);

    expect(mealButtonLabel(lunch!)).toBe("Announce again");
  });

  it("reads plainly the first time", () => {
    const [breakfast] = mealButtons([], []);

    expect(mealButtonLabel(breakfast!)).toBe("Food ready");
  });
});

describe("mealSubtitle", () => {
  it("prefers what was announced over what was planned", () => {
    const buttons = mealButtons(
      [meal({ items: ["Dal bhat"] })],
      [announcement({ message: "Today's lunch: Dal bhat, chicken" })],
    );

    expect(mealSubtitle(buttons.find((button) => button.mealType === "LUNCH")!)).toBe(
      "Today's lunch: Dal bhat, chicken",
    );
  });
});

describe("announcementSummary", () => {
  function sent(overrides: Partial<FoodReadySent> = {}): FoodReadySent {
    return { ...announcement(), staffNotifiedCount: 0, ...overrides };
  }

  /*
   * A 201 means the announcement was recorded, not that anyone heard it — the
   * same trap as the SOS fan-out. A hostel whose residents have no accounts
   * gets zero.
   */
  it("says so plainly when the announcement reached nobody at all", () => {
    const summary = announcementSummary(sent({ notifiedCount: 0 }));

    expect(summary.reached).toBe(false);
    expect(summary.body).toBe(
      "This announcement was recorded, but nobody was notified.",
    );
  });

  /*
   * Worth distinguishing: the app is working, and the gap is that residents
   * have not installed it — which an admin can fix and a cook cannot.
   */
  it("distinguishes reaching only the office from reaching nobody", () => {
    const summary = announcementSummary(sent({ notifiedCount: 0, staffNotifiedCount: 2 }));

    expect(summary.reached).toBe(false);
    expect(summary.body).toBe(
      "No resident here has an app account yet. The hostel office was notified as well.",
    );
  });

  it("leads with the resident count, and mentions the office when there is one", () => {
    expect(announcementSummary(sent({ notifiedCount: 38, staffNotifiedCount: 3 })).body).toBe(
      "38 resident(s) notified. The hostel office was notified as well.",
    );
    expect(announcementSummary(sent({ notifiedCount: 38 })).body).toBe(
      "38 resident(s) notified.",
    );
  });
});

describe("mealsToCall", () => {
  it("counts what is left, and is zero once the shift is done", () => {
    const buttons = mealButtons(
      [meal({ mealType: "BREAKFAST" }), meal({ mealType: "LUNCH" })],
      [announcement({ mealType: "BREAKFAST" })],
      // Past every timing in the fixture, so nothing is locked out of the count.
      nepalTime("13:00"),
    );

    // Four buttons always, one of them sent.
    expect(mealsToCall(buttons)).toBe(3);
    expect(
      mealsToCall(
        mealButtons(
          [],
          ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].map((mealType) =>
            announcement({ mealType }),
          ),
        ),
      ),
    ).toBe(0);
  });

  /*
   * A badge reading `4` at six in the morning says the kitchen is four jobs
   * behind when it is exactly on time, and a number that is wrong before
   * breakfast is one nobody reads by Friday.
   */
  it("does not count a meal the kitchen cannot call yet", () => {
    const buttons = mealButtons(
      [meal({ mealType: "LUNCH", timing: "12:00 PM - 1:00 PM" })],
      [],
      nepalTime("08:00"),
    );

    // Lunch is locked; the other three have no timing and so no gate.
    expect(mealsToCall(buttons)).toBe(3);
    expect(mealsToCall(mealButtons(
      [meal({ mealType: "LUNCH", timing: "12:00 PM - 1:00 PM" })],
      [],
      nepalTime("11:30"),
    ))).toBe(4);
  });
});

/**
 * The gate itself. It is the same `@hostel/food/meal-window` decision
 * `announceFoodReady` refuses on, which is the point — these tests are as much
 * about the button and the API agreeing as about either one.
 */
describe("the meal gate", () => {
  const lunch = () => meal({ mealType: "LUNCH", timing: "12:00 PM - 1:00 PM" });
  const lunchAt = (hhmm: string) =>
    mealButtons([lunch()], [], nepalTime(hhmm)).find(
      (button) => button.mealType === "LUNCH",
    )!;

  it("locks a meal until half an hour before it is served", () => {
    expect(lunchAt("11:29").locked).toBe(true);
    expect(lunchAt("11:30").locked).toBe(false);
    expect(lunchAt("12:00").locked).toBe(false);
  });

  /* Food runs late far more often than early. A 2pm lunch still has to go out. */
  it("never locks again once the meal is due", () => {
    expect(lunchAt("14:00").locked).toBe(false);
    expect(lunchAt("23:59").locked).toBe(false);
  });

  /*
   * The deliberate default. A hostel that has not filled its routine in, or
   * that wrote something we cannot read a clock out of, keeps four working
   * buttons — the app must not break a kitchen over a formatting opinion.
   */
  it("does not gate a meal whose timing is not a clock", () => {
    const buttons = mealButtons(
      [meal({ mealType: "LUNCH", timing: "after the bell" })],
      [],
      nepalTime("04:00"),
    );

    expect(buttons.every((button) => !button.locked)).toBe(true);
    expect(buttons.every((button) => button.opensAt === null)).toBe(true);
  });

  /*
   * Cannot happen on a clock that only moves forwards — the announcement had to
   * pass this same gate — but a handset with a wrong clock must not turn
   * "Announce again" into a dead button.
   */
  it("never locks a meal that has already been announced", () => {
    const buttons = mealButtons(
      [lunch()],
      [announcement({ mealType: "LUNCH" })],
      nepalTime("04:00"),
    );

    const called = buttons.find((button) => button.mealType === "LUNCH")!;

    expect(called.locked).toBe(false);
    expect(mealButtonLabel(called)).toBe("Announce again");
  });

  it("puts the unlock hour on the button and in the note", () => {
    const locked = lunchAt("09:00");

    expect(locked.opensAt).toBe("11:30 AM");
    expect(mealButtonLabel(locked)).toBe("Opens 11:30 AM");
    expect(mealLockNote(locked)).toBe("You can call this meal from 11:30 AM.");
  });

  it("says nothing about a meal the kitchen can call", () => {
    expect(mealLockNote(lunchAt("12:30"))).toBeNull();
  });

  it("lists the meals that are callable now", () => {
    const buttons = mealButtons(
      [lunch(), meal({ mealType: "DINNER", timing: "7:00 PM - 8:45 PM" })],
      [],
      nepalTime("12:30"),
    );

    // Breakfast and snacks have no timing in this routine, so no gate.
    expect(openButtons(buttons).map((button) => button.mealType)).toEqual([
      "BREAKFAST",
      "LUNCH",
      "SNACKS",
    ]);
  });
});

describe("mergePhotoDays", () => {
  function photo(overrides: Partial<CookFoodPhoto> = {}): CookFoodPhoto {
    return {
      caption: "",
      date: "2026-09-05T00:00:00.000Z",
      id: "p1",
      mealType: "LUNCH",
      photoAssetId: "a1",
      source: "KITCHEN",
      uploadedAt: "2026-09-05T06:30:00.000Z",
      ...overrides,
    };
  }

  function day(overrides: Partial<CookPhotoDay> = {}): CookPhotoDay {
    return { day: "2026-09-05", mealsCovered: 1, photos: [photo()], ...overrides };
  }

  it("appends days the next page has not already shown", () => {
    const merged = mergePhotoDays(
      [day({ day: "2026-09-05" })],
      [day({ day: "2026-09-04", photos: [photo({ id: "p9" })] })],
    );

    expect(merged.map((entry) => entry.day)).toEqual(["2026-09-05", "2026-09-04"]);
  });

  /*
   * The whole reason this exists: a day of 130 photos straddles the 120-photo
   * page boundary and arrives in both halves. Two cards for one date is the one
   * thing a day-grouped feed must not do.
   */
  it("folds a day that straddles the page boundary into one card", () => {
    const merged = mergePhotoDays(
      [day({ mealsCovered: 1, photos: [photo({ id: "p1", mealType: "LUNCH" })] })],
      [
        day({
          mealsCovered: 1,
          photos: [
            photo({ id: "p1", mealType: "LUNCH" }),
            photo({ id: "p2", mealType: "DINNER" }),
          ],
        }),
      ],
    );

    expect(merged).toHaveLength(1);
    // The duplicate is dropped, not drawn twice.
    expect(merged[0].photos.map((entry) => entry.id)).toEqual(["p1", "p2"]);
    // Recomputed: each page counted only its own half's coverage.
    expect(merged[0].mealsCovered).toBe(2);
  });

  it("leaves the page it was given alone", () => {
    const first = [day()];

    mergePhotoDays(first, [day({ photos: [photo({ id: "p2", mealType: "DINNER" })] })]);

    expect(first[0].photos).toHaveLength(1);
    expect(first[0].mealsCovered).toBe(1);
  });
});

describe("nextUnannounced", () => {
  it("is the first meal in serving order with nothing sent against it", () => {
    const buttons = mealButtons(
      [meal({ mealType: "BREAKFAST" }), meal({ mealType: "LUNCH" })],
      [announcement({ mealType: "BREAKFAST" })],
    );

    expect(nextUnannounced(buttons)?.mealType).toBe("LUNCH");
  });

  it("does not skip a meal the routine left blank", () => {
    // A kitchen serving an unplanned snack still has to call it, so a blank
    // routine cell must not remove the meal from the queue — the same rule
    // `mealButtons` holds about always returning four.
    const buttons = mealButtons([], []);

    expect(nextUnannounced(buttons)?.mealType).toBe("BREAKFAST");
  });

  it("returns null once all four are out", () => {
    const buttons = mealButtons(
      [],
      [
        announcement({ mealType: "BREAKFAST" }),
        announcement({ mealType: "LUNCH" }),
        announcement({ mealType: "SNACKS" }),
        announcement({ mealType: "DINNER" }),
      ],
    );

    expect(nextUnannounced(buttons)).toBeNull();
  });
});

describe("searchCookResidents", () => {
  const roster = [
    { fullName: "Sita Sharma", id: "r-1", roomType: "DOUBLE_SHARING" },
    { fullName: "Hari Thapa", id: "r-2", roomType: "SINGLE" },
  ];

  it("returns everything for an empty or whitespace query", () => {
    expect(searchCookResidents(roster, "")).toHaveLength(2);
    expect(searchCookResidents(roster, "   ")).toHaveLength(2);
  });

  it("matches a name case-insensitively", () => {
    expect(searchCookResidents(roster, "sita").map((row) => row.id)).toEqual(["r-1"]);
  });

  it("matches the room type as it is written on screen, not as the enum", () => {
    // The row reads `Double sharing` after `humanizeEnum`, so a cook types that.
    // Matching only `DOUBLE_SHARING` would be a filter nobody can use.
    expect(searchCookResidents(roster, "double sharing").map((row) => row.id)).toEqual([
      "r-1",
    ]);
  });

  it("returns a copy, so a caller sorting the result cannot reorder the roster", () => {
    const result = searchCookResidents(roster, "");

    expect(result).not.toBe(roster);
  });
});
