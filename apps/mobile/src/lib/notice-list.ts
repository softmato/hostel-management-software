import type { ResidentNotice } from "@/lib/resident-api";

import { nepalDayKey } from "@/lib/format";

/**
 * The notice board's two filter axes and its day grouping, as pure functions.
 *
 * ## Why there are two axes and there used to be one
 *
 * The screen filtered with a single horizontal scroller holding `All`,
 * `Unread`, `Urgent` and then every category the hostel uses — so the two
 * questions a resident actually asks were competing for one control. Tapping
 * `Maintenance` cleared `Unread`; there was no way to ask for *unread
 * maintenance notices*, which is the one query somebody opening this screen on
 * a Monday morning wants.
 *
 * They are different kinds of question and they compose:
 *
 * - **status** — All / Unread / Urgent. Mutually exclusive views of the list, so
 *   the screen draws them as a `<Segmented>`; that component's own doc explains
 *   why a chip row would be the wrong promise.
 * - **category** — Maintenance, Payment, Event… A refinement on top of the
 *   view, so it is chips, and it can be cleared without losing the view.
 *
 * ## Grouping stops here and labelling does not happen here
 *
 * `groupNoticesByDay` returns the day's ISO instant and leaves the string to the
 * caller, because the label a resident reads depends on their **calendar
 * preference** — BS or AD — and that lives in Redux behind `useDates()`. A pure
 * module that formatted the heading itself would either import a hook it cannot
 * use or hardcode one calendar for a country that reads two.
 */

export type NoticeStatus = "all" | "unread" | "urgent";

/** No category selected — the chip row's cleared state. */
export const ALL_CATEGORIES = null;

/**
 * The categories this page of notices actually contains, sorted.
 *
 * Derived from the rows in hand rather than from an enum: a hostel that never
 * posts a `MAINTENANCE` notice should not have a `Maintenance` chip that always
 * filters to nothing.
 */
export function noticeCategories(notices: readonly ResidentNotice[]): string[] {
  const found = new Set(
    notices.map((notice) => notice.category).filter((value): value is string =>
      Boolean(value),
    ),
  );

  return [...found].sort();
}

/**
 * Status and category applied together, in the list's own order.
 *
 * A notice is `unread` when the resident has not opened it and `urgent` when the
 * hostel marked it so; the two are independent, which is why `urgent` does not
 * imply unread and the counts on the two segments can overlap. That is fine and
 * is not the double-counting `(admin)/money.tsx` warns about — these are three
 * *views*, not three parts of a partition, and the control says `All` first so
 * nobody reads the other two as adding up to it.
 */
export function filterNotices(
  notices: readonly ResidentNotice[],
  status: NoticeStatus,
  category: string | null = ALL_CATEGORIES,
): ResidentNotice[] {
  return notices.filter((notice) => {
    if (category !== null && notice.category !== category) {
      return false;
    }

    if (status === "unread") {
      return !notice.isRead;
    }

    if (status === "urgent") {
      return notice.isUrgent;
    }

    return true;
  });
}

export type NoticeDay = {
  /** `2026-08-16` in Kathmandu, or `""` for the undated group. */
  key: string;
  /**
   * The instant to render the heading from, so the caller can put it through
   * the resident's own calendar preference. `null` for the undated group.
   */
  iso: string | null;
  notices: ResidentNotice[];
};

const UNDATED_KEY = "";

/**
 * Notices grouped by the Kathmandu day they were published on, in the order
 * given.
 *
 * `NOTES.md` §5 — the heading on the page background, the day's rows in a card
 * under it — and the same construction `hostel-statement.ts`'s `groupByDay`
 * uses, deliberately: two lists in one app that group by day should not do it
 * two ways.
 *
 * The input is already newest-first from the server and this preserves that
 * rather than sorting again, so a group's position is its newest member's
 * position. A notice with no `publishedAt` collects into one trailing group
 * instead of being dropped — a notice the hostel posted is a notice the resident
 * has to be able to read, whatever the server failed to stamp on it.
 *
 * The day is **Kathmandu's**, via `nepalDayKey`. `getDate()` on a phone left on
 * another timezone files an evening notice under the wrong heading, and the
 * 17:00–23:45 window where that happens is exactly when a hostel posts one.
 */
export function groupNoticesByDay(notices: readonly ResidentNotice[]): NoticeDay[] {
  const days: NoticeDay[] = [];
  const byKey = new Map<string, NoticeDay>();

  for (const notice of notices) {
    const published = notice.publishedAt ? new Date(notice.publishedAt) : null;
    const dated = published !== null && !Number.isNaN(published.getTime());
    const key = dated ? nepalDayKey(published) : UNDATED_KEY;

    let day = byKey.get(key);

    if (!day) {
      day = { iso: dated ? (notice.publishedAt as string) : null, key, notices: [] };
      byKey.set(key, day);
      days.push(day);
    }

    day.notices.push(notice);
  }

  return days;
}
