/**
 * When a meal is due, read off the timing the hostel actually typed.
 *
 * ## Why this is one file both ends import
 *
 * The cook's four announce buttons unlock at their meal's serving time, and the
 * server refuses an announcement made before it. Those are the same rule stated
 * twice, and the way a rule like that goes wrong is somebody maintaining two
 * implementations of it: a button that lights up at 5:30 over an API that
 * refuses until 6:00 is worse than no gate at all, because the cook presses a
 * live button and is told no.
 *
 * So the parse, the lead time and the decision live here, with no imports at
 * all — the same trick `packages/shared/src/plans` uses. The web app reaches it
 * as `@hostel/shared/food/meal-window`; the phone app is outside the npm
 * workspace and reaches it through the `@hostel/food/*` alias in
 * `metro.config.js`, `tsconfig.json` and `vitest.config.mts`.
 *
 * ## What a timing string actually looks like
 *
 * `FoodRoutine.timings` is free text, capped at 80 characters, one per meal for
 * the whole week. The admin form seeds it with `6:00 AM - 7:00 AM`, and hostels
 * type over that with `7 PM`, `18:30`, `12:00-13:30`, `8:45 AM to 12:00 PM`.
 * None of that is going to be replaced with two dropdowns — the string is what
 * residents read on their Food tab, and "7:00 PM (sharp)" carries something a
 * pair of pickers cannot. So it is parsed, and anything unparseable disables the
 * gate rather than the button.
 */

/** Minutes in a day, so a formatted minute can be wrapped into range. */
const DAY_MINUTES = 24 * 60;

/**
 * Nepal is UTC+05:45 and has never observed daylight saving, so the offset is a
 * constant rather than a timezone lookup.
 *
 * Restated here rather than imported because this file deliberately has no
 * imports; the phone app's own copy lives in `lib/format.ts`.
 */
export const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

/**
 * How early a cook may call a meal.
 *
 * Not zero. A kitchen that has breakfast out at 5:52 for a 6:00 service is a
 * kitchen doing its job, and a button that refuses them is the app telling the
 * cook they are wrong about their own worktop. Half an hour is enough to cover
 * running early without making the gate meaningless — at 30 minutes the four
 * windows in the seeded defaults still never overlap.
 *
 * There is deliberately no closing time. Food goes late far more often than it
 * goes early, and a dinner served at 21:30 must still be announceable; the gate
 * exists to stop a 6am tap on the dinner button, not to police lateness.
 */
export const MEAL_ANNOUNCE_LEAD_MINUTES = 30;

export type MealWindow = {
  /** Minutes since midnight of the end of service, when one was typed. */
  endMinute: number | null;
  /** Minutes since midnight of the start of service. */
  startMinute: number;
};

type Reading = [hour: number, minute: number, meridiem: "a" | "p" | null];

/**
 * Everything that might be a clock reading, in the order it was written.
 *
 * The string is normalised first — lowercased, `a.m.` flattened to `am`, and
 * the gap in `7 pm` closed — so that one pass of a single pattern can see the
 * hour, the minutes and the meridiem as one reading. Splitting on whitespace
 * first is what an earlier version did, and it tore `7 PM` into a bare `7` and
 * a token that is not a time: every hostel that wrote its timings with a space
 * got a breakfast gate on its dinner.
 *
 * A match with **neither** minutes nor a meridiem is dropped rather than read
 * as an hour. `Hall 2, 7:00 pm` has a `2` in it that is not a time, and a lone
 * integer is never unambiguous enough to lock a button on.
 *
 * No lookbehind, deliberately: this file is bundled into the app and runs on
 * Hermes.
 */
function readings(timing: string): Reading[] {
  const normalized = timing
    .toLowerCase()
    .replace(/[–—−]/g, " ")
    .replace(/\b(?:to|till|until)\b/g, " ")
    .replace(/([ap])\.m\.?/g, "$1m")
    .replace(/(\d)\s+([ap]m)\b/g, "$1$2");

  const found: Reading[] = [];

  for (const match of normalized.matchAll(/(\d{1,2})(?::(\d{2}))?(am|pm)?/g)) {
    const [, rawHour, rawMinute, rawMeridiem] = match;

    if (!rawMinute && !rawMeridiem) {
      continue;
    }

    const hour = Number(rawHour);
    const minute = rawMinute ? Number(rawMinute) : 0;

    if (hour > 23 || minute > 59) {
      continue;
    }

    found.push([hour, minute, rawMeridiem ? (rawMeridiem[0] as "a" | "p") : null]);
  }

  return found;
}

