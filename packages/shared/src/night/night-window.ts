/**
 * Which night an answer belongs to, and when the hostel asks for it.
 *
 * ## Why this is shared rather than a file in the app
 *
 * It was a file in the app: `apps/mobile/src/lib/night-status.ts` owned a
 * `NIGHT_STARTS_AT_HOUR` and a private `nightKey`, and its own doc comment said
 * the quiet part out loud — *"a client-side product choice with no server
 * counterpart… this decides only what this screen says, never what is stored."*
 *
 * That was survivable while the resident was the only one who ever looked. It
 * stops being survivable the moment a **cron job** asks "who has not answered
 * tonight?" and a **warden board** renders the answer, because now three
 * separate pieces of code have an opinion about when a night starts, and the
 * two new ones are on the other side of a network boundary from the one that
 * already existed. Two implementations of a boundary is two boundaries, and the
 * failure is silent and horrible: a resident who checked in at 23:30 is asked
 * again at midnight, tells the app they already answered, and the app agrees
 * with them while the server does not.
 *
 * So the rule moves here, both ends import it, and there is one boundary. Same
 * move, same reasoning, as `@hostel/calendar` for the Bikram Sambat month and
 * `@hostel/food/meal-window` for the serving time.
 *
 * ## The night starts at 17:00, and the prompt is not the boundary
 *
 * These are two different numbers and conflating them is the trap.
 *
 * - **17:00** is when a *night* begins. It is fixed, platform-wide, and not
 *   configurable. Its job is to make "tonight" mean one thing from dusk through
 *   the small hours, so an answer given at 23:30 and a board read at 00:30 are
 *   talking about the same night.
 * - **The prompt time** is when the hostel *asks*. It is per-hostel, editable by
 *   a warden, and defaults to 20:00.
 *
 * A hostel that moves its prompt to 21:30 has not moved its night. A hostel that
 * moved its prompt to 16:00 would be asking about a night that has not started
 * — which is why {@link EARLIEST_PROMPT_MINUTE} refuses that, rather than
 * quietly filing the answers under yesterday.
 *
 * The upper bound is the mirror of it: a prompt after midnight would be sent on
 * the calendar day *after* the night it is asking about, and every claim row,
 * every board query and every "have I answered?" check would disagree about
 * which night that was. So the window is 17:00–23:45 and both ends are real.
 */

import { nepalDayKey, nepalMinuteOfDay } from "../food/meal-window";

/**
 * A night runs 17:00 → 17:00. Not configurable; see the note above.
 *
 * Moved verbatim from the app, including the reasoning, because changing it
 * changes which night thousands of existing `NightStatus` rows belong to.
 */
export const NIGHT_STARTS_AT_HOUR = 17;

/** The hostel may not ask before its own night has started. */
export const EARLIEST_PROMPT_MINUTE = NIGHT_STARTS_AT_HOUR * 60;

/**
 * Nor after 23:45, so the prompt and the night it asks about share a date.
 *
 * 23:45 rather than 23:59 because the job that sends it runs on a cadence and
 * needs somewhere to land; see {@link PROMPT_GRACE_MINUTES}.
 */
export const LATEST_PROMPT_MINUTE = 23 * 60 + 45;

/** What a hostel gets when it has never set one. 8pm, as the owner asked. */
export const DEFAULT_PROMPT_TIME = "20:00";

/**
 * How late the prompt may still go out after its minute has passed.
 *
 * The sender runs on an external schedule (`docs/CRON.md`) rather than holding a
 * timer, so it cannot ask "is it exactly 20:00" — it asks "did 20:00 pass since
 * a little while ago". Wide enough to survive a missed run or two on a
 * fifteen-minute cadence; narrow enough that a scheduler outage over dinner does
 * not deliver "are you in tonight?" at half past eleven.
 *
 * Past this the hostel is simply not prompted that night. That is the right
 * failure: a resident can still answer from the app, and a notification that
 * arrives four hours late is worse than none — it wakes people who already went
 * to bed having answered, which is how this category gets muted for good.
 */
export const PROMPT_GRACE_MINUTES = 45;

