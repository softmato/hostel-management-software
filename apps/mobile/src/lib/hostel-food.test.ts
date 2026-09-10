import { describe, expect, it } from "vitest";

import {
  dayLabel,
  foodFacts,
  leadDay,
  routineDays,
  todayName,
} from "@/lib/hostel-food";
import type { PublicFoodRoutine } from "@/lib/public-api";

function meal(
  dayOfWeek: string,
  mealType: string,
  items: string[],
  extra: { note?: string; timing?: string } = {},
) {
  return {
    dayOfWeek,
    items,
    mealType,
    note: extra.note ?? "",
    timing: extra.timing ?? "",
  };
}

function routine(meals: PublicFoodRoutine["meals"]): PublicFoodRoutine {
  return { meals, monthEndSpecial: null, timings: {}, updatedAt: "" };
}

describe("routineDays", () => {
  it("orders the week Sunday-first, the way the kitchen screen is configured", () => {
    const days = routineDays(
      routine([
        meal("FRIDAY", "DINNER", ["Dal, Bhat, Masu"]),
        meal("SUNDAY", "LUNCH", ["Dal, Bhat, Tarkari"]),
        meal("WEDNESDAY", "BREAKFAST", ["Paratha, Tea"]),
      ]),
    );

    expect(days.map((day) => day.day)).toEqual(["SUNDAY", "WEDNESDAY", "FRIDAY"]);
  });

  it("orders a day's meals breakfast to dinner, not by how they were saved", () => {
    const [sunday] = routineDays(
      routine([
        meal("SUNDAY", "DINNER", ["Dal, Bhat"]),
        meal("SUNDAY", "BREAKFAST", ["Roti, Tea"]),
        meal("SUNDAY", "SNACKS", ["Chiura"]),
      ]),
    );

    expect(sunday.meals.map((entry) => entry.label)).toEqual([
      "Breakfast",
      "Snacks",
      "Dinner",
    ]);
  });

  it("drops a day the hostel does not serve rather than showing four dashes", () => {
    // A half-filled routine is normal — the alternative is a heading with an
    // empty card under it, which reads as the app failing rather than the
    // kitchen being closed.
    const days = routineDays(routine([meal("MONDAY", "LUNCH", ["Dal, Bhat"])]));

    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("MONDAY");
  });

  it("drops a meal saved with no items — a blank cell is not a meal of nothing", () => {
    const days = routineDays(
      routine([meal("MONDAY", "LUNCH", ["Dal, Bhat"]), meal("MONDAY", "DINNER", [])]),
    );

    expect(days[0].meals.map((entry) => entry.label)).toEqual(["Lunch"]);
  });

  it("carries the timing and the note through", () => {
    const [monday] = routineDays(
      routine([
        meal("MONDAY", "DINNER", ["Dal, Bhat, Masu"], {
          note: "Meat night",
          timing: "8:00 pm",
        }),
      ]),
    );

    expect(monday.meals[0]).toMatchObject({
      note: "Meat night",
      timing: "8:00 pm",
    });
  });

  it("returns nothing for a hostel with no routine at all", () => {
    expect(routineDays(undefined)).toEqual([]);
    expect(routineDays(routine([]))).toEqual([]);
  });
});

describe("leadDay", () => {
  const days = routineDays(
    routine([
      meal("MONDAY", "LUNCH", ["Dal, Bhat"]),
      meal("THURSDAY", "LUNCH", ["Dal, Bhat, Saag"]),
    ]),
  );

  it("opens on today when the hostel serves today", () => {
    expect(leadDay(days, "THURSDAY")?.day).toBe("THURSDAY");
  });

  it("falls back to the first day served, so the section is never empty", () => {
    // Somebody opening the listing on a Saturday must still see what the
    // kitchen does, not a Food heading over nothing.
    expect(leadDay(days, "SATURDAY")?.day).toBe("MONDAY");
  });

  it("has nothing to open when no day is served", () => {
    expect(leadDay([], "SATURDAY")).toBeUndefined();
  });
});

describe("todayName", () => {
  it("names the weekday the way the routine does", () => {
    // 2026-09-10 is a Thursday.
    expect(todayName(new Date(2026, 8, 10))).toBe("THURSDAY");
    expect(todayName(new Date(2026, 8, 13))).toBe("SUNDAY");
  });
});

describe("dayLabel", () => {
  it("title-cases the stored day", () => {
    expect(dayLabel("WEDNESDAY")).toBe("Wednesday");
  });
});

describe("foodFacts", () => {
  it("reads the chips off what the hostel said it serves", () => {
    expect(
      foodFacts({ hasNonVeg: true, hasVeg: true, mealsPerDay: 3, notes: "No jain" }),
    ).toEqual(["3 meals a day", "Veg", "Non-veg", "No jain"]);
  });

  it("says nothing when the hostel filled none of it in", () => {
    expect(foodFacts({})).toEqual([]);
  });
});
