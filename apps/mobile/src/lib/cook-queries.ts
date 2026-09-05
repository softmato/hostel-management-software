import { REALTIME_TOPIC } from "@/constants/topics";
import {
  type CookPhotoDay,
  type CookResident,
  type CookToday,
  type FoodReadyAnnouncement,
  getCookToday,
  listCookFoodPhotos,
  listCookResidents,
  listFoodReadyLogs,
} from "@/lib/cook-api";
import { defineQuery, prefetchQuery, type Query } from "@/lib/query-cache";

/**
 * Every read the cook portal makes, named once.
 *
 * The sibling of `resident-queries.ts`, `guardian-queries.ts` and
 * `admin-queries.ts`, built for the same reasons — and this portal had the worst
 * version of the problem all three were built to fix.
 *
 * ## `GET /cook/today` was being fetched twice, by two tabs, every visit
 *
 * The Today tab calls it for the four buttons. The Menu tab calls it *again*,
 * inside its own `loadMenu`, because the same payload carries the whole week's
 * routine — which is the right call, and was being made under an inline
 * `useCallback` with **no `cacheKey`**. `useResource` without a key holds its
 * payload in component state and loses it on unmount, so Today → Menu → Today
 * was three round trips for one object, on the portal used by somebody standing
 * over a pot.
 *
 * One descriptor, one key, both tabs. The Menu tab keeps its second read —
 * `listCookResidents` is a genuinely different question — as a descriptor of its
 * own, so a roster that fails does not blank the week's menu.
 *
 * ## Everything here is the FOOD topic, and one of them is also RESIDENTS
 *
 * `cook.service.ts` and `food.service.ts` both publish to `private-hostel-<id>`,
 * which a cook's principal is granted off the hostel they were provisioned for.
 * The roster is the exception: it changes when a resident moves in or out, which
 * is a `residents` event, and a kitchen cooking for a head count that is a day
 * stale is the one number on this portal that costs food.
 */

export type CookQuery<T> = Query<T>;

export const cookQuery = {
  /**
   * The announcement log — every meal this kitchen has called, not just today's.
   *
   * Separate from `today` even though both are announcements, because they are
   * different questions with different lifetimes: `today.announced` is what the
   * four buttons must already show, and this is the record. Folding them into
   * one read would mean the Today tab pulling the whole history to draw four
   * badges.
   */
  announcements: (): CookQuery<FoodReadyAnnouncement[]> =>
    defineQuery("cook:announcements", [REALTIME_TOPIC.FOOD], () => listFoodReadyLogs()),

  photos: (): CookQuery<{ days: CookPhotoDay[]; hasMore: boolean; total: number }> =>
    defineQuery("cook:photos", [REALTIME_TOPIC.FOOD], () => listCookFoodPhotos()),

  /**
   * Names and room types, and nothing contactable.
   *
   * The cook login is shared kitchen-wide and effectively static, so this is the
   * list most exposed by a leaked password — it is deliberately worth no more
   * than a noticeboard. See `(cook)/menu.tsx`.
   */
  residents: (): CookQuery<CookResident[]> =>
    defineQuery("cook:residents", [REALTIME_TOPIC.RESIDENTS], () => listCookResidents()),

  /**
   * Today's meals, today's announcements, the head count **and the whole week's
   * routine** — which is why the Menu tab reads this key rather than one of its
   * own.
   */
  today: (): CookQuery<CookToday> =>
    defineQuery("cook:today", [REALTIME_TOPIC.FOOD], () => getCookToday()),
} as const;

/** Warms one descriptor. Never throws, never re-asks something already fresh. */
export function prefetchCookQuery<T>(query: CookQuery<T>) {
  prefetchQuery(query.key, query.load, { topics: query.topics });
}

/**
 * What the portal warms the moment a cook enters it.
 *
 * One wave, three reads, and **not** `today` — that is the tab they land on and
 * it is already asking; warming it would be a duplicate racing the screen's own
 * request, which is the same exclusion `prefetchResidentPortal` makes for Home.
 *
 * The roster is in the wave rather than left to the Menu tab because it is the
 * slowest of the three on a hostel of forty and the least likely to have changed
 * since the last shift — exactly the profile a warm-up exists for.
 */
export function prefetchCookPortal() {
  prefetchCookQuery(cookQuery.residents());
  prefetchCookQuery(cookQuery.photos());
  prefetchCookQuery(cookQuery.announcements());
}