/**
 * `"20:00"` → minutes since midnight, or `null` if it is not a clock time.
 *
 * `null` rather than a thrown error or a silent default: a hostel with an
 * unreadable value must be **skipped**, not prompted at some hour nobody chose.
 * Every caller here treats `null` as "this hostel has no prompt".
 */
export function parsePromptTime(value: string | null | undefined): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() ?? "");

  if (!match) {
    return null;
  }

  const minute = Number(match[1]) * 60 + Number(match[2]);

  return minute < EARLIEST_PROMPT_MINUTE || minute > LATEST_PROMPT_MINUTE
    ? null
    : minute;
}

/** Minutes since midnight → `"20:00"`, for quoting a hostel's own setting back. */
export function formatPromptTime(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The key for the night an instant falls in — `YYYY-MM-DD` in Nepal.
 *
 * Shifting back by the night's start hour before taking the day is what gives
 * an evening and the small hours after it one key: 23:30 on the 8th and 01:00 on
 * the 9th both answer `2026-09-08`.
 */
export function nightKey(instant: Date = new Date()): string {
  return nepalDayKey(new Date(instant.getTime() - NIGHT_STARTS_AT_HOUR * 3_600_000));
}

/** Whether two instants fall in the same night. */
export function isSameNight(a: Date, b: Date): boolean {
  return nightKey(a) === nightKey(b);
}

/**
 * Whether a recorded answer belongs to the night `now` is in.
 *
 * Takes the string the API serializes (`checkedAt`) rather than a `Date`, so
 * every caller is not repeating the same parse-and-guard. An unparseable or
 * missing value is `false` — *we have no answer for tonight* — which is the
 * honest reading and the safe one: the worst it causes is being asked again.
 */
export function isCurrentNight(
  checkedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!checkedAt) {
    return false;
  }

  const date = new Date(checkedAt);

  return Number.isNaN(date.getTime()) ? false : isSameNight(date, now);
}

/**
 * Whether a hostel's prompt came due within this run's window.
 *
 * Pure, and separated from everything that touches a database, because this is
 * the part with a timezone and an off-by-one in it — the same split
 * `dueMeals` uses in `meal-call-reminder.service.ts`.
 *
 * Deliberately **not** "is the current minute >= the prompt minute". That is
 * true for the rest of the evening, so a job running every fifteen minutes
 * would send the prompt, then send it again at 20:15, 20:30 and every run until
 * midnight. The claim row would stop the duplicates, but relying on a unique
 * index to paper over an always-true predicate means the *first* run after a
 * deploy at 23:00 still buzzes everybody. The window is what makes the question
 * "did it just become due", which is the question actually being asked.
 */
export function promptIsDue(
  promptTime: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return minuteIsDue(parsePromptTime(promptTime), now);
}

/**
 * Whether the optional follow-up chase came due within this run's window.
 *
 * `remindAfterMinutes` of `0` is off, which is the default — one notification a
 * night is the promise, and a second one has to be deliberately asked for.
 *
 * A reminder that would land after midnight is **not** sent. It would be
 * delivered on the calendar day after the night it is asking about, while the
 * claim row and every board query key it under the night — and a resident woken
 * at 00:30 to be asked about a night they are already asleep through is the
 * single fastest way to get this category muted. A hostel that sets 22:00 with a
 * 180-minute chase gets the prompt and no chase, which is the right failure.
 */
export function reminderIsDue(
  promptTime: string | null | undefined,
  remindAfterMinutes: number | null | undefined,
  now: Date = new Date(),
): boolean {
  const promptMinute = parsePromptTime(promptTime);
  const after = remindAfterMinutes ?? 0;

  if (promptMinute === null || after <= 0) {
    return false;
  }

  const reminderMinute = promptMinute + after;

  // Past midnight. See the note above.
  if (reminderMinute > LATEST_PROMPT_MINUTE) {
    return false;
  }

  return minuteIsDue(reminderMinute, now);
}

/** The shared window test. See {@link promptIsDue} for why it is a window. */
function minuteIsDue(minute: number | null, now: Date): boolean {
  if (minute === null) {
    return false;
  }

  const minuteOfDay = nepalMinuteOfDay(now);

  return minuteOfDay >= minute && minuteOfDay <= minute + PROMPT_GRACE_MINUTES;
}
