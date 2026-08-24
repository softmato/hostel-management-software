import type { AdminNightStatusRow } from "@/lib/admin-api";
import type { BadgeTone } from "@/lib/status";

/**
 * The roll call's own filtering, kept out of the screen so it can be tested.
 *
 * `manage/roll-call.tsx` is the only screen that owns tonight's roster, and
 * every decision it makes about *which rows to show* is here: the segments, the
 * counts under their labels, and the name search. None of it touches the
 * server — see `filterRollCall` for why that is deliberate rather than lazy.
 */

/** The five states the server's summary counts. */
export type NightStatusValue =
  | "INSIDE_HOSTEL"
  | "MARKED_SAFE"
  | "NOT_VERIFIED"
  | "OUTSIDE_HOSTEL"
  | "SOS_TRIGGERED";

/**
 * A segment is a filter over the roster, and `all` is the absence of one.
 *
 * There is deliberately no `sos` segment. An active emergency is a red banner
 * on Home and a push to every admin — a sixth tab with a `1` on it is the
 * quietest possible way to report one, and `Segmented` caps at five anyway.
 * SOS rows still appear under `All`, carrying the danger badge.
 */
export type RollCallSegment =
  | "all"
  | "inside"
  | "outside"
  | "safe"
  | "unverified";

/**
 * `unverified` first, because it is the only segment with anything to do.
 *
 * The rest of the roster is the record of a night that has already been
 * settled; the unverified list is the work. A warden opening this screen at
 * 10pm wants the people nobody has marked, and putting `All` in that slot would
 * make the default view a forty-row list that is mostly noise by midnight.
 */
export const ROLL_CALL_SEGMENTS: readonly {
  label: string;
  status: NightStatusValue | null;
  value: RollCallSegment;
}[] = [
  { label: "To check", status: "NOT_VERIFIED", value: "unverified" },
  { label: "Inside", status: "INSIDE_HOSTEL", value: "inside" },
  { label: "Outside", status: "OUTSIDE_HOSTEL", value: "outside" },
  { label: "Safe", status: "MARKED_SAFE", value: "safe" },
  { label: "All", status: null, value: "all" },
];

/**
 * What a warden may write over a resident's own answer.
 *
 * Deliberately **not** `NIGHT_STATUS_OPTIONS` from `lib/night-status.ts`: that
 * list is what a resident may say about *themselves*, and it excludes
 * `NOT_VERIFIED` precisely because a resident cannot un-say something. An admin
 * can — undoing an entry made in error is the whole reason the override route
 * exists — so the sets differ by one, and sharing them would give residents a
 * button that means "pretend I never answered".
 *
 * `SOS_TRIGGERED` is in neither. Writing it here would show an active emergency
 * on the roster with nobody alerted: no `SOSAlert` row, no fan-out, no
 * notification. The SOS button is the only thing that raises one.
 */
export const OVERRIDE_OPTIONS = [
  {
    description: "You have seen them, or their room is occupied.",
    label: "Inside the hostel",
    value: "INSIDE_HOSTEL",
  },
  {
    description: "Away tonight, with the hostel's knowledge.",
    label: "Outside the hostel",
    value: "OUTSIDE_HOSTEL",
  },
  {
    description: "Confirmed safe, wherever they are.",
    label: "Marked safe",
    value: "MARKED_SAFE",
  },
  {
    description: "Undo an entry that was recorded in error.",
    label: "Not verified",
    value: "NOT_VERIFIED",
  },
] as const;

/**
 * The badge on a row.
 *
 * The same mapping `nightChips` uses in `lib/admin-home.ts` and for the same
 * reason it is a table rather than a `statusTone` call: `NOT_VERIFIED` has to
 * stay **neutral**, not danger. Forty grey rows at 6pm is an evening that has
 * not started; forty red ones is an alarm, and a screen that cries every night
 * is a screen people stop reading.
 */
const ROW_TONES: Record<string, BadgeTone> = {
  INSIDE_HOSTEL: "success",
  MARKED_SAFE: "success",
  NOT_VERIFIED: "neutral",
  OUTSIDE_HOSTEL: "warning",
  SOS_TRIGGERED: "danger",
};

export function rollCallTone(status: string): BadgeTone {
  return ROW_TONES[status] ?? "neutral";
}

/** Every segment's count, over the whole roster rather than the visible page. */
export function rollCallCounts(
  rows: readonly AdminNightStatusRow[],
): Record<RollCallSegment, number> {
  const counts: Record<RollCallSegment, number> = {
    all: rows.length,
    inside: 0,
    outside: 0,
    safe: 0,
    unverified: 0,
  };

  for (const segment of ROLL_CALL_SEGMENTS) {
    if (!segment.status) {
      continue;
    }

    counts[segment.value] = rows.filter(
      (row) => row.status.status === segment.status,
    ).length;
  }

  return counts;
}

/**
 * Segment and search, both client-side, both on purpose.
 *
 * `GET /hostel-admin/night-status` takes a `?status=` filter, and using it
 * would be the obvious construction — but the endpoint's `summary` is computed
 * over the **filtered** roster, not the whole one. Asking the server for
 * `NOT_VERIFIED` therefore returns a summary saying every resident is
 * unverified, which is the exact number `AdminRollCallCard` draws its progress
 * bar from. The screen fetches the roster unfiltered and narrows it here, so
 * the banner keeps telling the truth while the segments change underneath it.
 *
 * The search is over the name and the room type only. Phone numbers are on the
 * roster screen and not on this payload — `serializeResidentSummary` does not
 * send one — so offering to search by phone here would be a field that silently
 * matches nothing.
 */
export function filterRollCall(
  rows: readonly AdminNightStatusRow[],
  { query, segment }: { query: string; segment: RollCallSegment },
): AdminNightStatusRow[] {
  const wanted = ROLL_CALL_SEGMENTS.find((entry) => entry.value === segment)?.status ?? null;
  const needle = query.trim().toLowerCase();

  return rows.filter((row) => {
    if (wanted && row.status.status !== wanted) {
      return false;
    }

    if (!needle) {
      return true;
    }

    return [row.resident.fullName, row.resident.roomType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}
