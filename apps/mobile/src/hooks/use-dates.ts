import { useMemo } from "react";

import { useAppSelector } from "@/hooks/redux";
import {
  type CalendarSystem,
  formatAgoIn,
  formatDateIn,
  formatDateTimeIn,
  formatPeriodIn,
  formatRelativeDayIn,
} from "@/lib/calendar";

/**
 * The hostel portal's dates, already in the calendar the owner chose.
 *
 * ## Why a hook rather than a module-level switch
 *
 * The tempting shortcut is a mutable `activeCalendar` inside `lib/format.ts`,
 * set once at boot, so no call site has to change. It does not work: React
 * re-renders on state, and a module variable is not state — the owner would flip
 * the setting, walk back to Money, and find August still spelled in English
 * until the screen happened to remount for some other reason. Reading the
 * preference through `useAppSelector` is what makes the change land everywhere
 * on the same frame.
 *
 * ## The names are short on purpose
 *
 * `dates.date(row.createdAt)` rather than `formatDateIn(calendar, …)` at eighty
 * call sites. The bundle is memoised on the preference, so the identity is
 * stable across renders and it is safe in a `useMemo` dependency list — which
 * matters, because several admin screens build their row text inside one.
 *
 * ## Scope
 *
 * Admin screens only, for now: the setting lives in the hostel portal's own
 * Settings screen and says so. Resident, guardian, cook and public screens still
 * call `lib/format` directly and print Gregorian — giving a resident their
 * hostel's calendar preference is a separate decision about whose choice it is,
 * and not one to make silently here.
 */
export type PortalDates = {
  /** `2 hrs ago`, falling back to a date past a week. */
  ago: (value: Date | string | null | undefined, now?: Date) => string;
  /** Which calendar is in force, for the rare screen that needs to branch. */
  calendar: CalendarSystem;
  /** `18 Aug 2026` / `2 Bhadra 2083`. */
  date: (value: Date | string | null | undefined) => string;
  /**
   * Both calendars at once — `2 Bhadra 2083 (18 Aug 2026)`.
   *
   * For the few dates an owner has to act on rather than merely read. A rate
   * card that said "Effective from 17 Aswin 2083" gave no clue that it had not
   * started yet, because working out where 17 Aswin falls against today is
   * arithmetic nobody does at a desk. Anything that decides *when money changes*
   * prints both; ordinary row timestamps stay in the one calendar the owner
   * chose, or every list turns into a parenthesis.
   */
  dateBoth: (value: Date | string | null | undefined) => string;
  /** `18 Aug 2026, 2:45 pm` / `2 Bhadra 2083, 2:45 pm`. */
  dateTime: (value: Date | string | null | undefined) => string;
  /** `"2026-08"` → `August 2026` / `Shrawan 2083`. */
  period: (period: string | null | undefined) => string;
  /** `Today` / `Yesterday` / the date. */
  relativeDay: (value: Date | string | null | undefined, now?: Date) => string;
};

export function useDates(): PortalDates {
  const calendar = useAppSelector((state) => state.ui.calendarPreference);

  return useMemo(
    () => ({
      ago: (value, now) => formatAgoIn(calendar, value, now),
      calendar,
      date: (value) => formatDateIn(calendar, value),
      dateBoth: (value) => {
        const chosen = formatDateIn(calendar, value);
        const other = formatDateIn(calendar === "BS" ? "AD" : "BS", value);

        // An unparseable date formats the same way twice; one em dash beats
        // "— (—)".
        return chosen === other ? chosen : `${chosen} (${other})`;
      },
      dateTime: (value) => formatDateTimeIn(calendar, value),
      period: (value) => formatPeriodIn(calendar, value),
      relativeDay: (value, now) => formatRelativeDayIn(calendar, value, now),
    }),
    [calendar],
  );
}
