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

/* -------------------------------------------------------------------------- */
/* Whether an alert is still worth showing                                    */
/* -------------------------------------------------------------------------- */

/**
 * How long an unsettled alert keeps flagging the home screen: one day.
 *
 * The flag exists to say *something is happening right now*. An alert nobody has
 * closed after a day is still on the record and still on the hostel's queue, but
 * it has stopped being news to the person who raised it — and a badge that never
 * goes out is a badge nobody reads. `/sos` keeps the full history either way.
 */
export const SOS_FLAG_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `serializeSOS`'s statuses, as the two states that matter to a resident. */
const SETTLED_SOS = ["FALSE_ALARM", "RESOLVED"] as const;

/** The shape both `stayPill` and `nightStanding` need. `SosAlert` satisfies it. */
export type SosStanding = {
  createdAt?: string;
  status: string;
};

/**
 * Whether the hostel has yet to settle this alert.
 *
 * `ACTIVE` and `ACKNOWLEDGED` are open — acknowledged means a warden has seen
 * it, not that it is over. `RESOLVED` and `FALSE_ALARM` are the two `resolvedAt`
 * is stamped for, and both mean staff have closed it.
 */
export function sosIsOpen(alert: SosStanding | null | undefined): boolean {
  return alert ? !SETTLED_SOS.some((settled) => settled === alert.status) : false;
}

/**
 * Whether an alert is open **and** raised within the last day — the one thing
 * allowed to put `SOS active` on the home card.
 *
 * It reads the alert, never `nightStatus.status`. `writeNightStatus` upserts one
 * row per resident and expires nothing, so `SOS_TRIGGERED` sits there until the
 * resident happens to set a new status: the card was flagging test alerts from
 * weeks earlier, and kept flagging them after staff had closed the alert.
 */
export function sosIsFlagged(
  alert: SosStanding | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sosIsOpen(alert) || !alert?.createdAt) {
    return false;
  }

  const raised = new Date(alert.createdAt).getTime();

  if (Number.isNaN(raised)) {
    return false;
  }

  return now.getTime() - raised <= SOS_FLAG_WINDOW_MS;
}

/**
 * What each alert status is called on a resident's own history, and how it is
 * toned.
 *
 * Deliberately **not** `<StatusPill>`: `lib/status.ts` maps `ACTIVE` to
 * `success`, which is right for a listing and exactly backwards for an
 * emergency. A green `Active` against an alert nobody has answered is the kind
 * of reassurance this module exists to make unwriteable.
 *
 * The words are the resident's, not the schema's. `ACKNOWLEDGED` means a warden
 * has opened it and no more than that, so it says so rather than borrowing a
 * word that sounds like a resolution.
 */
export function describeSosStatus(status: string): {
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
} {
  switch (status) {
    case "ACKNOWLEDGED":
      return { label: "Seen by staff", tone: "warning" };
    case "FALSE_ALARM":
      return { label: "False alarm", tone: "neutral" };
    case "RESOLVED":
      return { label: "Closed by staff", tone: "success" };
    default:
      return { label: "Open", tone: "danger" };
  }
}

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
