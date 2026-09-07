import type { Types } from "mongoose";

import { createInAppNotification } from "@/modules/notifications/notification.service";
import { resolveHostelStaffUserIds } from "@/modules/residents/resident-notify";

/**
 * Telling a hostel that somebody has reviewed it.
 *
 * A review is the one thing a resident writes that is read by strangers. It
 * moves the hostel's public average, it sits on the listing page, and until now
 * the hostel found out about it by opening the reports screen — which means the
 * one-star review posted on a Friday is answered on Monday, in public, after
 * everyone considering that hostel over the weekend has already read it.
 *
 * Only the hostel is told, not the platform desk. A moderation queue that
 * pushes on every review across every hostel is a queue people turn off.
 */

type ReviewLike = {
  _id: Types.ObjectId;
  comment?: string;
  hostelId: Types.ObjectId;
  overallRating: number;
};

/**
 * A poor review is raised to HIGH.
 *
 * Not because it matters more, but because it is the one with a deadline: a
 * complaint made in public is answerable while it is fresh and awkward
 * afterwards. Three stars and up rides at normal priority and is subject to
 * quiet hours like everything else.
 */
function priorityFor(rating: number) {
  return rating <= 2 ? ("HIGH" as const) : ("NORMAL" as const);
}

function stars(rating: number) {
  const whole = Math.max(1, Math.min(5, Math.round(rating)));

  return `${"★".repeat(whole)}${"☆".repeat(5 - whole)}`;
}

export async function notifyHostelOfReview(input: {
  authorName?: string;
  isUpdate: boolean;
  review: ReviewLike;
}) {
  try {
    const { review } = input;
    const staff = await resolveHostelStaffUserIds(review.hostelId);

    if (staff.length === 0) {
      return;
    }

    const excerpt = review.comment?.trim()
      ? review.comment.trim().length > 160
        ? `${review.comment.trim().slice(0, 157)}…`
        : review.comment.trim()
      : "No written comment.";

    await Promise.all(
      staff.map((userId) =>
        createInAppNotification({
          actionUrl: "/hostel-admin/reports",
          body: `${stars(review.overallRating)} ${review.overallRating.toFixed(1)} — ${excerpt}`,
          category: "REVIEW",
          data: { reviewId: review._id.toString() },
          hostelId: review.hostelId.toString(),
          priority: priorityFor(review.overallRating),
          title: input.isUpdate
            ? `${input.authorName ?? "A resident"} updated their review`
            : `${input.authorName ?? "A resident"} left a review`,
          userId,
        }),
      ),
    );
  } catch {
    // The review is saved and public either way; this is delivery, not record.
  }
}
