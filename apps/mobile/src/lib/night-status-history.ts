/**
 * The resident's night-by-night record, shaped for the history screen.
 *
 * The network call is `getResidentNightStatusHistory` in `resident-api.ts`;
 * this is the part with rules in it, kept free of React Native so Vitest runs
 * it — the split every pair in `lib/` follows.
 */

import { bsPeriodOf } from "@hostel/calendar/bs";

import type { CalendarSystem } from "@/lib/calendar";
import { type NightStatusReasonCode, reasonLabel } from "@/lib/night-status-actions";

export type NightHistoryEntry = {
  answeredAt: string | null;
  changes: number;
  /** `YYYY-MM-DD`, the 17:00-to-17:00 night. */
  night: string;
  note: string | null;
  reasonCode: NightStatusReasonCode | null;
  source: "RESIDENT" | "WARDEN_OVERRIDE" | "SOS" | null;
  status: string;
};

export type NightHistoryMonth = {
  entries: NightHistoryEntry[];
  /** A period in the reader's calendar — `2083-05` in BS, `2026-09` in AD. */
  period: string;
};

/** Noon in Nepal on the night's date — safely inside its calendar day. */
function nightInstant(night: string): Date {
  return new Date(`${night}T12:00:00.000+05:45`);
}

/**
 * Entries under month headings, in the calendar the reader chose.
 *
 * Grouped by that calendar's month rather than the AD one, because the heading
 * is printed in it: an AD `2026-09` group labelled in Bikram Sambat would put
 * the end of Bhadra and the start of Aswin under one heading.
 */
export function groupNightsByMonth(
  entries: readonly NightHistoryEntry[],
  calendar: CalendarSystem,
): NightHistoryMonth[] {
  const months: NightHistoryMonth[] = [];

  for (const entry of entries) {
    const period =
      calendar === "BS" ? bsPeriodOf(nightInstant(entry.night)) : entry.night.slice(0, 7);
    const current = months[months.length - 1];

    if (current?.period === period) {
      current.entries.push(entry);
      continue;
    }

    months.push({ entries: [entry], period });
  }

  return months;
}

/** Nights in, nights out, nights with no answer — for the two tiles on top. */
export function summarizeNights(entries: readonly NightHistoryEntry[]) {
  let inside = 0;
  let outside = 0;
  let unanswered = 0;

  for (const entry of entries) {
    if (entry.status === "INSIDE_HOSTEL" || entry.status === "MARKED_SAFE") {
      inside += 1;
    } else if (entry.status === "OUTSIDE_HOSTEL") {
      outside += 1;
    } else if (entry.status === "NOT_VERIFIED") {
      unanswered += 1;
    }
  }

  return { inside, outside, total: entries.length, unanswered };
}

/**
 * The second line of a night's row: the reason and who set it.
 *
 * Only facts. A night nobody answered says so; a warden's correction is named,
 * because a resident reading "Inside" on a night they were away needs to know
 * they did not say it.
 */
export function nightDetail(entry: NightHistoryEntry): string {
  if (!entry.answeredAt) {
    return "No answer";
  }

  const parts = [
    entry.reasonCode && entry.reasonCode !== "OTHER" ? reasonLabel(entry.reasonCode) : null,
    entry.note,
    entry.source === "WARDEN_OVERRIDE" ? "Set by hostel staff" : null,
    entry.changes > 1 ? `Changed ${entry.changes} times` : null,
  ];

  return parts.filter(Boolean).join(" · ");
}
