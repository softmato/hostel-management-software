/**
 * Reviewing your hostel.
 *
 * Pure, so it can be tested. Field set, labels and order come from
 * `apps/web/src/app/_components/resident-reviews-page.tsx`; the rules come from
 * `review.validation.ts` and `createResidentReview`.
 *
 * ## Two things the server does not let a resident do
 *
 * 1. **Read their own review back.** `createResidentReview` is the only
 *    resident-facing function in `review.service.ts` — there is no
 *    `GET /resident/reviews`, and the public list strips `residentId`, so a review
 *    cannot be matched to its author from the client either. The form therefore
 *    always starts empty, exactly as the web's does.
 * 2. **Clear a rating.** The POST is a `findOneAndUpdate` with `$set: { ...input }`
 *    and `upsert`, so it is **one review per resident, merged**. A category the
 *    client omits is not cleared — `$set` never touches an absent key — and the
 *    schema has no `null` to send instead. So a 4 given to food last month
 *    survives a resubmission that leaves food blank.
 *
 * Together those two mean a resubmission is a *merge into something invisible*,
 * which is worth one plain sentence on the screen rather than a surprise.
 * {@link REVIEW_MERGE_NOTICE} is that sentence. Both are §1 rows in
 * `docs/MOBILE_APP_PHASES.md`.
 */

import type { ResidentSummary } from "@/lib/resident-api";

/** `starRating` in `review.validation.ts`: `z.number().int().min(1).max(5)`. */
export const MAX_STARS = 5;

/** `reviewCreateSchema`'s cap on `comment`. */
export const MAX_COMMENT = 3000;

/**
 * The six optional categories, in the web's order and with **its labels** —
 * note that `safetyRating` is presented as "Security" there, and renaming it here
 * would make the same field read as two different questions across the two
 * clients.
 */
export const REVIEW_CATEGORIES = [
  { key: "foodRating", label: "Food" },
  { key: "cleanlinessRating", label: "Cleanliness" },
  { key: "safetyRating", label: "Security" },
  { key: "roomRating", label: "Room" },
  { key: "locationRating", label: "Location" },
  { key: "managementRating", label: "Management" },
] as const;

export type ReviewCategoryKey = (typeof REVIEW_CATEGORIES)[number]["key"];

/**
 * The form's state. `0` means "not scored" — the absence the payload expresses by
 * omitting the key, kept as a number here because a star row has to render
 * something and `undefined` in a controlled value is how a field goes
 * uncontrolled.
 */
export type ReviewDraft = Record<ReviewCategoryKey, number> & {
  comment: string;
  overallRating: number;
};

export type ReviewErrors = Partial<Record<"comment" | "overallRating", string>>;

export function emptyReviewDraft(): ReviewDraft {
  return {
    cleanlinessRating: 0,
    comment: "",
    foodRating: 0,
    locationRating: 0,
    managementRating: 0,
    overallRating: 0,
    roomRating: 0,
    safetyRating: 0,
  };
}

export function validateReview(draft: ReviewDraft): ReviewErrors {
  const errors: ReviewErrors = {};

  if (draft.overallRating < 1 || draft.overallRating > MAX_STARS) {
    errors.overallRating = "Give your hostel an overall score.";
  }

  if (draft.comment.trim().length > MAX_COMMENT) {
    errors.comment = `Keep this under ${MAX_COMMENT} characters.`;
  }

  return errors;
}

export function hasReviewErrors(errors: ReviewErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The POST body. Unscored categories and a blank comment are omitted, not zeroed. */
export function toReviewInput(draft: ReviewDraft) {
  const input: Record<string, number | string> = {
    overallRating: draft.overallRating,
  };

  for (const { key } of REVIEW_CATEGORIES) {
    if (draft[key] >= 1) {
      input[key] = draft[key];
    }
  }

  const comment = draft.comment.trim();

  if (comment) {
    input.comment = comment;
  }

  return input;
}

/**
 * How many of the six optional categories were scored. Drives the "5 of 6" hint,
 * because a resident who scored one category should be able to see that at a
 * glance rather than by counting stars.
 */
export function scoredCategoryCount(draft: ReviewDraft): number {
  return REVIEW_CATEGORIES.filter(({ key }) => draft[key] >= 1).length;
}

/* -------------------------------------------------------------------------- */
/* Who is allowed to review                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `createResidentReview` 403s with `REVIEW_NOT_ALLOWED` for any other status, so
 * this decides whether the form is drawn at all. Letting a `PENDING` resident fill
 * in seven ratings and a comment before telling them is the worse outcome.
 */
const REVIEWABLE_STATUSES = ["ACTIVE", "MOVED_OUT"] as const;

export function canReview(status: ResidentSummary["status"] | string): boolean {
  return (REVIEWABLE_STATUSES as readonly string[]).includes(status);
}

/** Why they cannot, in their terms rather than the enum's. */
export function reviewGateReason(status: ResidentSummary["status"] | string): string {
  if (status === "PENDING") {
    return "Your hostel has not activated your stay yet. Once they do, you can review it.";
  }

  if (status === "SUSPENDED") {
    return "Your account is suspended, so reviews are closed. Your hostel's office can explain why.";
  }

  return "Only current and past residents of a hostel can review it.";
}

/**
 * Said once, above the form.
 *
 * It covers both server behaviours at the same time: the review cannot be read
 * back, and a resubmission merges rather than replaces. Without it, a resident who
 * rescores one category has no way to know the other five kept last month's
 * numbers.
 */
export const REVIEW_MERGE_NOTICE =
  "You get one review per hostel, and sending this replaces what you scored before. Anything you leave blank keeps its earlier score — it cannot be cleared from here.";