/**
 * A clock reading resolved to minutes since midnight.
 *
 * With no meridiem the hour is read as a **24-hour** clock, which is what makes
 * `18:30` work and is the same reading the analytics report has always used.
 * `12 AM` is midnight and `12 PM` is noon, which is the one place the 12-hour
 * clock disagrees with arithmetic.
 */
function toMinutes([hour, minute, meridiem]: Reading): number {
  if (meridiem === null) {
    return hour * 60 + minute;
  }

  const base = hour % 12;

  return (meridiem === "p" ? base + 12 : base) * 60 + minute;
}

/**
 * The serving window a timing string describes, or `null` when it describes
 * none.
 *
 * `null` is not a failure to handle loudly — it is "this hostel wrote something
 * we cannot read a clock out of", and every caller treats that as *no gate*.
 * Refusing to let a cook announce because an admin typed `after evening prayers`
 * would be the app breaking the kitchen over a formatting opinion.
 *
 * A bare first reading takes its meridiem from the second when there is one, so
 * `6:00 - 7:00 AM` is a 6am window rather than a 6am-to-7am pair that disagree
 * about which half of the day they are in. It is only borrowed when it does not
 * invert the window — `11:00 - 1:00 PM` keeps its 11am start rather than
 * becoming 11pm.
 */
export function parseMealWindow(timing: string | null | undefined): MealWindow | null {
  const found = readings(timing ?? "");

  if (found.length === 0) {
    return null;
  }

  const [first, second] = found;

  if (!second) {
    return { endMinute: null, startMinute: toMinutes(first) };
  }

  const endMinute = toMinutes(second);
  const borrowed: Reading =
    first[2] === null && second[2] !== null ? [first[0], first[1], second[2]] : first;
  const candidate = toMinutes(borrowed);

  return {
    endMinute,
    startMinute: candidate <= endMinute ? candidate : toMinutes(first),
  };
}

/**
 * The minute of the day the announce button unlocks, or `null` when the timing
 * cannot be read and the meal is therefore always announceable.
 *
 * Clamped at midnight rather than wrapping into the previous day: a 00:15
 * breakfast would otherwise unlock at 23:45 *yesterday*, and a meal that can be
 * called before the day it belongs to has begun is the one thing this gate
 * exists to prevent.
 */
export function mealOpensAtMinute(timing: string | null | undefined): number | null {
  const window = parseMealWindow(timing);

  if (!window) {
    return null;
  }

  return Math.max(0, window.startMinute - MEAL_ANNOUNCE_LEAD_MINUTES);
}

/**
 * May this meal be announced right now?
 *
 * `true` whenever the timing is unreadable or absent, which is the deliberate
 * default: a hostel that has not filled its routine in still has to be able to
 * call dinner.
 */
export function canAnnounceMeal(
  timing: string | null | undefined,
  minuteOfDay: number,
): boolean {
  const opensAt = mealOpensAtMinute(timing);

  return opensAt === null || minuteOfDay >= opensAt;
}

/**
 * `330` → `5:30 AM`.
 *
 * The 12-hour clock because that is how the seeded timings are written and how
 * a cook reads the hall clock. Minutes are always shown — `6 AM` reads as an
 * approximation and this is a threshold.
 */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const wrapped = ((Math.round(minuteOfDay) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

/**
 * Minutes since midnight **in Nepal**, whatever the machine thinks the time is.
 *
 * Shifting the instant and reading the UTC getters is what keeps a server in
 * `UTC` and a handset left on London time agreeing about whether dinner is due.
 */
export function nepalMinuteOfDay(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000);

  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Sunday-based weekday index in Nepal — the week start the routine is keyed on. */
export function nepalWeekday(now: Date = new Date()): number {
  return new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000).getUTCDay();
}

/** `YYYY-MM-DD` in Nepal. The key a once-a-day job is claimed under. */
export function nepalDayKey(now: Date = new Date()): string {
  return new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}
