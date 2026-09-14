import { nightKey } from "@hostel/shared/night/night-window";

/**
 * A resident's night status, night by night — what they can see about their
 * own record.
 *
 * `NightStatusLog` had been written on every change since the feature shipped
 * and read by nothing. This turns it into one entry per night: the answer that
 * stood at the end of it, how many times it changed, and the nights nobody
 * answered at all, which are part of the record too.
 *
 * Pure, so the grouping and the gap-filling are tested without a database.
 */

export type NightHistoryLog = {
  createdAt: Date;
  nextStatus: string;
  night?: string | null;
  note?: string | null;
  reasonCode?: string | null;
  source?: string | null;
};

export type NightHistoryEntry = {
  /** When the standing answer was given; `null` for a night nobody answered. */
  answeredAt: string | null;
  /** How many times the status was set that night. */
  changes: number;
  /** `YYYY-MM-DD`, the 17:00-to-17:00 night. */
  night: string;
  note: string | null;
  reasonCode: string | null;
  /** `RESIDENT`, `WARDEN_OVERRIDE` or `SOS`; `null` when unanswered. */
  source: string | null;
  status: string;
};

/** The most nights one response carries. */
export const NIGHT_HISTORY_LIMIT = 60;

function previousNight(night: string): string {
  const [year, month, day] = night.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/**
 * One entry per night, newest first, from `tonight` back to the first night
 * with any record — capped at {@link NIGHT_HISTORY_LIMIT}.
 *
 * Nights between two answered ones with no log are `NOT_VERIFIED` rather than
 * missing: "you did not answer on Tuesday" is a fact about the record, and a
 * list that silently skips Tuesday reads as though it was answered. Nights
 * before the first record are not invented — they predate the resident being
 * asked at all.
 *
 * `logs` may arrive in any order; a row written before logs carried `night` is
 * placed by its own timestamp.
 */
export function nightHistory(
  logs: readonly NightHistoryLog[],
  tonight: string,
): NightHistoryEntry[] {
  const byNight = new Map<string, NightHistoryLog[]>();

  for (const log of logs) {
    const night = log.night || nightKey(log.createdAt);
    const list = byNight.get(night) ?? [];

    list.push(log);
    byNight.set(night, list);
  }

  if (byNight.size === 0) {
    return [];
  }

  const earliest = [...byNight.keys()].sort()[0];
  const entries: NightHistoryEntry[] = [];

  for (
    let night = tonight;
    night >= earliest && entries.length < NIGHT_HISTORY_LIMIT;
    night = previousNight(night)
  ) {
    const list = byNight.get(night);

    if (!list) {
      entries.push({
        answeredAt: null,
        changes: 0,
        night,
        note: null,
        reasonCode: null,
        source: null,
        status: "NOT_VERIFIED",
      });
      continue;
    }

    const standing = list.reduce((latest, log) =>
      log.createdAt > latest.createdAt ? log : latest,
    );

    entries.push({
      answeredAt: standing.createdAt.toISOString(),
      changes: list.length,
      night,
      note: standing.note || null,
      reasonCode: standing.reasonCode || null,
      source: standing.source || null,
      status: standing.nextStatus,
    });
  }

  return entries;
}
