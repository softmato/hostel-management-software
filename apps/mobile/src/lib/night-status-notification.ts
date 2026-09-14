/**
 * Answering the night-status prompt from the notification shade.
 *
 * This is the file the whole feature is for. Everything else — the cron, the
 * settings, the board — exists so that a resident can press one button on a
 * locked phone and be done, with the app never coming to the foreground.
 *
 * ## The three moving parts
 *
 * 1. {@link registerNightStatusCategory} tells the OS what buttons to draw under
 *    a notification carrying this category. Registered once per launch, because
 *    a category is per-install state that a reinstall or an OS update can lose.
 * 2. {@link handleNightStatusResponse} turns a tapped button into a recorded
 *    answer. It is called from three places — the background task, the
 *    foreground listener, and the cold-start replay — and it is idempotent, so
 *    two of them seeing the same response is not two answers.
 * 3. {@link flushNightStatusQueue} sends whatever the background could not.
 *
 * ## Why the background post is a bare `fetch`
 *
 * `lib/api.ts` is the right client everywhere else and the wrong one here. Its
 * interceptors refresh a rotating token, replay a queue of waiting requests,
 * and on a failed refresh wipe every Redux slice and route the user to login —
 * all of which assume a running app with a navigator. In a headless task woken
 * by a notification there is no navigator, and a rotation racing the foreground
 * app's own rotation is how a resident gets logged out for answering a roll
 * call. `refresh-tokens.ts` documents that rotation and it is exactly what must
 * not happen in a process nobody is watching.
 *
 * So the background path does the simplest possible thing: read the stored
 * token, post once, and hand the answer to the queue if that does not work. The
 * flush on next foreground is where the real client — with its refresh, its
 * retry and its error reporting — gets to run.
 *
 * ## Write to disk first, always
 *
 * {@link handleNightStatusResponse} enqueues **before** it posts. The OS gives a
 * background handler a few seconds and then kills the process, and a post that
 * was still in flight when that happened is indistinguishable from one that was
 * never made. Queue-then-post means the worst case is sending twice, which the
 * server upserts into one row; post-then-queue means the worst case is losing
 * the answer, which nobody ever finds out about.
 */

import * as Notifications from "expo-notifications";

import { api, API_BASE_URL } from "@/lib/api";
import { AUTH_CLIENT_HEADER, MOBILE_AUTH_CLIENT } from "@/lib/api-contract";
import {
  isNightStatusPrompt,
  NIGHT_STATUS_BUTTONS,
  NIGHT_STATUS_CATEGORY,
  parseNightStatusAction,
  type NightStatusAnswer,
} from "@/lib/night-status-actions";
import {
  dequeueNightStatus,
  enqueueNightStatus,
  readNightStatusQueue,
  type QueuedNightStatus,
} from "@/lib/night-status-queue";
import {
  HAS_NATIVE_NIGHT_PROMPT,
  takeNativePendingAnswers,
} from "@/lib/night-prompt-native";
import { readTokens } from "@/lib/session";

/** A background post gets one short attempt; the queue covers the rest. */
const BACKGROUND_TIMEOUT_MS = 8_000;

/**
 * Register the buttons with the OS.
 *
 * Every action sets `opensAppToForeground: false`. That is the feature: without
 * it the OS launches the app on every tap, which is precisely the thing the
 * owner asked to avoid. The documented cost is that on a **killed** app the
 * foreground `NotificationResponseReceived` listener will not fire — which is
 * why the background task in `index.js` exists on Android, and why the queue and
 * the cold-start replay exist for iOS.
 *
 * Failure is silent and never fatal, like everything in `push-notifications.ts`.
 * A phone that refuses the category still receives the notification; it just
 * arrives without buttons, and tapping it opens the night-status screen. That is
 * the pre-existing behaviour, so a failure here degrades rather than breaks.
 */
export async function registerNightStatusCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(
      NIGHT_STATUS_CATEGORY,
      NIGHT_STATUS_BUTTONS.map((button) => ({
        buttonTitle: button.buttonTitle,
        identifier: button.identifier,
        options: {
          /* The whole point. See the note above. */
          opensAppToForeground: false,
        },
        ...(button.textInput ? { textInput: button.textInput } : {}),
      })),
    );
  } catch {
    // See the note above on degrading rather than breaking.
  }
}

