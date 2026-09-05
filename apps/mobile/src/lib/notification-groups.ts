/**
 * The bell's feed, cut into the day headings it is read under.
 *
 * ## Why the list is grouped at all
 *
 * `NOTES.md` §5, from the EBL recordings: *"Lists are grouped by date, headings
 * outside the cards. Reads far faster than a flat list with a date on every
 * row."* The bell is the strongest case for it in the app — a flat column of
 * forty rows, each carrying its own "2 days ago", makes the reader do the
 * grouping in their head on every visit, and the thing they are actually looking
 * for is almost always "what happened since I last looked".
 *
 * The heading is a *bucket*, not a formatted date, which is what lets it stay
 * out of `useDates()`: "Today" and "This week" are the same words in Bikram
 * Sambat and Gregorian. The row's own timestamp is still the reader's calendar's
 * business, and the screen renders it through `useDates()`.
 *
 * ## The day boundary is Nepal's, not the phone's
 *
 * `nepalDayKey` — a fixed UTC+05:45 — for the same reason every other day
 * question in this app uses it: a phone left on UTC is nearly six hours behind
 * Kathmandu, so for the last quarter of every evening "today" on the device and
 * "today" in the hostel are different days. A rent reminder sent at 9pm would
 * file itself under Yesterday while the resident was still holding the phone.
 *
 * Its own module so it can be tested — Vitest here is node-side with no React
 * Native shim, so anything importing a component cannot be.
 */

import { nepalDayKey } from "@/lib/format";

const DAY_MS = 86_400_000;

/** How many days back "This week" reaches, counting today as the first. */
const WEEK_DAYS = 7;

export type NotificationBucket = "earlier" | "this-week" | "today" | "yesterday";

export type NotificationGroup<T> = {
  bucket: NotificationBucket;
  /** The heading, drawn on the page rather than inside the card. */
  label: string;
  rows: T[];
};

const BUCKET_LABELS: Record<NotificationBucket, string> = {
  earlier: "Earlier",
  "this-week": "This week",
  today: "Today",
  yesterday: "Yesterday",
};

/** The order headings appear in — newest first, matching the server's sort. */
const BUCKET_ORDER: readonly NotificationBucket[] = [
  "today",
  "yesterday",
  "this-week",
  "earlier",
];

/**
 * Which heading one instant belongs under.
 *
 * A row with no `createdAt`, or one the server sent unparseable, files under
 * "Earlier" rather than being dropped: a notification the reader cannot see is
 * worse than one under a vague heading, and the timestamp is the only field of
 * the row that is missing.
 */
export function notificationBucket(
  value: string | null | undefined,
  now: Date = new Date(),
): NotificationBucket {
  if (!value) {
    return "earlier";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "earlier";
  }

  /*
   * A clock a few minutes fast is common, and a row stamped in the future would
   * otherwise match no day key and fall all the way to "Earlier" — the newest
   * notification in the feed, filed under the oldest heading, at the bottom of
   * the screen. Same defence `formatAgo` makes with "just now".
   */
  if (date.getTime() > now.getTime()) {
    return "today";
  }

  const key = nepalDayKey(date);

  if (key === nepalDayKey(now)) {
    return "today";
  }

  if (key === nepalDayKey(new Date(now.getTime() - DAY_MS))) {
    return "yesterday";
  }

  for (let back = 2; back < WEEK_DAYS; back += 1) {
    if (key === nepalDayKey(new Date(now.getTime() - back * DAY_MS))) {
      return "this-week";
    }
  }

  return "earlier";
}

/**
 * The feed, in headings.
 *
 * Order inside a group is the order it came in — the server sorts
 * `createdAt: -1` and this must not re-sort it, or a row edited by
 * `createOrUpdateBatchedNotification` (which bumps `createdAt` to bring "5 people
 * reacted" back to the top) would land somewhere the reader is not looking.
 *
 * Empty groups are dropped, so a feed with nothing from this week draws no
 * "This week" heading over a gap.
 *
 * Generic in the row rather than typed to `AppNotification`: the only field this
 * needs is a timestamp, and keeping it that way is what lets the test call it
 * with three objects instead of three full notifications.
 */
export function groupNotifications<T extends { createdAt?: string }>(
  rows: readonly T[],
  now: Date = new Date(),
): NotificationGroup<T>[] {
  const buckets = new Map<NotificationBucket, T[]>();

  for (const row of rows) {
    const bucket = notificationBucket(row.createdAt, now);
    const existing = buckets.get(bucket);

    if (existing) {
      existing.push(row);
    } else {
      buckets.set(bucket, [row]);
    }
  }

  return BUCKET_ORDER.flatMap((bucket) => {
    const group = buckets.get(bucket);

    return group ? [{ bucket, label: BUCKET_LABELS[bucket], rows: group }] : [];
  });
}
