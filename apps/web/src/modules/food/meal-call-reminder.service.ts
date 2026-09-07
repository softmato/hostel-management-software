import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import {
  ROUTINE_DAYS,
  ROUTINE_MEAL_TYPES,
  type RoutineDay,
  type RoutineMealType,
} from "@/modules/food/food-routine.service";
import { resolveHostelCookUserIds } from "@/modules/food/kitchen-notify";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { sendPushToUsers } from "@/modules/notifications/push.service";
import { FoodReadyLogModel } from "@hostel/db/models/FoodReadyLog";
import { FoodRoutineModel } from "@hostel/db/models/FoodRoutine";
import { MealCallReminderModel } from "@hostel/db/models/MealCallReminder";
import {
  formatMinuteOfDay,
  mealOpensAtMinute,
  nepalDayKey,
  nepalMinuteOfDay,
  nepalWeekday,
} from "@hostel/shared/food/meal-window";

/**
 * "Lunch is due — tap Food ready when it's out."
 *
 * ## The gap this closes
 *
 * The cook portal's four announce buttons unlock at their meal's serving time,
 * and nothing told the kitchen that had happened. A cook either watched the app
 * or, far more likely, did not — and a resident's "is there food" notification
 * arrived late for no reason other than nobody being reminded to press a button
 * they were standing beside. The whole point of gating the button is undone if
 * the gate opening is a silent event.
 *
 * So the moment a button goes live, the hostel's cooks get a push saying so.
 * `HIGH`, for the same reason the announcement itself is: food goes cold, and
 * this is a dozing handset on a worktop that has to wake up now rather than at
 * Android's convenience.
 *
 * ## Why it is a cron and not a timer
 *
 * There is no process to hold a timer in. The web app is serverless, and a meal
 * time is a per-hostel value that changes whenever an admin edits the routine —
 * so the only durable schedule is "look at every hostel's clock, often". This
 * runs on the external scheduler with everything else (`docs/CRON.md`).
 *
 * That cadence is why the job asks a *window* question rather than an instant
 * one: did this meal come due within the last {@link GRACE_MINUTES}. Which in
 * turn is why each send is claimed in `MealCallReminder` before it goes out —
 * an overlapping or retried run must not buzz the kitchen twice. See that
 * model for why the claim is written first.
 *
 * ## Who is skipped, and why each one
 *
 * - **A meal not on today's routine.** A hostel that serves no Friday snack
 *   should not be nudged about one. The button is still there and still
 *   announceable — that is deliberate, see `mealButtons` — but an unplanned
 *   snack is the kitchen's own idea and not something to prompt.
 * - **A meal already announced today.** The cook is ahead of us.
 * - **A hostel with no cook on the roster.** Nobody to tell. Not claimed
 *   either, so a hostel that adds a cook mid-morning is still reminded about
 *   the afternoon's meals.
 */

/**
 * How late a reminder may still be sent.
 *
 * Wide enough to survive a missed run or two on a fifteen-minute schedule,
 * narrow enough that a scheduler outage over breakfast does not deliver
 * "breakfast is due" during lunch. Past this the meal is simply not reminded
 * about — the cook's own screen has had the button live the whole time.
 */
const GRACE_MINUTES = 45;

type RoutineRecord = {
  hostelId: Types.ObjectId;
  meals?: Array<{ dayOfWeek: RoutineDay; items?: string[]; mealType: RoutineMealType }>;
  timings?: Partial<Record<RoutineMealType, string>>;
};

type Candidate = {
  hostelId: Types.ObjectId;
  mealType: RoutineMealType;
  /** The serving time as the hostel wrote it — quoted back in the message. */
  timing: string;
};

export type MealCallReminderResult = {
  /** Meals whose button went live in this window, before any filtering. */
  due: number;
  /** Meals already announced, or with nobody on the roster to tell. */
  skipped: number;
  /** Reminders actually sent, one per hostel and meal. */
  sent: number;
};

/**
 * The meals whose announce button has just come live, across every hostel.
 *
 * Pure but for the routine rows it is handed, so the window arithmetic — the
 * part with a timezone and an off-by-one in it — is testable without a
 * database.
 */
export function dueMeals(routines: RoutineRecord[], now: Date): Candidate[] {
  const minuteOfDay = nepalMinuteOfDay(now);
  const today = ROUTINE_DAYS[nepalWeekday(now)];
  const candidates: Candidate[] = [];

  for (const routine of routines) {
    for (const mealType of ROUTINE_MEAL_TYPES) {
      const timing = routine.timings?.[mealType] ?? "";
      const opensAt = mealOpensAtMinute(timing);

      // No readable clock means no gate, so there is no moment to announce.
      if (opensAt === null) {
        continue;
      }

      if (minuteOfDay < opensAt || minuteOfDay > opensAt + GRACE_MINUTES) {
        continue;
      }

      const planned = (routine.meals ?? []).some(
        (meal) =>
          meal.dayOfWeek === today &&
          meal.mealType === mealType &&
          (meal.items ?? []).length > 0,
      );

      if (!planned) {
        continue;
      }

      candidates.push({ hostelId: routine.hostelId, mealType, timing });
    }
  }

  return candidates;
}

