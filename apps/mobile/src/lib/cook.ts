/**
 * The four Food Ready buttons, as a decision rather than four copies of an
 * `onPress`.
 *
 * Pure and free of the axios client, so it can be tested node-side — which
 * matters more here than usual, because the interesting cases are all about
 * *time*, and the screen has none of the state needed to reason about them.
 */

import {
  type MealAnnounceState,
  formatMinuteOfDay,
  mealAnnounceState,
  mealClosesAtMinute,
  mealOpensAtMinute,
  nepalMinuteOfDay,
} from "@hostel/food/meal-window";

import { MEAL_TYPES, type MealType } from "@/lib/food-week";
import type {
  CookPhotoDay,
  FoodReadyAnnouncement,
  FoodReadySent,
} from "@/lib/cook-api";
import type { RoutineMeal } from "@/lib/resident-api";

export type MealButton = {
  /** Today's items for this meal, joined — or empty when nothing is planned. */
  items: string[];
  /**
   * The button cannot be pressed: either the meal is not due yet or its window
   * has closed with nobody calling it. `state` says which.
   *
   * Always `false` for a meal already announced and for one whose timing cannot
   * be read as a clock. See {@link mealButtons}.
   */
  locked: boolean;
  mealType: MealType;
  /**
   * When the window shuts — `9:45 PM` — or `null` when this meal has no gate.
   */
  closesAt: string | null;
  /**
   * When the button unlocks — `5:30 AM` — or `null` when there is no gate on
   * this meal at all. Present whether or not `locked` is set, because the card
   * shows it as a plain fact once the meal is open too.
   */
  opensAt: string | null;
  /** The announcement already sent today, if there is one. */
  sent: FoodReadyAnnouncement | null;
  /**
   * Where the meal stands against the clock, straight off the shared rule.
   *
   * Kept alongside `locked` rather than replaced by it: `EARLY` and `MISSED`
   * both disable the button but say opposite things, and a screen that only
   * knows "locked" has to guess which.
   */
  state: MealAnnounceState;
  timing: string;
};

/**
 * What {@link mealButtons} needs to decide four buttons.
 *
 * An object rather than four positional arguments — `timings` arrived after the
 * fact and a fourth positional would have been silently skippable at exactly
 * the call site that must not skip it.
 */
export type MealButtonsInput = {
  /** Today's announcements, newest first, as the server sends them. */
  announced: FoodReadyAnnouncement[];
  /** Today's weekday rows off the routine — what is being cooked. */
  meals: RoutineMeal[];
  /** Defaults to now. A parameter only so the gate is testable. */
  now?: Date;
  /**
   * `routine.timings` — the hostel's clock per meal for the **whole week**.
   *
   * This, and not the day row's own `timing`, is what the gate reads, because
   * it is what `announceFoodReady` reads. `meals` only carries rows an admin
   * filled in for today, so a meal with no items today arrives with an empty
   * `timing` — and gating on that left the button live over an API that
   * refuses it. Two sources for one rule is the whole bug.
   */
  timings?: Partial<Record<MealType, string>>;
};

/**
 * One row per meal, always all four, in serving order — each carrying whether
 * the kitchen may call it yet.
 *
 * ## Always four
 *
 * Even when the routine has nothing for a meal: a kitchen that serves an
 * unplanned snack still needs to tell people, and hiding the button because an
 * admin left a cell blank makes the app less useful exactly when the routine is
 * out of date. The empty case is labelled, not removed.
 *
 * ## Why a meal locks, and why that is not the cooldown all over again
 *
 * The cooldown deliberately does **not** disable its button — see
 * {@link mealButtonLabel} — because that rule lives on the server and a client
 * copy of it would drift the moment an admin changed the setting. This gate is
 * the opposite case: `canAnnounceMeal` is `@hostel/food/meal-window`, the same
 * module `announceFoodReady` calls before it accepts anything, so the button
 * and the API cannot disagree. Disabling here is not the client inventing a
 * rule, it is the client showing one.
 *
 * It matters because the four cards are identical but for their heading, and
 * the failure this whole screen is written around is dinner being announced at
 * breakfast — one mis-tap sending the wrong menu to every resident in the
 * building, with a cooldown then standing in the way of the correction.
 *
 * A meal opens half an hour before service and shuts an hour after it ends. It
 * shuts because a button that stays live all evening cannot say the one thing
 * an office needs off this screen — *nobody called that meal* — and a cook
 * genuinely serving two hours late has an admin who can move the routine's
 * time. A timing that is not a clock — blank, or `after evening prayers` — is
 * no gate at all.
 *
 * ## The clock comes from `timings`, not from the day's row
 *
 * `routine.timings` is per meal for the whole week and is what the **server**
 * gates on. `meals` holds only the weekday rows an admin actually filled in, so
 * a meal with nothing planned today arrives with an empty `timing` — and
 * reading that was the bug: every such button stayed live over an API that
 * refuses it. The day row's `timing` is still carried for display, and still
 * used as a fallback for a routine saved before `timings` existed.
 */
