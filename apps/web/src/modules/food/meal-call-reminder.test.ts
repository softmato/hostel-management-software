import { describe, expect, it } from "vitest";
import { Types } from "mongoose";

import { dueMeals } from "@/modules/food/meal-call-reminder.service";

/**
 * The half of the reminder job that decides *which* meals just came due.
 *
 * Everything expensive in `runMealCallReminders` — the rosters, the claim, the
 * push — hangs off this list, and everything interesting about it is a clock in
 * a timezone the test machine is not in. NPT is UTC+05:45, so the times below
 * are written as UTC instants and the expected weekday is Nepal's.
 */

const hostelId = new Types.ObjectId();

function routine(
  timings: Record<string, string>,
  meals: Array<{ dayOfWeek: string; items?: string[]; mealType: string }> = [],
) {
  return [
    {
      hostelId,
      meals,
      timings,
    },
  ] as Parameters<typeof dueMeals>[0];
}

/** Nepal's Monday, at the UTC instant that is 05:30 there. */
const mondayAt = (hhmm: string) => {
  const [hour, minute] = hhmm.split(":").map(Number);
  // 2026-09-07 is a Monday. Subtract the 5:45 offset to get the UTC instant.
  return new Date(Date.UTC(2026, 8, 7, hour, minute) - (5 * 60 + 45) * 60_000);
};

const breakfast = [{ dayOfWeek: "MONDAY", items: ["Chiya", "Roti"], mealType: "BREAKFAST" }];

describe("dueMeals", () => {
  it("picks a meal up the moment its button unlocks", () => {
    const routines = routine({ BREAKFAST: "6:00 AM - 7:00 AM" }, breakfast);

    expect(dueMeals(routines, mondayAt("05:29"))).toEqual([]);
    expect(dueMeals(routines, mondayAt("05:30"))).toEqual([
      { hostelId, mealType: "BREAKFAST", timing: "6:00 AM - 7:00 AM" },
    ]);
  });

  /*
   * The window is what makes a fifteen-minute cron able to catch a meal that
   * came due between two runs. It has to close, though: a scheduler outage over
   * breakfast must not deliver "breakfast is due" at lunchtime.
   */
  it("keeps a late run inside the grace window and drops it after", () => {
    const routines = routine({ BREAKFAST: "6:00 AM - 7:00 AM" }, breakfast);

    expect(dueMeals(routines, mondayAt("06:15"))).toHaveLength(1);
    expect(dueMeals(routines, mondayAt("06:16"))).toEqual([]);
    expect(dueMeals(routines, mondayAt("12:00"))).toEqual([]);
  });

  /*
   * A hostel that serves no Monday snack should not be nudged about one. The
   * button is still there — an unplanned snack is announceable — but it is the
   * kitchen's own idea and not something to prompt.
   */
  it("ignores a meal that is not on today's weekday routine", () => {
    const routines = routine({ SNACKS: "3:00 PM - 5:00 PM" }, [
      { dayOfWeek: "FRIDAY", items: ["Samosa"], mealType: "SNACKS" },
    ]);

    expect(dueMeals(routines, mondayAt("14:30"))).toEqual([]);
  });

  it("ignores a weekday row an admin emptied", () => {
    const routines = routine({ BREAKFAST: "6:00 AM - 7:00 AM" }, [
      { dayOfWeek: "MONDAY", items: [], mealType: "BREAKFAST" },
    ]);

    expect(dueMeals(routines, mondayAt("05:35"))).toEqual([]);
  });

  /*
   * No clock means no gate, and no gate means there was never a moment the
   * button went live — so there is nothing to announce the arrival of.
   */
  it("ignores a timing that is not a clock", () => {
    const routines = routine({ BREAKFAST: "after morning prayers" }, breakfast);

    expect(dueMeals(routines, mondayAt("05:35"))).toEqual([]);
    expect(dueMeals(routines, mondayAt("09:00"))).toEqual([]);
  });

  /*
   * Dinner is decided in the 18:15–24:00 UTC window, where the Nepali date has
   * already rolled over. A weekday read off UTC would look for Tuesday's
   * routine while the kitchen is still cooking Monday's.
   */
  it("reads the weekday in Nepal, not in UTC", () => {
    const routines = routine({ DINNER: "7:00 PM - 8:45 PM" }, [
      { dayOfWeek: "MONDAY", items: ["Dal bhat"], mealType: "DINNER" },
    ]);

    // 18:35 in Nepal on Monday is 12:50 UTC — still Monday everywhere.
    expect(dueMeals(routines, mondayAt("18:35"))).toHaveLength(1);
  });

  it("returns every hostel whose meal is due, and nothing else", () => {
    const other = new Types.ObjectId();
    const routines = [
      ...routine({ BREAKFAST: "6:00 AM - 7:00 AM" }, breakfast),
      {
        hostelId: other,
        meals: [{ dayOfWeek: "MONDAY", items: ["Dal bhat"], mealType: "LUNCH" }],
        timings: { LUNCH: "12:00 PM - 1:00 PM" },
      },
    ] as Parameters<typeof dueMeals>[0];

    expect(dueMeals(routines, mondayAt("05:35")).map((meal) => meal.mealType)).toEqual([
      "BREAKFAST",
    ]);
    expect(dueMeals(routines, mondayAt("11:35")).map((meal) => meal.hostelId)).toEqual([
      other,
    ]);
  });
});
