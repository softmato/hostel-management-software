/**
 * Reading a hostel's weekly food routine into what a phone screen shows.
 *
 * Pure and free of React Native imports so it can be tested node-side, the same
 * way `hostel-nearby.ts` is.
 *
 * ## Why the shape differs from the website's
 *
 * The website prints the routine as a seven-row table with a column per meal.
 * A phone has one column, so the screen shows one day at a time — today, the
 * day a visitor can check by turning up — and opens the rest in a sheet. That
 * makes "which day is today" and "which days does this hostel actually serve"
 * decisions rather than rendering details, which is why they live here.
 *
 * ## A day the hostel does not serve is dropped
 *
 * A routine can be half filled: a hostel that serves nothing on Saturday has no
 * rows for it. Rendering the day anyway gives four dashes under a heading, which
 * reads as the app failing to load rather than the kitchen being closed.
 */

import type { PublicFoodRoutine } from "@/lib/public-api";

/** Sunday-first, matching how the hostel's own kitchen screen is configured. */
export const ROUTINE_DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

export const ROUTINE_MEALS = [
  { label: "Breakfast", type: "BREAKFAST" },
  { label: "Lunch", type: "LUNCH" },
  { label: "Snacks", type: "SNACKS" },
  { label: "Dinner", type: "DINNER" },
] as const;

/** One day of the routine, carrying only the meals the hostel serves. */
export type RoutineDay = {
  day: string;
  meals: {
    items: string[];
    label: string;
    note: string;
    timing: string;
    type: string;
  }[];
};

export function dayLabel(day: string) {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

/** Which weekday it is where the reader is standing, in the routine's terms. */
export function todayName(now = new Date()): string {
  return ROUTINE_DAYS[now.getDay()];
}

/**
 * The routine as day rows, Sunday first, with empty days dropped.
 *
 * A meal the hostel listed with no items is dropped too — an entry saved as a
 * blank cell is the kitchen not having said, not a meal of nothing.
 */
export function routineDays(routine: PublicFoodRoutine | undefined): RoutineDay[] {
  const meals = routine?.meals ?? [];

  return ROUTINE_DAYS.map((day) => ({
    day: day as string,
    meals: ROUTINE_MEALS.map((meal): RoutineDay["meals"][number] | null => {
      const entry = meals.find(
        (candidate) => candidate.dayOfWeek === day && candidate.mealType === meal.type,
      );

      return entry && entry.items.length > 0
        ? {
            items: entry.items,
            label: meal.label,
            note: entry.note ?? "",
            timing: entry.timing ?? "",
            type: meal.type,
          }
        : null;
    }).filter((meal): meal is RoutineDay["meals"][number] => meal !== null),
  })).filter((row) => row.meals.length > 0);
}

/**
 * The day to open the section on: today, or the first day served.
 *
 * Falling back matters — a hostel that serves nothing on the day somebody opens
 * the listing would otherwise show an empty Food section and look as though it
 * feeds nobody at all.
 */
export function leadDay(days: RoutineDay[], today: string): RoutineDay | undefined {
  return days.find((row) => row.day === today) ?? days[0];
}

/** The chips above the routine: what is served, not when. */
export function foodFacts(food: {
  hasNonVeg?: boolean;
  hasVeg?: boolean;
  mealsPerDay?: number;
  notes?: string;
}): string[] {
  return [
    food.mealsPerDay ? `${food.mealsPerDay} meals a day` : null,
    food.hasVeg ? "Veg" : null,
    food.hasNonVeg ? "Non-veg" : null,
    food.notes,
  ].filter((fact): fact is string => Boolean(fact));
}
