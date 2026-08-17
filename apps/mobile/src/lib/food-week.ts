/**
 * The food routine's vocabulary, and which day and meal it is on Kathmandu's
 * clock.
 *
 * The day and meal enums live **here** rather than in `lib/resident-api.ts`
 * because that module imports the axios client, which pulls in React Native —
 * and Vitest here runs node-side with no RN shim, so importing it makes a test
 * file unloadable. `resident-api` re-exports them, so callers still have one
 * obvious place to reach for.
 *
 * This needs testing more than most of the Food screen does: every function is
 * an index into a seven-element array derived from a timezone the device is not
 * necessarily in, which is the shape of bug that shows up as "the app showed me
 * Thursday's dinner" a week after release. NPT is UTC+05:45, so between 18:15
 * and 24:00 UTC the Nepali day is already tomorrow — and that window is the
 * evening, precisely when someone opens the app to see what dinner is.
 */

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

/** Sunday-based, which is the week start Nepal uses. */
export const ROUTINE_DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

export type RoutineDay = (typeof ROUTINE_DAYS)[number];

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

function nepalClock(now: Date) {
  return new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000);
}

export function todayInNepal(now: Date = new Date()): RoutineDay {
  return ROUTINE_DAYS[nepalClock(now).getUTCDay()];
}

/**
 * This week's occurrence of `day`, as a midnight ISO string.
 *
 * Feedback carries the date it is about. Sending *today's* date whatever day is
 * selected would file Friday's complaint against Wednesday's dinner, and the
 * owner's analytics would blame the wrong meal — which is worse than no
 * analytics, because it is actionable and wrong.
 */
export function dateForDay(day: RoutineDay, now: Date = new Date()): string {
  const clock = nepalClock(now);
  const difference = ROUTINE_DAYS.indexOf(day) - clock.getUTCDay();

  return new Date(
    Date.UTC(
      clock.getUTCFullYear(),
      clock.getUTCMonth(),
      clock.getUTCDate() + difference,
    ),
  ).toISOString();
}

/**
 * Which meal a photo taken *now* belongs to.
 *
 * Guessed from the clock rather than asked. A picker between "I want to share
 * this" and the photo being shared is where people give up, and a wrong guess
 * costs the hostel nothing — nobody audits which bucket a curry photo landed in.
 */
export function mealTypeNow(now: Date = new Date()): MealType {
  const hour = nepalClock(now).getUTCHours();

  if (hour < 10) return MEAL_TYPES[0];
  if (hour < 15) return MEAL_TYPES[1];
  if (hour < 18) return MEAL_TYPES[2];

  return MEAL_TYPES[3];
}
