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

import { NEPAL_OFFSET_MINUTES, nepalDayKey, nepalMinuteOfDay } from "../food/meal-window";

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
 * 23:45 rather than 23:59 because the job that sends it runs on a fifteen-minute
 * cadence and the first round needs a run to land in.
 */
export const LATEST_PROMPT_MINUTE = 23 * 60 + 45;

/** What a hostel gets when it has never set one. 8pm, as the owner asked. */
export const DEFAULT_PROMPT_TIME = "20:00";

/**
 * How long a hostel keeps asking after its hour: five hours, but never past
 * {@link LAST_ASK_MINUTE_OF_NIGHT}.
 *
 * The owner's rule. Whoever has not answered is asked again, round after round,
 * until the window closes — so an eight o'clock hostel asks until one, and a
 * six o'clock hostel until eleven.
 */
export const PROMPT_WINDOW_MINUTES = 5 * 60;

/**
 * 01:00, counted in minutes from the night's 17:00 start. Nobody is asked about
 * tonight after this, whatever the hostel's hour: a question at two in the
 * morning wakes people who are asleep, which is how this category gets muted.
 */
export const LAST_ASK_MINUTE_OF_NIGHT = 8 * 60;

/** How often an unanswered resident is asked again, and the choices offered. */
export const DEFAULT_REPEAT_EVERY_MINUTES = 30;
export const REPEAT_EVERY_OPTIONS = [15, 30, 60] as const;

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

/**
 * The instant a night ends: 17:00 in Nepal on the day after its key.
 *
 * What an answer token for that night expires at — an answer given after this
 * would be filed against the next night, which it is not about.
 */
export function nightEndsAt(night: string): Date {
  const [year, month, day] = night.split("-").map(Number);

  return new Date(
    Date.UTC(year, month - 1, day + 1, NIGHT_STARTS_AT_HOUR) -
      NEPAL_OFFSET_MINUTES * 60_000,
  );
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

/** A stored interval, or the default when it is not one of the offered choices. */
export function repeatEveryMinutes(value: number | null | undefined): number {
  return REPEAT_EVERY_OPTIONS.includes(value as (typeof REPEAT_EVERY_OPTIONS)[number])
    ? (value as number)
    : DEFAULT_REPEAT_EVERY_MINUTES;
}

/** Minutes since this night's 17:00 start, so 01:00 sorts after 23:00. */
function minuteOfNight(now: Date): number {
  return (nepalMinuteOfDay(now) - NIGHT_STARTS_AT_HOUR * 60 + 1440) % 1440;
}

/** The last minute of asking for a prompt hour, as a minute of the night. */
function askingEndsMinuteOfNight(promptMinute: number): number {
  return Math.min(
    promptMinute - NIGHT_STARTS_AT_HOUR * 60 + PROMPT_WINDOW_MINUTES,
    LAST_ASK_MINUTE_OF_NIGHT,
  );
}

/**
 * `"20:00"` → `"01:00"`: when a hostel with this hour stops asking. `null` for
 * an hour that is not valid. For the settings screens, which say it out loud.
 */
export function askingEndsAt(promptTime: string | null | undefined): string | null {
  const promptMinute = parsePromptTime(promptTime);

  if (promptMinute === null) {
    return null;
  }

  const minuteOfDay =
    (askingEndsMinuteOfNight(promptMinute) + NIGHT_STARTS_AT_HOUR * 60) % 1440;

  return formatPromptTime(minuteOfDay);
}

/**
 * Which round of asking this instant falls in, or `null` outside the window.
 *
 * Round 0 starts at the hostel's hour; round *n* starts `n × every` minutes
 * later; the last round is the one that starts before the window closes. The
 * sender claims each round once, so a job running every fifteen minutes asks
 * once per round however many times it runs inside one — and a run that was
 * missed costs that round, never a burst of catch-up notifications.
 *
 * Pure, and separated from everything that touches a database, because this is
 * the part with a timezone and an off-by-one in it — the same split `dueMeals`
 * uses in `meal-call-reminder.service.ts`.
 */
export function promptRound(
  promptTime: string | null | undefined,
  every: number | null | undefined,
  now: Date = new Date(),
): number | null {
  const promptMinute = parsePromptTime(promptTime);

  if (promptMinute === null) {
    return null;
  }

  const start = promptMinute - NIGHT_STARTS_AT_HOUR * 60;
  const at = minuteOfNight(now);

  if (at < start || at >= askingEndsMinuteOfNight(promptMinute)) {
    return null;
  }

  return Math.floor((at - start) / repeatEveryMinutes(every));
}