export function mealButtons({
  announced,
  meals,
  now = new Date(),
  timings = {},
}: MealButtonsInput): MealButton[] {
  const sentByMeal = new Map<string, FoodReadyAnnouncement>();

  for (const announcement of announced) {
    // Newest first from the server; the first one for a meal is the latest.
    if (!sentByMeal.has(announcement.mealType)) {
      sentByMeal.set(announcement.mealType, announcement);
    }
  }

  // Read once, so four buttons cannot land either side of a minute boundary.
  const minuteOfDay = nepalMinuteOfDay(now);

  return MEAL_TYPES.map((mealType) => {
    const planned = meals.find((meal) => meal.mealType === mealType);
    const timing = timings[mealType]?.trim() || planned?.timing || "";
    const sent = sentByMeal.get(mealType) ?? null;
    const opensAtMinute = mealOpensAtMinute(timing);
    const closesAtMinute = mealClosesAtMinute(timing);
    /*
     * A meal already announced has no state to be in. It cannot be `MISSED` —
     * it was called — and a row written before this gate existed, or a handset
     * whose clock is wrong, must not turn "Announce again" into a dead button.
     */
    const state: MealAnnounceState = sent
      ? "ANY"
      : mealAnnounceState(timing, minuteOfDay);

    return {
      closesAt: closesAtMinute === null ? null : formatMinuteOfDay(closesAtMinute),
      items: planned?.items ?? [],
      locked: state === "EARLY" || state === "MISSED",
      mealType,
      opensAt: opensAtMinute === null ? null : formatMinuteOfDay(opensAtMinute),
      sent,
      state,
      timing: planned?.timing || timings[mealType]?.trim() || "",
    };
  });
}

/**
 * What the button should say.
 *
 * "Announce again" rather than a disabled button for a meal already **sent**:
 * the server owns the cooldown and returns a 429 naming the wait, and a cook
 * who genuinely needs to re-call a late sitting must be able to try. Disabling
 * it there would be the client inventing a rule the server does not have — and
 * getting it wrong whenever `foodReadyCooldownMinutes` is changed.
 *
 * The lock is the other case and reads the other way: `announceFoodReady`
 * refuses an early call outright, from the same `@hostel/food/meal-window`
 * decision this label is built from, so a live button would be a lie. It says
 * the hour rather than "Locked" — the cook's next question is always *when*.
 */
export function mealButtonLabel(button: MealButton): string {
  // The clock, on the button itself. A disabled control with no reason on it is
  // the version a cook taps four times and then rings the office about.
  if (button.state === "EARLY") {
    return button.opensAt ? `Opens ${button.opensAt}` : "Not yet";
  }

  /*
   * Past tense, and it names what happened rather than what the app did. This
   * button is now a record — the meal went out without the building being told
   * — and "Not announced in time" is what an admin reading over the cook's
   * shoulder needs it to say.
   */
  if (button.state === "MISSED") {
    return "Not announced in time";
  }

  return button.sent ? "Announce again" : "Food ready";
}

/**
 * The line under a meal's name.
 *
 * Prefers what was actually announced over what was planned — if the cook sent
 * "Dal bhat and chicken" for a lunch the routine lists as "Dal bhat", the
 * announcement is what the hostel was told.
 */
export function mealSubtitle(button: MealButton): string {
  if (button.sent) {
    return button.sent.message;
  }

  return button.items.length > 0 ? button.items.join(", ") : "Nothing planned for today";
}

/**
 * The line a locked card carries under its button, or `null` when there is
 * nothing to explain.
 *
 * Says what the app is waiting for rather than what it is refusing. "Opens at
 * 5:30 AM" is a fact the cook can plan around; "you cannot do that yet" is an
 * argument with somebody holding a pan.
 */
export function mealLockNote(button: MealButton): string | null {
  if (button.state === "EARLY") {
    return button.opensAt
      ? `You can call this meal from ${button.opensAt}.`
      : "This meal is not due yet.";
  }

  if (button.state === "MISSED") {
    /*
     * Says who to go to, because the cook cannot fix this and should not be
     * left looking for a way to. The office can move the serving time, and
     * that is the only lever there is.
     */
    return button.closesAt
      ? `This meal could be called until ${button.closesAt}. Tell the office if the serving time has changed.`
      : "The time to call this meal has passed.";
  }

  return null;
}

/**
 * The meals the kitchen may call right now, in serving order.
 *
 * What the badge counts as work in front of the cook. A breakfast still locked
 * at 4am is not something anybody is behind on, and a lunch whose window shut
 * at 2pm is not something anybody can still do — neither belongs in a number
 * that means "left to call".
 */
export function openButtons(buttons: MealButton[]): MealButton[] {
  return buttons.filter((button) => !button.locked);
}

/** How many of the four have gone out today. Drives the header line. */
export function announcedCount(buttons: MealButton[]): number {
  return buttons.filter((button) => button.sent).length;
}

