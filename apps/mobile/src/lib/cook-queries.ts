import { REALTIME_TOPIC } from "@/constants/topics";
import {
  type CookPhotoFeed,
  type CookResident,
  type CookToday,
  type FoodReadyAnnouncement,
  type FoodReadySent,
  getCookToday,
  listCookFoodPhotos,
  listCookResidents,
  listFoodReadyLogs,
} from "@/lib/cook-api";
import {
  defineQuery,
  prefetchQuery,
  type Query,
  readQuery,
  writeQuery,
} from "@/lib/query-cache";

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

  photos: (): CookQuery<CookPhotoFeed> =>
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
   *
   * On **both** topics, and the second one is not decoration. The payload
   * carries `residentCount`, so a resident moving in changes this answer — and
   * a `residents` event used to invalidate `cook:residents` while leaving this
   * one alone. The head count on Today and the roster on Menu are the same
   * population, so the portal showed two different numbers for one hostel on two
   * tabs, for as long as the stale one survived. They move together now.
   */
  today: (): CookQuery<CookToday> =>
    defineQuery("cook:today", [REALTIME_TOPIC.FOOD, REALTIME_TOPIC.RESIDENTS], () =>
      getCookToday(),
    ),
} as const;

/**
 * Fold a just-sent announcement into what the portal already has on screen.
 *
 * The announce button used to call `today.refresh()`, which is a full round trip
 * for `GET /cook/today` — the whole week's routine, the hostel, the head count —
 * to learn one fact the server has just handed back in the POST response. On a
 * kitchen handset over hostel wifi that is the gap between pressing the button
 * and the card saying `Sent 12:04`, and it is the moment a cook is most likely
 * to press again because nothing happened.
 *
 * So the response is written straight into the two keys that hold it. Nothing is
 * *invented* here — every field comes off the server's own reply — which is what
 * separates this from an optimistic update that has to be rolled back when the
 * write turns out to have failed. The cooldown 429 throws before this is
 * reached.
 *
 * Both keys are written because both are already drawn: `cook:today` feeds the
 * four buttons and the shift card, and `cook:announcements` is the record on
 * More. A key that has never been loaded is left alone — `readQuery` returns
 * `null` and the tab that eventually asks for it gets the row from the server
 * anyway.
 */
export function recordCookAnnouncement(sent: FoodReadySent) {
  const today = readQuery<CookToday>(cookQuery.today().key);

  if (today) {
    writeQuery(
      cookQuery.today().key,
      {
        ...today.data,
        // Newest first, which is the order `mealButtons` reads to find the
        // latest announcement for a meal.
        announced: [sent, ...today.data.announced],
      },
      cookQuery.today().topics,
    );
  }

  const announcements = readQuery<FoodReadyAnnouncement[]>(cookQuery.announcements().key);

  if (announcements) {
    writeQuery(
      cookQuery.announcements().key,
      [sent, ...announcements.data],
      cookQuery.announcements().topics,
    );
  }
}

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