/**
 * Clear night-status prompts sitting in the shade: all of them once answered,
 * or all but the newest while a new round comes in.
 *
 * ## Why the app does this, not the server
 *
 * The server asks again every round until the resident answers. The native
 * Android handler replaces the prompt in place, but the JavaScript path —
 * iPhones, and Android builds without the module — receives each round as its
 * own push, and Expo's push API has no collapse id to make the OS replace it.
 * So whenever this code runs — a round arriving with the app open, the app
 * coming to the front, an answer given anywhere — it removes the copies itself.
 * A closed iPhone still stacks until the app next runs; closing that needs
 * APNs's `apns-collapse-id`, which only a direct APNs send can set.
 *
 * Never throws. A build with the native module skips this: its prompt is not
 * an expo-notifications request, and it already keeps one in the shade.
 */
export async function collapseNightPrompts(options: { keepLatest: boolean }) {
  if (HAS_NATIVE_NIGHT_PROMPT) {
    return;
  }

  try {
    const prompts = (await Notifications.getPresentedNotificationsAsync())
      .filter((notification) =>
        isNightStatusPrompt(
          notification.request.content.data as Record<string, unknown> | undefined,
        ),
      )
      .sort((a, b) => b.date - a.date);

    await Promise.all(
      prompts
        .slice(options.keepLatest ? 1 : 0)
        .map((notification) =>
          Notifications.dismissNotificationAsync(notification.request.identifier),
        ),
    );
  } catch {
    // A stacked prompt is a nuisance, not a failure.
  }
}

/**
 * Post one answer with the token the prompt carried, or the stored session.
 *
 * Returns whether the server took it. Never throws — every caller is either a
 * background handler with no error surface or a flush that must carry on to the
 * next entry.
 *
 * ## The answer token comes first
 *
 * The prompt is answered hours after the app last ran, and the stored access
 * token lives fifteen minutes — on a real phone every background post with it
 * came back 401. Refreshing here would race the app's own rotation (see
 * `refresh-tokens.ts`), so instead each resident's copy of the prompt carries a
 * token good only for tonight's answer (`nightAnswerData` on the server), and
 * that is what gets sent. The session token remains the fallback for a prompt
 * sent before the server issued them.
 */
