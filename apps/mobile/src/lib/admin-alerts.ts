/**
 * The four unprompted things, merged into one ranked inbox.
 *
 * ## Why one feed rather than four lists
 *
 * An admin opening their phone does not want to audit four queues; they want to
 * know whether anything needs them right now. Four separate cards make that a
 * scanning exercise and, worse, give an active SOS the same visual weight as a
 * three-day-old inquiry because each is top of its own list.
 *
 * So the four sources are normalised to a single row shape and ranked. The
 * ordering is by *consequence of ignoring it*, not by recency:
 *
 *  1. **SOS** — someone pressed a panic button and nobody has acknowledged it.
 *  2. **Overdue complaint** — already past its SLA; every hour adds a breach.
 *  3. **Payment claim** — a resident's money is in limbo and their invoice
 *     still reads unpaid to them.
 *  4. **Inquiry** — revenue, and it will wait an hour.
 *
 * Within a tier, oldest first: the thing that has been waiting longest is the
 * thing most likely to have been forgotten. That is the opposite of the
 * newest-first order every one of these endpoints returns, which is correct for
 * a desk queue you work top-down and wrong for a triage list.
 *
 * Pure and free of the axios client on purpose, so it can be tested node-side.
 */

import type {
  AdminClaim,
  AdminComplaint,
  AdminInquiry,
  AdminSosAlert,
} from "@/lib/admin-api";

export type AlertKind = "claim" | "complaint" | "inquiry" | "sos";

export type AlertRow = {
  /** ISO timestamp, or null when the source did not carry one. */
  at: string | null;
  /** The id the action route needs — event id, complaint id, alert id. */
  id: string;
  kind: AlertKind;
  subtitle: string;
  title: string;
};

/** Lower sorts first. */
const TIER: Record<AlertKind, number> = {
  sos: 0,
  complaint: 1,
  claim: 2,
  inquiry: 3,
};

function ageKey(at: string | null): number {
  if (!at) {
    // No timestamp sorts oldest. A row with no date is nearly always a record
    // written before the field existed, and burying it forever is how it stays
    // unhandled.
    return 0;
  }

  const parsed = Date.parse(at);

  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildAlertFeed(sources: {
  claims: AdminClaim[];
  complaints: AdminComplaint[];
  inquiries: AdminInquiry[];
  sos: AdminSosAlert[];
}): AlertRow[] {
  const rows: AlertRow[] = [
    ...sources.sos.map((alert) => ({
      at: alert.createdAt ?? null,
      id: alert.id,
      kind: "sos" as const,
      subtitle: alert.message || "No message was left.",
      title: "SOS triggered",
    })),
    ...sources.complaints.map((complaint) => ({
      at: complaint.createdAt ?? null,
      id: complaint.id,
      kind: "complaint" as const,
      subtitle: complaint.isAnonymous
        ? "Anonymous · past its SLA"
        : `${complaint.category} · past its SLA`,
      title: complaint.title,
    })),
    ...sources.claims.map((claim) => ({
      at: claim.occurredAt ?? null,
      id: claim.eventId,
      kind: "claim" as const,
      subtitle: [claim.residentName || "A resident", claim.method, claim.period]
        .filter(Boolean)
        .join(" · "),
      title: `Claimed payment`,
    })),
    ...sources.inquiries.map((inquiry) => ({
      at: inquiry.createdAt ?? null,
      id: inquiry.id,
      kind: "inquiry" as const,
      subtitle: [inquiry.phone, inquiry.preferredRoomType].filter(Boolean).join(" · "),
      title: inquiry.name || "New inquiry",
    })),
  ];

  return rows.sort(
    (left, right) => TIER[left.kind] - TIER[right.kind] || ageKey(left.at) - ageKey(right.at),
  );
}

/**
 * How many rows need someone, by tier — for the badge on the tab and the line
 * under the dashboard's headline.
 */
export function alertCounts(rows: AlertRow[]): Record<AlertKind, number> {
  const counts: Record<AlertKind, number> = { claim: 0, complaint: 0, inquiry: 0, sos: 0 };

  for (const row of rows) {
    counts[row.kind] += 1;
  }

  return counts;
}

/**
 * Occupancy as a percentage of beds filled, or null when the hostel has not
 * recorded a capacity.
 *
 * Null rather than 0: a hostel that has not configured its rooms is not empty,
 * and a dashboard that says "0% occupied" to an admin with forty residents is
 * the kind of number that gets the whole screen distrusted.
 */
export function occupancyRate(input: {
  residents: number;
  vacantBeds: number;
}): number | null {
  const totalBeds = input.residents + input.vacantBeds;

  if (totalBeds <= 0) {
    return null;
  }

  return Math.round((input.residents / totalBeds) * 100);
}
