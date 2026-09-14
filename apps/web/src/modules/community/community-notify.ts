import type { Types } from "mongoose";

import { resolveHostelCookUserIds } from "@/modules/food/kitchen-notify";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { resolveHostelStaffUserIds } from "@/modules/residents/resident-notify";
import { ResidentModel } from "@hostel/db/models/Resident";

/** How much of the post rides in the push body before it is cut. */
const PREVIEW_CHARS = 110;

/**
 * Everyone who lives or works in a hostel and has an account: owner, admins,
 * wardens, cooks and active residents. De-duplicated, because one person can be
 * on more than one of those lists.
 */
export async function resolveHostelCommunityUserIds(
  hostelId: Types.ObjectId | string,
): Promise<string[]> {
  const [staff, cooks, residents] = await Promise.all([
    resolveHostelStaffUserIds(hostelId),
    resolveHostelCookUserIds(hostelId),
    ResidentModel.find({
      hostelId,
      isDeleted: false,
      status: "ACTIVE",
      userId: { $ne: null },
    })
      .select({ userId: 1 })
      .lean<{ userId?: Types.ObjectId }[]>(),
  ]);

  return [
    ...new Set([
      ...staff,
      ...cooks,
      ...residents
        .map((resident) => resident.userId?.toString())
        .filter((userId): userId is string => Boolean(userId)),
    ]),
  ];
}

export function postPreview(body: string) {
  const text = body.replace(/\s+/g, " ").trim();

  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
}

/**
 * A new post in a hostel's space goes to everyone in that hostel as a bell row
 * and a push — each row carries its own push, so the phone buzzes even with the
 * app closed, and the post id routes the tap to that post's own screen.
 *
 * Public-space posts (authors with no hostel) fan out to nobody: their audience
 * is the whole platform, and a push per post to every account is spam.
 *
 * Never throws — a failed notification must not fail the post.
 */
export async function notifyHostelOfNewPost(input: {
  authorName: string;
  authorUserId: string;
  body: string;
  hostelId: Types.ObjectId | string | null | undefined;
  hostelName?: string | null;
  isAnnouncement?: boolean;
  postId: string;
}) {
  if (!input.hostelId) {
    return;
  }

  try {
    const recipients = (await resolveHostelCommunityUserIds(input.hostelId)).filter(
      (userId) => userId !== input.authorUserId,
    );
    const where = input.hostelName ?? "your hostel";

    await Promise.allSettled(
      recipients.map((userId) =>
        createInAppNotification({
          body: `${input.authorName}: ${postPreview(input.body)}`,
          category: "COMMUNITY",
          data: { postId: input.postId },
          hostelId: input.hostelId?.toString(),
          priority: input.isAnnouncement ? "HIGH" : "NORMAL",
          title: input.isAnnouncement
            ? `Announcement in ${where}`
            : `New post in ${where}`,
          userId,
        }),
      ),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        action: "community_post_notify_failed",
        level: "warn",
        message: error instanceof Error ? error.message : "Unknown error",
        postId: input.postId,
      }),
    );
  }
}
