/**
 * Ordering and labelling a provider's job list.
 *
 * Pure, and separate from `lib/provider-api.ts` because that file imports the
 * axios client and therefore React Native — which Vitest here cannot load.
 *
 * ## Open work first, then the schedule, then urgency
 *
 * The server returns newest-created first, which is the wrong order for
 * somebody standing outside a building deciding what to do next. A closed job
 * is not work; a job scheduled for today outranks one scheduled for Friday
 * however urgent Friday's is, because urgency within a day is a tiebreak and a
 * date is a commitment.
 */

import type { ProviderJob } from "@/lib/provider-api";

export const OPEN_JOB_STATUSES = ["PENDING", "CONTACTED", "SCHEDULED"] as const;

export function isOpenJob(job: ProviderJob): boolean {
  return (OPEN_JOB_STATUSES as readonly string[]).includes(job.status);
}

/** Lower sorts first. */
const PRIORITY_RANK: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function scheduleKey(job: ProviderJob): number {
  const raw = job.scheduledFor ?? job.createdAt;

  if (!raw) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(raw);

  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * Open jobs first, each block sorted by when it is due, urgency breaking ties.
 *
 * Closed jobs keep their newest-first order: they are a record, not a queue,
 * and the one a provider wants to see after finishing a job is the one they
 * just closed.
 */
export function sortProviderJobs(jobs: ProviderJob[]): ProviderJob[] {
  const open: ProviderJob[] = [];
  const closed: ProviderJob[] = [];

  for (const job of jobs) {
    (isOpenJob(job) ? open : closed).push(job);
  }

  open.sort(
    (left, right) =>
      scheduleKey(left) - scheduleKey(right) ||
      (PRIORITY_RANK[left.priority] ?? 9) - (PRIORITY_RANK[right.priority] ?? 9),
  );

  return [...open, ...closed];
}

/**
 * What the provider can do with this job, as the screen should offer it.
 *
 * `CONTACTED` is offered only from `PENDING`: once contact is made, saying so
 * again is not a state change, and a button that no-ops teaches people to
 * distrust the others. `COMPLETED` is offered from every open status.
 */
export function jobActions(job: ProviderJob): {
  canComplete: boolean;
  canContact: boolean;
} {
  return {
    canComplete: isOpenJob(job),
    canContact: job.status === "PENDING",
  };
}

/** The site address a provider actually navigates to. */
export function jobAddress(job: ProviderJob): string {
  return [job.location, job.hostelName, job.hostelArea, job.hostelCity]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

export function openJobCount(jobs: ProviderJob[]): number {
  return jobs.filter(isOpenJob).length;
}
