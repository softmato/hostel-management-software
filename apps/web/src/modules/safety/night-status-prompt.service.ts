import type { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { sendPushToUsers } from "@/modules/notifications/push.service";
import { HostelSettingsModel } from "@hostel/db/models/HostelSettings";
import { NightStatusModel } from "@hostel/db/models/NightStatus";
import { NightStatusPromptModel } from "@hostel/db/models/NightStatusPrompt";
import { ResidentModel } from "@hostel/db/models/Resident";
import {
  DEFAULT_PROMPT_TIME,
  formatPromptTime,
  nightKey,
  parsePromptTime,
  promptIsDue,
  reminderIsDue,
} from "@hostel/shared/night/night-window";

/**
 * "Are you in the hostel tonight?" — the notification the whole feature is for.
 *
 * ## The gap this closes
 *
 * Every piece of the night status existed except the part where anybody is
 * asked. A resident had to remember on their own, open the app, find the screen
 * and tap — so the warden's board filled up with `NOT_VERIFIED` every evening
 * and the round got done by knocking on doors, which is the job the product was
 * sold as removing. One notification at the hostel's own hour is the entire
 * difference between a feature and a screen nobody visits.
 *
 * ## It is answered **from the notification**, and that is the design
 *
 * The push carries a `categoryId`, so the handset draws the app's registered
 * action buttons under it: `Inside`, `At home`, `Outside…`. The first two are
 * one tap. The third opens the notification's own inline text field — the same
 * control WhatsApp's reply button uses — and the answer posts from a background
 * handler with the app never coming to the foreground.
 *
 * That is why this job's message is written the way it is: it is not a nudge
 * towards a screen, it is the question itself, and the buttons are the answer.
 * A build too old to know the category still gets a notification that opens the
 * night-status screen on tap, which is exactly what it did before.
 *
 * ## Why it is a cron and not a timer
 *
 * There is no process to hold a timer in — the web app is serverless and the
 * hour is a per-hostel value a warden can change at any moment. So the only
 * durable schedule is "look at every hostel's clock, often", on the external
 * scheduler with everything else (`docs/CRON.md`). Same shape, same reasoning,
 * as `meal-call-reminder.service.ts`, which this deliberately mirrors.
 *
 * That cadence is why {@link promptIsDue} asks a *window* question rather than
 * an instant one, and why each send is claimed in `NightStatusPrompt` before it
 * goes out. See that model for the failure it prevents.
 *
 * ## Who is skipped, and why each one
 *
 * - **A hostel with the prompt off.** It defaults off and stays off until a
 *   warden turns it on. Notifying a hostel's residents at 8pm on the strength of
 *   a default is how an app gets uninstalled.
 * - **A hostel whose prompt time is unreadable or out of range.** Skipped, never
 *   sent at some substituted hour — see `parsePromptTime`.
 * - **A resident who has already answered tonight.** The point is to ask people
 *   who have not answered. Asking someone who told you an hour ago is the fastest
 *   way to teach them the notification is not worth reading.
 * - **A resident with no user account.** Nothing to send to. A resident row can
 *   exist before its account does.
 * - **A resident who is not `ACTIVE`.** Somebody who has moved out is not
 *   answering a roll call, and somebody still `PENDING` has not moved in.
 */

/** What one run did, for the cron route to return and a human to read. */
export type NightStatusPromptResult = {
  /** Hostels whose hour fell in this run's window, before any filtering. */
  due: number;
  /** Hostels skipped: nobody to ask, or another run already claimed the night. */
  skipped: number;
  /** Hostels actually prompted. */
  sent: number;
  /** Residents the prompt reached, across every hostel in this run. */
  residents: number;
};

type SettingsRecord = {
  attendance?: {
    nightStatus?: {
      promptEnabled?: boolean;
      promptTime?: string;
      remindAfterMinutes?: number;
    };
  };
  hostelId: Types.ObjectId;
};

type ResidentRecord = {
  _id: Types.ObjectId;
  hostelId: Types.ObjectId;
  userId?: Types.ObjectId;
};

export type PromptCandidate = {
  hostelId: Types.ObjectId;
  /**
   * `PROMPT` is the hostel's own hour. `REMINDER` is the optional later chase,
   * claimed under its own key so sending one never consumes the other's slot.
   */
  kind: "PROMPT" | "REMINDER";
  /** The hostel's own setting, quoted back in the message. */
  promptTime: string;
};

/**
 * The hostels whose prompt hour fell in this run's window.
 *
 * Pure but for the settings rows it is handed, so the part with a timezone and
 * an off-by-one in it is testable without a database — the same split
 * `dueMeals` uses, and for the same reason.
 */
export function duePrompts(
  settings: SettingsRecord[],
  now: Date = new Date(),
): PromptCandidate[] {
  const candidates: PromptCandidate[] = [];

  for (const row of settings) {
    const config = row.attendance?.nightStatus;

    if (!config?.promptEnabled) {
      continue;
    }

    /*
     * An empty stored value means "never edited", which is the default hour
     * rather than no hour — the schema default only applies to documents
     * written after the field existed, and a hostel that enabled the prompt on
     * an older settings row would otherwise be silently skipped forever.
     */
    const promptTime = config.promptTime?.trim() || DEFAULT_PROMPT_TIME;

    if (parsePromptTime(promptTime) === null) {
      continue;
    }

    if (promptIsDue(promptTime, now)) {
      candidates.push({ hostelId: row.hostelId, kind: "PROMPT", promptTime });
      continue;
    }

    /*
     * The chase, for whoever still has not answered. Off by default and only
     * reachable once the first ask's window has closed — `continue` above means
     * a hostel is never a candidate for both in one run, which would claim two
     * rows and send two notifications inside the same minute.
     */
    if (reminderIsDue(promptTime, config.remindAfterMinutes, now)) {
      candidates.push({ hostelId: row.hostelId, kind: "REMINDER", promptTime });
    }
  }

  return candidates;
}

/**
 * What the notification says.
 *
 * Kept short on purpose. The buttons are the content; the body's only job is to
 * be legible in a collapsed notification on a locked screen, where Android
 * gives it one line. "Tap Inside or Outside" is deliberately **not** in it —
 * naming the buttons in the text is how a message reads as broken on the build
 * where the buttons did not render.
 */
export function promptMessage(promptTime: string, kind: "PROMPT" | "REMINDER" = "PROMPT") {
  const minute = parsePromptTime(promptTime);
  const at = minute === null ? promptTime : formatPromptTime(minute);

  /*
   * The chase says it is a chase. A second notification with the same words as
   * the first reads as a bug, and a resident who thinks the app is repeating
   * itself stops reading both.
   */
  return kind === "REMINDER"
    ? {
        body: `You have not told your hostel where you are tonight. Answer here — you do not need to open the app.`,
        title: "Still waiting on your night status",
      }
    : {
        body: `Your hostel checks in at ${at}. Answer here — you do not need to open the app.`,
        title: "Are you in the hostel tonight?",
      };
}

/**
 * The identifier the handset matches against its registered category.
 *
 * Must equal `NIGHT_STATUS_CATEGORY` in
 * `apps/mobile/src/lib/night-status-notification.ts`. A mismatch is not an
 * error anywhere — the notification simply arrives with no buttons on it — so
 * the two constants name each other in their comments and this one is the
 * reason that file's is not free to change.
 */
export const NIGHT_STATUS_CATEGORY = "night-status";

/**
 * Sends tonight's prompts. Idempotent per hostel and night.
 *
 * One run is one lean pass over the settings collection — one document per
 * hostel — which stays cheap well past the point where anything else here would
 * need rethinking.
 */
export async function runNightStatusPrompts(
  now: Date = new Date(),
): Promise<NightStatusPromptResult> {
  await connectToDatabase();

  const settings = await HostelSettingsModel.find({
    "attendance.nightStatus.promptEnabled": true,
  })
    .select({ "attendance.nightStatus": 1, hostelId: 1 })
    .lean<SettingsRecord[]>();

  const candidates = duePrompts(settings ?? [], now);

  if (candidates.length === 0) {
    return { due: 0, residents: 0, sent: 0, skipped: 0 };
  }

  const night = nightKey(now);
  const hostelIds = candidates.map((candidate) => candidate.hostelId);

  /*
   * Everyone who could be asked, and everyone who already answered, in two
   * queries rather than two per hostel.
   *
   * `night` is matched rather than `checkedAt` compared: the stored key is what
   * makes "answered tonight" mean the same thing here, on the warden's board and
   * in the app. Rows written before that field existed have none, so they never
   * match — which is correct, because an answer from before this shipped is not
   * an answer about tonight.
   */
  const [residents, answered] = await Promise.all([
    ResidentModel.find({
      hostelId: { $in: hostelIds },
      isDeleted: false,
      status: "ACTIVE",
      userId: { $exists: true, $ne: null },
    })
      .select({ hostelId: 1, userId: 1 })
      .lean<ResidentRecord[]>(),
    NightStatusModel.find({ hostelId: { $in: hostelIds }, night })
      .select({ residentId: 1 })
      .lean<{ residentId: Types.ObjectId }[]>(),
  ]);

  const answeredIds = new Set(
    (answered ?? []).map((row) => row.residentId.toString()),
  );
  const toAskByHostel = new Map<string, string[]>();

  for (const resident of residents ?? []) {
    if (!resident.userId || answeredIds.has(resident._id.toString())) {
      continue;
    }

    const key = resident.hostelId.toString();
    const list = toAskByHostel.get(key) ?? [];

    list.push(resident.userId.toString());
    toAskByHostel.set(key, list);
  }

  let sent = 0;
  let skipped = 0;
  let reached = 0;

  for (const candidate of candidates) {
    const hostelId = candidate.hostelId.toString();
    const userIds = toAskByHostel.get(hostelId) ?? [];

    /*
     * Nobody left to ask is **not** claimed. A hostel where everybody happened
     * to answer early should still be promptable if somebody's answer is
     * withdrawn later in the window, and claiming a night we did not use would
     * silently consume it.
     */
    if (userIds.length === 0) {
      skipped += 1;
      continue;
    }

    /*
     * The claim, before the send. A duplicate key here means another run — or
     * this one, retried — already holds this night, and losing that race is a
     * successful outcome rather than an error to report.
     */
    try {
      await NightStatusPromptModel.create({
        hostelId: candidate.hostelId,
        kind: candidate.kind,
        night,
        notifiedCount: userIds.length,
        promptTime: candidate.promptTime,
      });
    } catch {
      skipped += 1;
      continue;
    }

    const { body, title } = promptMessage(candidate.promptTime, candidate.kind);

    /*
     * The bell row, one per resident, with the same three answers as buttons.
     *
     * `push: false` because the Expo send is batched below — one round trip for
     * the hostel instead of one per resident. The row still has to exist: a
     * resident who swipes the notification away without answering, or whose
     * phone had notifications off entirely, has to be able to find the question
     * somewhere, and the bell is where every other unanswered thing in this app
     * lives.
     *
     * The actions post to the same endpoint the notification buttons do, so
     * there is one write path for an answer regardless of which surface it came
     * from.
     */
    await Promise.all(
      userIds.map((userId) =>
        createInAppNotification({
          actions: [
            {
              endpoint: "/api/v1/resident/night-status",
              key: "INSIDE_HOSTEL",
              label: "Inside",
              method: "POST",
              payload: { source: "PUSH_ACTION", status: "INSIDE_HOSTEL" },
              tone: "primary",
            },
            {
              endpoint: "/api/v1/resident/night-status",
              key: "OUTSIDE_HOSTEL",
              label: "Outside",
              method: "POST",
              payload: { source: "PUSH_ACTION", status: "OUTSIDE_HOSTEL" },
            },
          ],
          body,
          category: "NIGHT_STATUS",
          data: { kind: candidate.kind, night, promptTime: candidate.promptTime },
          hostelId,
          /*
           * `NORMAL`, deliberately. This is a routine evening question, not an
           * alarm — spending a high-priority wake on it every single night is
           * how the channel earns itself a mute. The SOS path is what `HIGH` is
           * for.
           */
          priority: "NORMAL",
          push: false,
          title,
          userId,
        }),
      ),
    );

    const result = await sendPushToUsers(userIds, {
      body,
      category: "NIGHT_STATUS",
      /* The buttons. Everything above is what happens when they are not there. */
      categoryId: NIGHT_STATUS_CATEGORY,
      data: { kind: candidate.kind, night, promptTime: candidate.promptTime },
      hostelId,
      priority: "NORMAL",
      title,
    });

    sent += 1;
    reached += result.sent;
  }

  return { due: candidates.length, residents: reached, sent, skipped };
}