/**
 * How many are left **to call now**, which is the one number on this portal
 * worth carrying to another tab.
 *
 * Drawn as a badge on the Today tab so a cook who wandered off to the photo
 * feed can see the shift is unfinished without opening it. `0` draws nothing —
 * `RoleTabs` treats it that way — so a finished shift is silent rather than
 * showing a zero, which reads as a fault.
 *
 * Locked meals are **not** counted. A badge reading `4` at six in the morning
 * says the kitchen is four jobs behind when it is in fact exactly on time, and
 * a number that is wrong before breakfast is a number nobody reads by Friday.
 * It climbs as each meal comes due, which is the same thing the cook's own day
 * does.
 */
export function mealsToCall(buttons: MealButton[]): number {
  const open = openButtons(buttons);

  return open.length - announcedCount(open);
}

/**
 * What the toast says after an announcement, as a decision rather than a
 * ternary buried in an `onPress`.
 *
 * `announceFoodReady` returns 201 once the log row is written, whether or not a
 * single person was reachable — so success is the counts, never the status code.
 * Two audiences can each be empty and the sentence has to stay true in every
 * combination:
 *
 *  - **Nobody at all.** The row is written, no resident holds an account and
 *    the hostel has no staff on file. Said plainly, because a cook who believes
 *    the hostel has been called to dinner when nothing left the building is the
 *    failure this whole screen is written around.
 *  - **Only the office.** Worth saying: it tells the cook the app is working
 *    and that the gap is residents not having installed it, which is a thing an
 *    admin can fix and a cook cannot.
 *  - **Residents, and usually the office too.** The count leads, because that is
 *    what the cook pressed the button for.
 */
export function announcementSummary(sent: FoodReadySent): {
  body: string;
  reached: boolean;
} {
  const staff =
    sent.staffNotifiedCount > 0 ? "The hostel office was notified as well." : "";

  if (sent.notifiedCount === 0) {
    return {
      body: staff
        ? `No resident here has an app account yet. ${staff}`
        : "This announcement was recorded, but nobody was notified.",
      reached: false,
    };
  }

  return {
    body: `${sent.notifiedCount} resident(s) notified.${staff ? ` ${staff}` : ""}`,
    reached: true,
  };
}

/**
 * The next meal the kitchen has not called yet, in serving order.
 *
 * What the shift card leads with, and it is a *plan* rather than a clock: the
 * first of breakfast, lunch, snacks, dinner with no announcement against it
 * today. Deriving it from the time instead would be worse in both directions —
 * a kitchen running an hour late would be told to announce the meal it has
 * already served, and one that served snacks early would be pointed at dinner
 * with the snack button still unpressed.
 *
 * `null` once all four are out, which the card reads as "the shift is done"
 * rather than drawing a fifth meal that does not exist.
 */
export function nextUnannounced(buttons: MealButton[]): MealButton | null {
  return buttons.find((button) => button.sent === null) ?? null;
}

/**
 * The roster, filtered by what the cook typed.
 *
 * Name and room type, because those are the only two fields the cook payload
 * carries — `CookResident` is deliberately three fields with nothing
 * contactable in it.
 *
 * Case- and space-insensitive on both sides. A cook types `sita` for
 * `Sita Sharma` and `double` for `DOUBLE_SHARING`, and a filter that made them
 * match the server's enum spelling would be a filter nobody uses. An empty or
 * whitespace-only query returns the list untouched rather than nothing.
 */
export function searchCookResidents<T extends { fullName: string; roomType: string }>(
  residents: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return [...residents];
  }

  return residents.filter((resident) =>
    // `_` → ` ` so `double sharing` matches `DOUBLE_SHARING`, which is what the
    // row on screen actually reads after `humanizeEnum`.
    `${resident.fullName} ${resident.roomType.replace(/_/g, " ")}`
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * Two pages of the photo feed, as one list of days.
 *
 * The feed is paged 120 photos at a time and grouped into days by the server, so
 * a day that straddles a page boundary arrives **twice** — the tail of it on one
 * page and the head of it on the next. Concatenating the pages would draw that
 * date as two cards, which is the one thing a day-grouped feed must not do.
 *
 * `later` is strictly older than `earlier` (the cursor is the sort key), so only
 * the last day of one page can collide with the first of the next, and order is
 * preserved by appending. Photos are de-duplicated by id anyway: a page fetched
 * while the kitchen is posting is the case a keyset cursor is chosen to survive,
 * and surviving it means never showing one photo twice.
 *
 * `mealsCovered` is **recomputed** for a merged day rather than taken from
 * either page. The server counts distinct meals in the rows it sent, so each
 * half of a split day reports its own half's coverage — trusting either would
 * tell a kitchen it had documented two meals on a day it documented four.
 */
export function mergePhotoDays(
  earlier: readonly CookPhotoDay[],
  later: readonly CookPhotoDay[],
): CookPhotoDay[] {
  const merged = earlier.map((day) => ({ ...day }));

  for (const day of later) {
    const existing = merged.find((candidate) => candidate.day === day.day);

    if (!existing) {
      merged.push({ ...day });
      continue;
    }

    const seen = new Set(existing.photos.map((photo) => photo.id));
    const photos = [
      ...existing.photos,
      ...day.photos.filter((photo) => !seen.has(photo.id)),
    ];

    existing.photos = photos;
    existing.mealsCovered = new Set(photos.map((photo) => photo.mealType)).size;
  }

  return merged;
}
