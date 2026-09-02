/**
 * The lead queue's arithmetic — which segment a lead is in, and what happens
 * next to it.
 *
 * Pure and free of the axios client so it can be tested node-side, same as
 * `admin-alerts.ts`. The screen is `app/manage/inquiries.tsx`.
 *
 * ## Three segments over five statuses
 *
 * The server's ladder is `NEW → CONTACTED → VISIT_SCHEDULED → CONVERTED /
 * CLOSED`. Five is `<Segmented>`'s hard cap and every label would be a word the
 * hostel does not use, so the screen groups them into the three questions
 * somebody actually opens this screen with:
 *
 * - **New** — nobody has answered these. This is the count on Home.
 * - **Working** — somebody rang, or a visit is booked.
 * - **Done** — they took a bed, or the conversation ended.
 *
 * The five statuses are still what is written; the grouping is only how the
 * list is divided. A lead's own pill says which of the five it is, so nothing
 * about the ladder is hidden by the grouping.
 */

import type { InquiryStatus, ManagedInquiry } from "@/lib/admin-manage-api";

export type InquiryBucket = "done" | "new" | "working";

const BUCKETS: Record<InquiryStatus, InquiryBucket> = {
  CLOSED: "done",
  CONTACTED: "working",
  CONVERTED: "done",
  NEW: "new",
  VISIT_SCHEDULED: "working",
};

export function inquiryBucket(status: string): InquiryBucket {
  // Unknown falls into `new` rather than `done`: a status this build has not
  // heard of is a lead nobody here has decided about, and burying it under the
  // segment people stop opening is how it is never answered.
  return BUCKETS[status as InquiryStatus] ?? "new";
}

/**
 * The list under a segment, newest first.
 *
 * Newest first, unlike the alert feed's oldest-first triage order — this is a
 * desk queue somebody works top-down while the conversation is still warm, and
 * a lead that came in an hour ago is the one most likely to answer the phone.
 */
export function inquiriesIn(
  inquiries: ManagedInquiry[],
  bucket: InquiryBucket,
): ManagedInquiry[] {
  return inquiries
    .filter((inquiry) => inquiryBucket(inquiry.status) === bucket)
    .sort((left, right) => ageKey(right.createdAt) - ageKey(left.createdAt));
}

function ageKey(at: string | undefined): number {
  if (!at) {
    return 0;
  }

  const parsed = Date.parse(at);

  return Number.isNaN(parsed) ? 0 : parsed;
}

/** How many leads sit in each segment, for the counts on the control. */
export function inquiryCounts(
  inquiries: ManagedInquiry[],
): Record<InquiryBucket, number> {
  const counts: Record<InquiryBucket, number> = { done: 0, new: 0, working: 0 };

  for (const inquiry of inquiries) {
    counts[inquiryBucket(inquiry.status)] += 1;
  }

  return counts;
}

/**
 * What the two buttons on a card do, given where the lead currently is.
 *
 * ## Why this is a function and not two fixed buttons
 *
 * "Mark read" on a lead somebody already rang is a button that changes nothing,
 * and "Solved" on a closed one is worse — it looks like an action and is a
 * no-op, which is how people stop trusting the row. So the card asks what is
 * left to do and draws only that.
 *
 * `CONTACTED` is what "mark read" writes. There is no separate read flag on an
 * inquiry, and inventing one client-side would be a state the web portal cannot
 * see: what the hostel means by "I have seen this" is that somebody has picked
 * it up, which is exactly what `CONTACTED` records.
 */
export type InquiryAction = { label: string; status: InquiryStatus };

export function inquiryActions(status: string): InquiryAction[] {
  const bucket = inquiryBucket(status);

  if (bucket === "done") {
    // Only the way back. A closed lead that rings again is a real case, and
    // reopening it is better than registering a second copy of the same person.
    return [{ label: "Reopen", status: "CONTACTED" }];
  }

  if (bucket === "new") {
    return [
      { label: "Mark read", status: "CONTACTED" },
      { label: "Close", status: "CLOSED" },
    ];
  }

  return [
    { label: "Converted", status: "CONVERTED" },
    { label: "Close", status: "CLOSED" },
  ];
}