/** `Lunch` — the routine's enum as a cook would read it. */
function mealLabel(mealType: RoutineMealType): string {
  return `${mealType.charAt(0)}${mealType.slice(1).toLowerCase()}`;
}

/**
 * Sends the reminders due right now. Idempotent per hostel, meal and Nepali day.
 *
 * One run is one pass over every configured routine. That is a single lean read
 * of a collection with one document per hostel, which stays cheap long past the
 * point where anything else here would need rethinking.
 */
export async function runMealCallReminders(
  now: Date = new Date(),
): Promise<MealCallReminderResult> {
  await connectToDatabase();

  const routines = await FoodRoutineModel.find({})
    .select({ hostelId: 1, "meals.dayOfWeek": 1, "meals.items": 1, "meals.mealType": 1, timings: 1 })
    .lean<RoutineRecord[]>();

  const candidates = dueMeals(routines ?? [], now);

  if (candidates.length === 0) {
    return { due: 0, skipped: 0, sent: 0 };
  }

  const day = nepalDayKey(now);
  const hostelIds = [...new Set(candidates.map((meal) => meal.hostelId.toString()))];

  /*
   * Everything already announced today, in one query rather than one per
   * candidate. `startOfDay` is the Nepali midnight expressed as an instant, so
   * the comparison matches the day the reminder is keyed under.
   */
  const startOfDay = new Date(`${day}T00:00:00.000+05:45`);
  const announced = await FoodReadyLogModel.find({
    announcedAt: { $gte: startOfDay },
    hostelId: { $in: candidates.map((meal) => meal.hostelId) },
  })
    .select({ hostelId: 1, mealType: 1 })
    .lean<Array<{ hostelId: Types.ObjectId; mealType: string }>>();

  const alreadyCalled = new Set(
    (announced ?? []).map((log) => `${log.hostelId.toString()}:${log.mealType}`),
  );

  // The rosters, also in one pass — `resolveHostelCookUserIds` is per hostel and
  // a candidate list can hold four meals for the same kitchen.
  const cooksByHostel = new Map<string, string[]>();

  await Promise.all(
    hostelIds.map(async (hostelId) => {
      cooksByHostel.set(hostelId, await resolveHostelCookUserIds(hostelId));
    }),
  );

  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const hostelId = candidate.hostelId.toString();
    const cooks = cooksByHostel.get(hostelId) ?? [];

    if (cooks.length === 0 || alreadyCalled.has(`${hostelId}:${candidate.mealType}`)) {
      skipped += 1;
      continue;
    }

    /*
     * The claim, before the send. A duplicate key here means another run — or
     * this one, retried — already has this meal, and losing the race is a
     * successful outcome rather than an error to report.
     */
    try {
      await MealCallReminderModel.create({
        day,
        hostelId: candidate.hostelId,
        mealType: candidate.mealType,
        notifiedCount: cooks.length,
      });
    } catch {
      skipped += 1;
      continue;
    }

    try {
      const label = mealLabel(candidate.mealType);
      const opensAt = mealOpensAtMinute(candidate.timing);
      const title = `${label} is due`;
      const body = `${candidate.timing ? `${label} is served ${candidate.timing}. ` : ""}The Food ready button is live${
        opensAt === null ? "" : ` from ${formatMinuteOfDay(opensAt)}`
      } — tap it when the food is out.`;
      /*
       * `audience: "COOK"` is what sends a tapped notification into `(cook)`
       * rather than to the resident Food tab — see `push-routing.ts`. No
       * `actionUrl`: a cook has no website portal to link to, which
       * `kitchen-notify.ts` records at length.
       */
      const data = { audience: "COOK", mealType: candidate.mealType };

      for (const userId of cooks) {
        await createInAppNotification({
          body,
          category: "FOOD",
          data,
          hostelId,
          /*
           * The same priority the announcement itself goes out at, and for the
           * same reason: this is the message that makes that one timely. A
           * reminder delivered at Android's next maintenance window is a
           * reminder about a meal that is already cold.
           */
          priority: "HIGH",
          push: false,
          title,
          userId,
        });
      }

      await sendPushToUsers(cooks, {
        body,
        category: "FOOD",
        data,
        hostelId,
        priority: "HIGH",
        title,
      });

      sent += 1;
    } catch {
      /*
       * The claim stands. Retrying would mean dropping it, and a reminder that
       * can be re-sent by the next run fifteen minutes later is the double-buzz
       * this whole mechanism exists to prevent. One hostel's failed delivery
       * must not stop the others either — hence the try inside the loop.
       */
      skipped += 1;
    }
  }

  return { due: candidates.length, sent, skipped };
}
