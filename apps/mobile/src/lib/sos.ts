/**
 * What the SOS screen says, and when it is allowed to say it.
 *
 * Pure, and in `lib/` so it can be tested — Vitest here is node-side with no
 * React Native shim, so nothing that imports a component can be covered.
 *
 * ## The outcome is not "sent"
 *
 * `POST /resident/sos` returns `201` once the alert row, the night-status
 * change and the incident log are written. The *fan-out* — the emails, pushes
 * and realtime events that put it in front of a human — happens after that in
 * `fanOutSOSAlert`, which catches and swallows its own failures by design, so
 * that a broken mail provider cannot stop the alert being recorded.
 *
 * The consequence is that a `201` proves nothing about anyone having been
 * reached, and the only evidence is `notified.staff` / `notified.guardians`.
 * A resident holding a phone in the dark must be told which of those happened.
 * "Help is on the way" over a zero is the single worst string this app could
 * render, so `describeFanout` exists to make it unwriteable.
 */

/** `sosCreateSchema.message` — `z.string().trim().max(1000).optional()`. */
export const SOS_MESSAGE_MAX = 1000;

/**
 * The armed window, in seconds, before the alert is actually sent.
 *
 * Three is the figure in the phase tracker and it is a considered one: long
 * enough to undo a pocket press, short enough that someone in real trouble is
 * not counting. It runs *before* the request rather than after because there is
 * no resident-facing cancel — only staff can mark an alert `FALSE_ALARM` — so
 * this countdown is the only chance to take it back.
 */
export const SOS_COUNTDOWN_SECONDS = 3;

export type SosFanoutTone =
  /** Somebody at the hostel got it. */
  | "reached"
  /** It went somewhere, but not to the hostel — or not to everyone asked. */
  | "partial"
  /** Recorded, and seen by nobody. */
  | "unreached";

export type SosOutcome = {
  detail: string;
  /** Present when the resident should stop reading and start dialling. */
  callToAction: string | null;
  title: string;
  tone: SosFanoutTone;
};

function count(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Turns `notified` into a sentence that matches what actually happened.
 *
 * `guardianAlertEnabled` is part of the input because zero guardians means two
 * different things: if the resident never asked for guardians to be told, zero
 * is the correct outcome and not worth mentioning; if they did ask, zero is a
 * failure they need to know about. Reporting both the same way would either
 * invent a problem or hide one.
 */
export function describeFanout({
  guardianAlertEnabled,
  notified,
}: {
  guardianAlertEnabled: boolean;
  notified: { guardians: number; staff: number };
}): SosOutcome {
  const staff = Math.max(0, notified.staff);
  const guardians = Math.max(0, notified.guardians);

  if (staff === 0 && guardians === 0) {
    return {
      callToAction: "Call your emergency contacts now.",
      detail:
        "Your alert was saved and hostel staff will see it in their dashboard, but nobody could be notified right away.",
      title: "Recorded — but nobody was reached",
      tone: "unreached",
    };
  }

  if (staff === 0) {
    return {
      callToAction: "Call the hostel directly.",
      detail: `${count(guardians, "guardian")} ${
        guardians === 1 ? "was" : "were"
      } alerted, but no hostel staff could be notified.`,
      title: "Your guardians were alerted",
      tone: "partial",
    };
  }

  const staffPhrase = `${count(staff, "person", "people")} at your hostel ${
    staff === 1 ? "was" : "were"
  } alerted`;

  if (!guardianAlertEnabled) {
    return {
      callToAction: null,
      detail: `${staffPhrase}.`,
      title: "Alert sent",
      tone: "reached",
    };
  }

  if (guardians === 0) {
    return {
      callToAction: null,
      detail: `${staffPhrase}. No guardian could be notified.`,
      title: "Alert sent to your hostel",
      tone: "partial",
    };
  }

  return {
    callToAction: null,
    detail: `${staffPhrase}, along with ${count(guardians, "guardian")}.`,
    title: "Alert sent",
    tone: "reached",
  };
}

/**
 * The optional note that rides along with the alert.
 *
 * Trimmed before measuring, because the server trims before validating and a
 * client that counts whitespace rejects a message the server would have taken.
 */
export function validateSosMessage(message: string): string | null {
  if (message.trim().length > SOS_MESSAGE_MAX) {
    return `Keep it under ${SOS_MESSAGE_MAX} characters.`;
  }

  return null;
}

/**
 * `undefined` rather than `""` for an empty note.
 *
 * `sosCreateSchema` marks `message` optional; posting an empty string stores
 * one, and the admin alert list then shows a blank note where "no note" was
 * meant. Optional means absent, not empty.
 */
export function sosMessagePayload(message: string): string | undefined {
  const trimmed = message.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}
