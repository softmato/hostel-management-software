/**
 * The four Food Ready buttons, as a decision rather than four copies of an
 * `onPress`.
 *
 * Pure and free of the axios client, so it can be tested node-side — which
 * matters more here than usual, because the interesting cases are all about
 * *time*, and the screen has none of the state needed to reason about them.
 */

import { MEAL_TYPES, type MealType } from "@/lib/food-week";
import type { FoodReadyAnnouncement } from "@/lib/cook-api";
import type { RoutineMeal } from "@/lib/resident-api";

export type MealButton = {
  /** Today's items for this meal, joined — or empty when nothing is planned. */
  items: string[];
  mealType: MealType;
  /** The announcement already sent today, if there is one. */
  sent: FoodReadyAnnouncement | null;
  timing: string;
};

/**
 * One row per meal, always all four, in serving order.
 *
 * Always four, even when the routine has nothing for a meal: a kitchen that
 * serves an unplanned snack still needs to tell people, and hiding the button
 * because an admin left a cell blank makes the app less useful exactly when the
 * routine is out of date. The empty case is labelled, not removed.
 */
export function mealButtons(
  meals: RoutineMeal[],
  announced: FoodReadyAnnouncement[],
): MealButton[] {
  const sentByMeal = new Map<string, FoodReadyAnnouncement>();

  for (const announcement of announced) {
    // Newest first from the server; the first one for a meal is the latest.
    if (!sentByMeal.has(announcement.mealType)) {
      sentByMeal.set(announcement.mealType, announcement);
    }
  }

  return MEAL_TYPES.map((mealType) => {
    const planned = meals.find((meal) => meal.mealType === mealType);

    return {
      items: planned?.items ?? [],
      mealType,
      sent: sentByMeal.get(mealType) ?? null,
      timing: planned?.timing ?? "",
    };
  });
}

/**
 * What the button should say.
 *
 * "Announce again" rather than a disabled button for a meal already sent: the
 * server owns the cooldown and returns a 429 naming the wait, and a cook who
 * genuinely needs to re-call a late sitting must be able to try. Disabling it
 * here would be the client inventing a rule the server does not have — and
 * getting it wrong whenever `foodReadyCooldownMinutes` is changed.
 */
export function mealButtonLabel(button: MealButton): string {
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
 * Whether an announcement actually reached anyone.
 *
 * `fanOutSOSAlert`'s cousin: `announceFoodReady` returns 201 once the log row is
 * written, whether or not a single resident had an account to notify. A hostel
 * with no linked resident accounts gets zero, and the cook should be told that
 * rather than left believing the kitchen has been called.
 */
export function reachedNobody(announcement: FoodReadyAnnouncement): boolean {
  return announcement.notifiedCount === 0;
}

/** How many of the four have gone out today. Drives the header line. */
export function announcedCount(buttons: MealButton[]): number {
  return buttons.filter((button) => button.sent).length;
}
