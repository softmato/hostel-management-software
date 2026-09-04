/**
 * Attendance — its types, its vocabulary, and the rules over both.
 *
 * The network calls live in `attendance-api.ts`, per the split every pair in
 * this folder follows: `lib/api` drags in React Native, whose Flow source the
 * node-side runner cannot parse.
 *
 * Shapes mirror `getResidentAttendance` and `AttendanceZone` in
 * `apps/web/src/modules/attendance/attendance.service.ts`, read from the service
 * rather than guessed from the route names.
 *
 * ## `OUTSIDE` is neutral. This is the whole tone of the feature.
 *
 * `docs/DESIGN.md` is explicit: *"'Outside Hostel' is a **neutral** status, not a
 * warning — students leaving the hostel is normal life, not a red flag. Only
 * 'SOS' gets urgent red treatment."* And §1: *"Not a surveillance product…
 * never map-pin-tracking-you."*
 *
 * So nothing here returns a danger tone. A resident who was out on Friday sees
 * the same weight of ink as one who was in, because they have done nothing
 * wrong. The only tone that carries weight is `UNKNOWN`, and even that is muted
 * — it usually means a flat battery, not a missing person.
 *
 * ## What the reading actually is
 *
 * A **zone**, derived server-side from the distance between the phone and the
 * hostel's pin, and *never a coordinate* — `getResidentAttendance` returns only
 * `{ day, source, zone }`. Two consequences the wording has to respect:
 *
 * 1. **It is the phone, not the person.** Every string here says "your phone"
 *    where it can, because a resident who leaves their handset on the bed is
 *    recorded as present and the app must not claim otherwise.
 * 2. **A day with no row is not an absence.** It is a day nothing was recorded:
 *    the app was closed, the phone was off, consent was withdrawn, or the hostel
 *    had tracking switched off. `UNKNOWN` and "no row" are both "we do not know",
 *    and neither is evidence of anything.
 */

/** Mirrors `AttendanceZone`. */
export type AttendanceZone = "INSIDE" | "NEARBY" | "OUTSIDE" | "UNKNOWN";

/** `MOBILE_PING` is automatic; `MANUAL_OVERRIDE` is a warden correcting it. */
export type AttendanceSource = "MANUAL_OVERRIDE" | "MOBILE_PING";

export type AttendanceDay = {
  /** `YYYY-MM-DD`, already the hostel's own calendar day. */
  day: string;
  source: AttendanceSource;
  zone: AttendanceZone;
};

export type ResidentAttendance = {
  attendance: AttendanceDay[];
  consentGranted: boolean;
};

/**
 * The tones. Note what is **absent**: nothing returns `danger`.
 *
 * `brand` for inside rather than `success`, deliberately — "success" frames
 * being in the hostel as the correct outcome and being out as the failure,
 * which is the surveillance framing `DESIGN.md` rules out. Inside is simply the
 * state the hostel has a record of.
 */
export type AttendanceTone = "brand" | "neutral" | "warning";

const ZONES: Record<
  AttendanceZone,
  { description: string; label: string; tone: AttendanceTone }
> = {
  INSIDE: {
    description: "Your phone was at the hostel.",
    label: "At the hostel",
    tone: "brand",
  },
  NEARBY: {
    description: "Your phone was close to the hostel, but not inside it.",
    label: "Nearby",
    tone: "neutral",
  },
  OUTSIDE: {
    description: "Your phone was away from the hostel.",
    label: "Away",
    tone: "neutral",
  },
  UNKNOWN: {
    /*
     * Four different causes, one row. Naming them matters more than it looks:
     * a resident who sees "Not recorded" with no explanation assumes they are
     * being marked absent, and the honest answer is that nobody knows anything
     * about that day at all.
     */
    description:
      "Nothing was recorded — your phone was off, offline, or your hostel had not pinned its location.",
    label: "Not recorded",
    tone: "warning",
  },
};

export function zoneLabel(zone: AttendanceZone): string {
  return ZONES[zone].label;
}

export function zoneDescription(zone: AttendanceZone): string {
  return ZONES[zone].description;
}

export function zoneTone(zone: AttendanceZone): AttendanceTone {
  return ZONES[zone].tone;
}

/** A warden's correction outranks the phone, and the row should say so. */
export function sourceNote(source: AttendanceSource): string | null {
  return source === "MANUAL_OVERRIDE" ? "Set by your hostel" : null;
}

export type AttendanceMonth = {
  days: AttendanceDay[];
  /** `YYYY-MM`, for `formatPeriod`. */
  period: string;
};

/**
 * Grouped by month, newest first, headings outside the card.
 *
 * NOTES §5 — "lists group by date, with the heading **outside** the card". By
 * month rather than by day because the server returns 60 days: sixty headings
 * for sixty rows is not a grouping, it is a prefix.
 *
 * The server already sorts `day` descending, and this preserves that order
 * within each group rather than re-sorting — a second ordering is a second
 * chance to disagree with the payload.
 */
export function groupByMonth(days: AttendanceDay[]): AttendanceMonth[] {
  const months: AttendanceMonth[] = [];

  for (const entry of days) {
    const period = entry.day.slice(0, 7);
    const current = months[months.length - 1];

    if (current?.period === period) {
      current.days.push(entry);
      continue;
    }

    months.push({ days: [entry], period });
  }

  return months;
}

export type AttendanceSummary = {
  /** Days with a reading at the hostel. */
  inside: number;
  /** Days with a reading of any kind — the honest denominator. */
  recorded: number;
};

/**
 * The two numbers worth showing, and deliberately **not** a percentage.
 *
 * "You were present 78% of the time" invites a resident — and a hostel — to read
 * a location log as an attendance grade. It is not one: the denominator is days
 * the phone happened to report, not days of the tenancy, so the figure would be
 * arithmetic on an unknown. Two counts state what is known and imply nothing.
 */
export function summarize(days: AttendanceDay[]): AttendanceSummary {
  const recorded = days.filter((entry) => entry.zone !== "UNKNOWN");

  return {
    inside: recorded.filter((entry) => entry.zone === "INSIDE").length,
    recorded: recorded.length,
  };
}
