/**
 * What a resident may say about their own night, and whether they have said it.
 *
 * Its own module so it can be tested — Vitest here is node-side with no React
 * Native shim. Same split as `lib/sos.ts` and `lib/complaints.ts`.
 */

import { nepalDayKey } from "@/lib/format";
import type { NightStatus, NightStatusValue } from "@/lib/resident-api";

/* -------------------------------------------------------------------------- */
/* What a resident is allowed to report                                       */
/* -------------------------------------------------------------------------- */

/**
 * The three a resident may set — a deliberate subset of the five
 * `nightStatusSchema` accepts.
 *
 * **`SOS_TRIGGERED` is excluded even though the server takes it.**
 * `POST /resident/night-status` validates against the full enum, so a client
 * could set it — and nothing would happen: no `SOSAlert` row, no fan-out, no
 * notification. It would show as an active emergency on the warden's roster with
 * nobody having been told, which is precisely the failure `lib/sos.ts` exists to
 * make unwriteable. The SOS button is the only way to raise one.
 *
 * **`NOT_VERIFIED` is excluded** because it is the *absence* of an answer —
 * `serializeNightStatus` returns it for a resident with no row at all. Offering
 * it as a choice would let someone "set" the state that means they set nothing.
 */
export const NIGHT_STATUS_OPTIONS: {
  description: string;
  icon: "home-outline" | "moon-outline" | "shield-checkmark-outline";
  label: string;
  value: Extract<NightStatusValue, "INSIDE_HOSTEL" | "MARKED_SAFE" | "OUTSIDE_HOSTEL">;
}[] = [
  {
    description: "In for the night.",
    icon: "home-outline",
    label: "Inside the hostel",
    value: "INSIDE_HOSTEL",
  },
  {
    description: "Staying elsewhere tonight — your hostel will not chase you.",
    icon: "moon-outline",
    label: "Out for the night",
    value: "OUTSIDE_HOSTEL",
  },
  {
    description: "Somewhere else, and fine. Use this after an incident.",
    icon: "shield-checkmark-outline",
    label: "I am safe",
    value: "MARKED_SAFE",
  },
];

export type SelfReportableStatus = (typeof NIGHT_STATUS_OPTIONS)[number]["value"];

export function isSelfReportable(status: string): status is SelfReportableStatus {
  return NIGHT_STATUS_OPTIONS.some((option) => option.value === status);
}

/* -------------------------------------------------------------------------- */
/* Which night an answer belongs to                                           */
/* -------------------------------------------------------------------------- */

/**
 * A night starts at 17:00 Nepal time and runs to 17:00 the next day.
 *
 * Without a window, "have I checked in tonight?" collapses into "was this today?"
 * — and a resident who checked in at 11pm is told at 00:30 that they have not
 * checked in tonight, on the one screen whose entire job is to answer that
 * question correctly. Shifting the instant back 17 hours before asking for its
 * Nepal day gives every evening and the small hours after it the same key.
 *
 * **17:00 is a client-side product choice with no server counterpart.** Nothing
 * in `apps/web` defines a night boundary — `writeNightStatus` just stamps
 * `checkedAt` — so this decides only what this screen says, never what is stored.
 */
const NIGHT_STARTS_AT_HOUR = 17;

function nightKey(date: Date): string {
  return nepalDayKey(new Date(date.getTime() - NIGHT_STARTS_AT_HOUR * 3_600_000));
}

/** Whether `checkedAt` falls in the night `now` is in. */
export function isCurrentNight(
  checkedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!checkedAt) {
    return false;
  }

  const date = new Date(checkedAt);

  return Number.isNaN(date.getTime()) ? false : nightKey(date) === nightKey(now);
}

/* -------------------------------------------------------------------------- */
/* The wording                                                                */
/* -------------------------------------------------------------------------- */

export type NightStanding = {
  /** True once tonight's answer is on record — drives the tick, not the colour. */
  answered: boolean;
  /** One sentence: what the hostel currently believes. */
  headline: string;
  /**
   * Set only when an SOS is on this resident's record. The screen renders it as a
   * warning, because changing a night status does **not** retract an alert.
   */
  sosNotice?: string;
  /** The status to preselect, or null when there is nothing worth preselecting. */
  suggested: SelfReportableStatus | null;
};

export function nightStanding(
  status: NightStatus,
  now: Date = new Date(),
): NightStanding {
  const current = isCurrentNight(status.checkedAt, now);

  /*
   * An SOS outranks everything. It is written by `triggerSOS`, not by a resident,
   * and only staff can move an alert off `ACTIVE` — so the screen must not imply
   * that picking "I am safe" cancels it.
   */
  if (status.status === "SOS_TRIGGERED") {
    return {
      answered: current,
      headline: "Your hostel has an SOS alert on your record.",
      sosNotice:
        "Telling them you are safe updates your night status. It does not close the alert — only hostel staff can do that.",
      suggested: "MARKED_SAFE",
    };
  }

  if (!current || !isSelfReportable(status.status)) {
    return {
      answered: false,
      headline: "Your hostel does not know where you are tonight.",
      suggested: null,
    };
  }

  const option = NIGHT_STATUS_OPTIONS.find(
    (candidate) => candidate.value === status.status,
  );

  return {
    answered: true,
    headline: `Your hostel has you as ${option?.label.toLowerCase() ?? "checked in"} tonight.`,
    suggested: status.status,
  };
}

/**
 * `nightStatusUpdateSchema` has `note` as **optional with no minimum** and a
 * 1000-character cap, so unlike a complaint confirmation a one-character note is
 * fine — only an empty one has to be omitted rather than sent as `""`.
 */
export function nightNote(raw: string): { error?: string; note?: string } {
  const note = raw.trim();

  if (note.length === 0) {
    return {};
  }

  return note.length > 1000 ? { error: "That note is too long." } : { note };
}