async function postAnswer(entry: QueuedNightStatus): Promise<boolean> {
  const answerToken = entry.answerToken;
  const bearer =
    answerToken ?? (await readTokens().catch(() => null))?.accessToken ?? null;

  if (!bearer) {
    /*
     * Signed out, or the token was cleared while the notification sat in the
     * shade. Keep the entry: the resident may well sign back in on the same
     * phone tonight, and the flush will send it then — subject to the night
     * check in `flushNightStatusQueue`, which is what stops a stale answer
     * being filed against the wrong night.
     */
    return false;
  }

  const path = answerToken
    ? (entry.answerPath ?? "/api/v1/resident/night-status/answer")
    : "/api/v1/resident/night-status";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKGROUND_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      body: JSON.stringify({
        answeredAt: entry.answeredAt,
        note: entry.note,
        reasonCode: entry.reasonCode,
        /* The one metric that says whether this feature is working at all. */
        source: "PUSH_ACTION",
        status: entry.status,
      }),
      headers: {
        [AUTH_CLIENT_HEADER]: MOBILE_AUTH_CLIENT,
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    /*
     * A 401 on the session fallback is not retried here: refreshing rotates the
     * pair, and doing that from a background process is how a resident gets
     * logged out for answering. It stays queued for the foreground flush.
     */
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Record the answer behind a tapped notification button.
 *
 * Returns `true` when this response was one of ours and has been dealt with, so
 * the caller knows not to route it as an ordinary notification tap. `false` for
 * everything else — a different category, or a plain tap on the body, which
 * should still open the screen.
 *
 * Safe to call twice for one response. The queue keys on `answeredAt` and the
 * server upserts one row per resident per night, so the foreground listener and
 * the cold-start replay both seeing a tap costs one redundant request at worst.
 *
 * On an Android build with the native module this is never reached for the
 * prompt's buttons — `modules/hostelhub-night-prompt` answers them without
 * starting JavaScript at all. It remains the path on iOS, and on a build
 * without that module.
 */
export async function handleNightStatusResponse(
  response: Notifications.NotificationResponse,
): Promise<boolean> {
  const request = response.notification.request;
  const data = request.content.data as Record<string, unknown> | undefined;
  const answer = parseNightStatusAction(
    response.actionIdentifier,
    response.userText,
  );

  if (!answer) {
    return false;
  }

  const entry: QueuedNightStatus = {
    ...answer,
    answeredAt: new Date().toISOString(),
    ...(typeof data?.answerToken === "string"
      ? { answerToken: data.answerToken }
      : {}),
    ...(typeof data?.answerPath === "string" ? { answerPath: data.answerPath } : {}),
    night: typeof data?.night === "string" ? data.night : undefined,
  };

  // Disk before network. See the note at the top of this file.
  await enqueueNightStatus(entry);

  /*
   * Dismissed before the network, not after. The answer is already on disk, so
   * nothing is lost by clearing the shade now — and Android keeps a spinning
   * "sending" row under a typed reply until the notification changes, which
   * with a slow network read as the tap not working.
   */
  await Notifications.dismissNotificationAsync(request.identifier).catch(
    () => undefined,
  );
  // And every earlier round still stacked under it — one answer covers them all.
  await collapseNightPrompts({ keepLatest: false });

  if (await postAnswer(entry)) {
    await dequeueNightStatus(entry.answeredAt);
  }

  return true;
}

/**
 * Send whatever the background could not, with the real client.
 *
 * Called on app foreground. This is where a token refresh is allowed to happen,
 * because there is an app around it to handle being signed out.
 *
 * ## Entries about a night that has passed are dropped, not sent
 *
 * An answer is about one night. A phone that was offline for two days holds
 * "I am at home" from Tuesday, and posting it on Thursday would write Tuesday's
 * answer onto Thursday's night — the server stamps the night at write time, so
 * it has no way to know better. Silently marking somebody out on a night they
 * never spoke about is worse than losing an old answer, so the old answer loses.
 */
export async function flushNightStatusQueue(
  currentNight: string | null = null,
): Promise<number> {
  /*
   * Answers the native Android handler could not send go through the same
   * queue, so there is one place that decides what is stale and one loop that
   * sends.
   */
  for (const pending of takeNativePendingAnswers()) {
    await enqueueNightStatus(pending);
  }

  const queue = await readNightStatusQueue();

  if (queue.length === 0) {
    return 0;
  }

  let sent = 0;

  for (const entry of queue) {
    if (currentNight && entry.night && entry.night !== currentNight) {
      // Stale. See the note above.
      await dequeueNightStatus(entry.answeredAt);
      continue;
    }

    if (entry.answerToken) {
      // Its own credential: no session, no refresh. A failure is left queued.
      if (!(await postAnswer(entry))) {
        break;
      }

      await dequeueNightStatus(entry.answeredAt);
      sent += 1;
      continue;
    }

    try {
      await api.post("/resident/night-status", {
        /* So a late flush cannot overwrite a newer answer. */
        answeredAt: entry.answeredAt,
        note: entry.note,
        reasonCode: entry.reasonCode,
        source: "PUSH_ACTION",
        status: entry.status,
      });
      await dequeueNightStatus(entry.answeredAt);
      sent += 1;
    } catch {
      /*
       * Still unreachable, or the session is genuinely gone. Stop rather than
       * carry on: the rest of the queue will fail the same way, and a burst of
       * doomed requests on every foreground is how a flush becomes a battery
       * complaint.
       */
      break;
    }
  }

  return sent;
}

/** Re-exported so callers need one import for the whole mechanism. */
export type { NightStatusAnswer };
export { NIGHT_STATUS_CATEGORY };
