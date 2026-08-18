/**
 * Reviews — `POST /resident/reviews`.
 *
 * Typed off `serializeReview` and `reviewCreateSchema`. There is deliberately no
 * getter here because there is no endpoint: `createResidentReview` is the only
 * resident-facing function in `review.service.ts`, and the public list
 * (`serializePublicReview`) strips `residentId`, so a review cannot be matched back
 * to its author from a client either. See `lib/reviews.ts` for what that costs the
 * screen.
 *
 * ## It is an upsert, and a merging one
 *
 * One review per resident per hostel. The service runs `findOneAndUpdate` with
 * `$set: { ...input }` and `upsert: true`, so a resubmission **merges** into the
 * existing row: a category the payload omits keeps whatever it held, since `$set`
 * never touches an absent key and the schema has no `null` to send. Resubmitting
 * also `$unset`s `hiddenAt`/`hiddenBy` and forces `status: "VISIBLE"`, so editing a
 * review a platform moderator hid puts it back on display.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { ResidentSummary } from "@/lib/resident-api";

export type ResidentReview = {
  cleanlinessRating?: number;
  comment: string;
  createdAt?: string;
  foodRating?: number;
  hiddenAt?: string;
  hiddenBy?: string;
  hostelId: string;
  id: string;
  locationRating?: number;
  managementRating?: number;
  overallRating: number;
  residentId: string;
  roomRating?: number;
  safetyRating?: number;
  status: "HIDDEN" | "VISIBLE";
  updatedAt?: string;
  userId: string;
};

/**
 * **201**, and it 403s with `REVIEW_NOT_ALLOWED` unless the resident's status is
 * `ACTIVE` or `MOVED_OUT` — check `canReview` before drawing the form.
 *
 * Omit a category rather than sending `0`: `starRating` is `min(1)`, so a zero
 * fails the whole submission.
 */
export async function submitResidentReview(input: Record<string, number | string>) {
  const response = await api.post<
    ApiEnvelope<{ resident: ResidentSummary; review: ResidentReview }>
  >("/resident/reviews", input);

  return unwrap(response).review;
}
