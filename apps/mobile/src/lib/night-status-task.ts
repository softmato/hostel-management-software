/**
 * The headless handler: a night-status answer recorded with the app not running.
 *
 * ## Why this is a task and not a listener
 *
 * `addNotificationResponseReceivedListener` only fires while there is a React
 * tree to receive it. The buttons on this notification are registered with
 * `opensAppToForeground: false` — which is the entire point, the resident
 * answers and the app never opens — and `expo-notifications` is explicit about
 * the consequence: *"If `false` and your app is killed (not just backgrounded),
 * `NotificationResponseReceived` listeners will not be triggered when a user
 * selects this action."*
 *
 * A background task is the documented way through. `registerTaskAsync` runs it
 * *"in response to a notification action tap when the app is backgrounded or
 * terminated"* — on Android. So on Android this file is what makes the feature
 * work on a phone that has not been opened in a week, which is the phone the
 * feature is for.
 *
 * ## iOS gets the queue instead, and loses nothing
 *
 * That same documentation says the action-tap wake is Android-only. On a
 * force-quit iPhone the tap produces no JS at all until the app is next
 * launched, so there is nothing here to run. The answer is not lost: the OS
 * hands the response back through `getLastNotificationResponseAsync` on the
 * next launch, `usePush` replays it into the same handler, and it posts then.
 * The cost is a delay, not a dropped answer — and iOS still handles the tap
 * immediately whenever the app is merely backgrounded rather than killed.
 *
 * ## Module scope, and required before everything else
 *
 * `expo-task-manager` needs the task defined by the time the OS looks for it,
 * and the OS may look during a cold start it triggered itself. So the
 * definition runs when this module is first evaluated, and `index.js` imports it
 * **before** `expo-router/entry` — importing it from a screen would define it
 * only once a screen had mounted, which in a headless wake never happens.
 */

import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { handleNightStatusResponse } from "@/lib/night-status-notification";

/**
 * Names the task in the OS's own registry, so it survives an app upgrade and
 * has to keep meaning the same thing. Prefixed rather than generic for the same
 * reason the action identifiers are.
 */
export const NIGHT_STATUS_TASK = "HOSTELHUB_NIGHT_STATUS_ACTION";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  NIGHT_STATUS_TASK,
  async ({ data, error }) => {
    /*
     * Every path here is guarded and none of them reports.
     *
     * There is no user watching, no screen to show a toast on, and an unhandled
     * rejection in a headless task is a process the OS kills — which on Android
     * counts against the app and makes the *next* wake less likely to be
     * granted. Failing quietly and leaving the answer in the queue is strictly
     * better than failing loudly into nothing.
     */
    if (error || !data) {
      return;
    }

    /*
     * The payload is a union: a *response* when a button was tapped, and a bare
     * notification when one merely arrived. Only the first is ours — a
     * notification that arrived and was not answered is not an answer, and
     * treating it as one would mark residents present for having a phone.
     *
     * `"actionIdentifier" in data` is the discriminator the library's own
     * example uses.
     */
    if (!("actionIdentifier" in data)) {
      return;
    }

    try {
      await handleNightStatusResponse(data);
    } catch {
      // As above. The queue already holds the answer.
    }
  },
);

/**
 * Ask the OS to actually run the task.
 *
 * Separate from the definition and deliberately not awaited at import time:
 * `registerTaskAsync` touches a native module, and a throw during module
 * evaluation of the app's entry file is a launch failure with no screen behind
 * it. The definition above is what has to be synchronous; the registration only
 * has to happen soon.
 */
export function registerNightStatusTask(): void {
  void Notifications.registerTaskAsync(NIGHT_STATUS_TASK).catch(() => undefined);
}

registerNightStatusTask();
