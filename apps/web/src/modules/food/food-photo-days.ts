/**
 * Grouping the food-photo feed into days, for the kitchen's own view of it.
 *
 * Kept pure and free of database imports so the one decision that actually goes
 * wrong here — which day a photo belongs to — can be tested directly.
 *
 * ## Nepal is +05:45, and that is the whole problem
 *
 * A dinner photographed at 19:30 in Kathmandu is `13:45Z` **the same day**, but
 * one taken at 06:00 is `00:15Z`, and a late supper at 18:30 local on the 3rd is
 * `12:45Z` on the 3rd while 23:50 local is `18:05Z` — still the 3rd. The failure
 * arrives from the other end: a photo posted at 05:30 local sits at `23:45Z` on
 * the **previous** UTC day. Group by UTC and the kitchen sees yesterday's
 * breakfast filed under the day before, one row out, only ever for the early
 * meals. That is the kind of wrong nobody reports and everybody stops trusting.
 *
 * So the day key comes from `Intl` in `Asia/Kathmandu`, the same reasoning the
 * quiet-hours module documents at length: anything doing whole-hour offset
 * arithmetic is 45 minutes wrong in this country.
 */

/** The product's home. Photos are grouped in the kitchen's own day, not UTC. */
export const HOSTEL_TIME_ZONE = "Asia/Kathmandu";

export type PhotoForGrouping = {
  /** The meal's date, as stored. */
  date: Date;
  /** When it actually reached us — what "posted at 7:41pm" reads off. */
  uploadedAt: Date;
};

/**
 * `YYYY-MM-DD` in the hostel's timezone.
 *
 * `en-CA` because it formats as `2026-08-18` natively, so there is no
 * part-reassembly step to get the order wrong. An unknown zone throws inside
 * `Intl`; that falls back to the UTC date rather than propagating, because a
 * bad constant must not be able to take the feed down.
 */
export function hostelDayKey(value: Date, timeZone: string = HOSTEL_TIME_ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

export type PhotoDay<T> = {
  /** `YYYY-MM-DD` in the hostel's timezone. The group's identity. */
  day: string;
  photos: T[];
};

/**
 * Folds a **newest-first** list into newest-first days.
 *
 * Order is inherited, not re-sorted: the query already sorts by `date` then
 * `uploadedAt` descending, and sorting again here would be a second opinion
 * about ordering that can disagree with the first one after a schema change.
 * What this does guarantee is that a day appears once — a list that arrives out
 * of order produces one group per day, not one per run of adjacent rows, which
 * is the bug a naive fold has.
 */
export function groupPhotosByDay<T extends PhotoForGrouping>(
  photos: readonly T[],
  timeZone: string = HOSTEL_TIME_ZONE,
): PhotoDay<T>[] {
  const days = new Map<string, T[]>();

  for (const photo of photos) {
    const key = hostelDayKey(photo.date, timeZone);
    const bucket = days.get(key);

    if (bucket) {
      bucket.push(photo);
    } else {
      days.set(key, [photo]);
    }
  }

  return [...days.entries()].map(([day, items]) => ({ day, photos: items }));
}

/**
 * How many distinct meals the kitchen has covered on a day.
 *
 * The number the cook is actually judged on: four photos of dinner is not the
 * same as one each of breakfast, lunch, snacks and dinner, and a plain count
 * cannot tell those apart.
 */
export function coveredMealCount(photos: readonly { mealType: string }[]): number {
  return new Set(photos.map((photo) => photo.mealType)).size;
}
