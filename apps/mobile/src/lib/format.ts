/**
 * Money and dates, formatted once so no screen invents its own.
 *
 * ## Why not `Intl`
 *
 * Hermes ships an `Intl` implementation backed by the *platform's* ICU — the
 * OS's, not the bundle's — so `en-NP` grouping and `Asia/Kathmandu` resolve
 * differently on an Android 9 handset than on the simulator, and an
 * unrecognised locale silently degrades to `en-US`. Money on an invoice is not
 * a place for "usually right", so the grouping and the timezone shift are done
 * by hand here. They are pure functions, which is also what makes them
 * testable under the repo's node-environment Vitest setup.
 *
 * ## Nepal time
 *
 * NPT is a fixed UTC+05:45 with no daylight saving, so one constant offset is
 * the whole implementation. This matters more than it looks: a payment made at
 * 00:30 Kathmandu time is still *yesterday* in UTC, and a dashboard that says
 * "today's menu" while reading UTC days serves the wrong dinner for the last
 * 5 hours 45 minutes of every day.
 */

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Thousands separators, three digits at a time.
 *
 * Deliberately *not* the lakh/crore grouping (`1,23,456`) some Nepali software
 * uses: every amount already rendered by `apps/web` is plain
 * `toLocaleString()`, and the two styles side by side on the same invoice —
 * one in the app, one in the emailed receipt — reads as a mismatch rather than
 * as a locale preference.
 */
function group(digits: string) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Renders paisa only when there are any.
 *
 * Rent is whole rupees, so `NPR 8,500.00` is noise on every row; a settlement
 * that genuinely lands on `1200.5` must not be shown as `1,200`, because a
 * balance that does not add up is the one thing a resident will call about.
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const negative = value < 0;
  const absolute = Math.abs(value);
  const rounded = Math.round(absolute * 100) / 100;
  const whole = Math.floor(rounded);
  const paisa = Math.round((rounded - whole) * 100);
  const body = paisa === 0 ? group(String(whole)) : `${group(String(whole))}.${String(paisa).padStart(2, "0")}`;

  return negative ? `-${body}` : body;
}

/** `NPR 8,500`. The currency code, not `रु` — the web and the receipts say NPR. */
export function formatMoney(value: number | null | undefined): string {
  const amount = formatAmount(value);

  return amount === "—" ? amount : `NPR ${amount}`;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

type NepalParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  weekday: number;
  year: number;
};

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar fields as they read on a wall clock in Kathmandu.
 *
 * Shifting the instant and then using the **UTC** getters is the trick: it
 * moves the clock without the device's own timezone getting a vote, so a phone
 * left on London time shows the same dates as one in Nepal.
 */
function nepalParts(date: Date): NepalParts {
  const shifted = new Date(date.getTime() + NEPAL_OFFSET_MINUTES * 60_000);

  return {
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    month: shifted.getUTCMonth(),
    weekday: shifted.getUTCDay(),
    year: shifted.getUTCFullYear(),
  };
}

/** A day identity in Nepal time — the key "is this the same day" questions use. */
function nepalDayKey(date: Date): string {
  const { day, month, year } = nepalParts(date);

  return `${year}-${month}-${day}`;
}

/** `16 Aug 2026`. */
export function formatDate(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const { day, month, year } = nepalParts(date);

  return `${day} ${MONTHS_SHORT[month]} ${year}`;
}

/** `2:45 pm`. Lowercase meridiem — it sits next to a date, not alone. */
export function formatTime(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  const { hour, minute } = nepalParts(date);
  const meridiem = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;

  return `${twelve}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

/** `16 Aug 2026, 2:45 pm`. */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  return date ? `${formatDate(date)}, ${formatTime(date)}` : "—";
}

/** `Sunday`. */
export function formatWeekday(value: Date | string | null | undefined): string {
  const date = parseDate(value);

  return date ? WEEKDAYS[nepalParts(date).weekday] : "—";
}

/**
 * `Today` / `Yesterday` / `16 Aug 2026`.
 *
 * For notice and claim timestamps, where the exact date matters far less than
 * whether the thing is new.
 */
export function formatRelativeDay(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);

  if (!date) {
    return "—";
  }

  if (nepalDayKey(date) === nepalDayKey(now)) {
    return "Today";
  }

  const yesterday = new Date(now.getTime() - 86_400_000);

  if (nepalDayKey(date) === nepalDayKey(yesterday)) {
    return "Yesterday";
  }

  return formatDate(date);
}

/** `"2026-08"` → `August 2026`. The invoice `month` field's format. */
export function formatPeriod(period: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period?.trim() ?? "");

  if (!match) {
    return period?.trim() || "—";
  }

  const monthIndex = Number(match[2]) - 1;

  return monthIndex >= 0 && monthIndex < 12
    ? `${MONTHS_LONG[monthIndex]} ${match[1]}`
    : (period as string);
}

/**
 * Days until a due date, in Nepal days — negative once it is overdue.
 *
 * Compared as whole days rather than as instants, so an invoice due "today"
 * reads as due today all day instead of flipping to overdue at noon.
 */
export function daysUntil(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  const startOfNepalDay = (input: Date) => {
    const { day, month, year } = nepalParts(input);

    return Date.UTC(year, month, day);
  };

  return Math.round((startOfNepalDay(date) - startOfNepalDay(now)) / 86_400_000);
}

/** `Due in 3 days` / `Due today` / `4 days overdue`. */
export function formatDueLabel(
  value: Date | string | null | undefined,
  now: Date = new Date(),
): string | null {
  const days = daysUntil(value, now);

  if (days === null) {
    return null;
  }

  if (days === 0) {
    return "Due today";
  }

  if (days > 0) {
    return days === 1 ? "Due tomorrow" : `Due in ${days} days`;
  }

  const overdue = Math.abs(days);

  return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`;
}

/**
 * `Good morning` / `Good afternoon` / `Good evening`, on Kathmandu's clock.
 *
 * The device clock is the wrong one to ask: a resident whose phone is still on
 * roaming time gets greeted for the wrong half of the day on a screen that is
 * otherwise entirely about Nepali dates.
 */
export function greetingFor(now: Date = new Date()): string {
  const { hour } = nepalParts(now);

  if (hour < 12) {
    return "Good morning";
  }

  return hour < 17 ? "Good afternoon" : "Good evening";
}

/** `PENDING_PROOF` → `Pending proof`. Server enums are shouted; screens are not. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const words = value.trim().toLowerCase().split(/[_\s]+/).filter(Boolean);

  if (words.length === 0) {
    return "—";
  }

  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)}${
    words.length > 1 ? ` ${words.slice(1).join(" ")}` : ""
  }`;
}
