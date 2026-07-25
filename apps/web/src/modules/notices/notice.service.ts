import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { NoticeModel } from "@hostel/db/models/Notice";
import { NoticeReadStatusModel } from "@hostel/db/models/NoticeReadStatus";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
} from "@/modules/residents/resident-access";
import {
  appUrl,
  getHostelName,
  resolveActiveResidentRecipients,
  sendNotificationEmail,
} from "@/modules/residents/resident-notify";
import { residentNewNoticeEmail } from "@hostel/shared/email/templates/resident/new-notice";
import type {
  noticeCreateSchema,
  noticeListQuerySchema,
  noticeUpdateSchema,
} from "@/modules/notices/notice.validation";

type NoticeCreateInput = z.infer<typeof noticeCreateSchema>;
type NoticeUpdateInput = z.infer<typeof noticeUpdateSchema>;
type NoticeListQuery = z.infer<typeof noticeListQuerySchema>;

type NoticeRecord = {
  _id: Types.ObjectId;
  category: string;
  content: string;
  createdAt?: Date;
  expiresAt?: Date;
  hostelId: Types.ObjectId;
  isUrgent: boolean;
  publishedAt?: Date;
  title: string;
  updatedAt?: Date;
};

type NoticeReadStatusRecord = {
  _id: Types.ObjectId;
  noticeId: Types.ObjectId;
  readAt: Date;
  userId: Types.ObjectId;
};

export class NoticeServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "NOTICE_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value, "hostel id"));
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new NoticeServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

function scopedHostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    return { hostelId: resolveAdminHostelId(principal, requestedHostelId) };
  }

  return {
    hostelId: {
      $in: normalizeObjectIds(principal.hostelIds),
    },
  };
}

function definedUpdate(input: Record<string, unknown>, omittedKeys: string[] = []) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && !omittedKeys.includes(key),
    ),
  );
}

function serializeNotice(
  notice: NoticeRecord,
  readStatus?: NoticeReadStatusRecord | null,
) {
  return {
    category: notice.category,
    content: notice.content,
    createdAt: notice.createdAt?.toISOString(),
    expiresAt: notice.expiresAt?.toISOString(),
    hostelId: notice.hostelId.toString(),
    id: notice._id.toString(),
    isRead: Boolean(readStatus),
    isUrgent: notice.isUrgent,
    publishedAt: notice.publishedAt?.toISOString(),
    readAt: readStatus?.readAt.toISOString(),
    title: notice.title,
    updatedAt: notice.updatedAt?.toISOString(),
  };
}

async function auditNoticeAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  noticeId: Types.ObjectId,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: noticeId.toString(),
    entityType: "Notice",
    hostelId,
    metadata,
  });
}

export async function createNotice(input: NoticeCreateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const notice = await NoticeModel.create({
    ...input,
    createdBy: principal.userId,
    hostelId,
    publishedAt: input.publishedAt ?? new Date(),
    updatedBy: principal.userId,
  });

  await auditNoticeAction(principal, hostelId, notice._id, "NOTICE_CREATED");

  const delivery = await broadcastNotice(notice as NoticeRecord);

  return {
    delivery,
    notice: serializeNotice(notice as NoticeRecord),
  };
}

/**
 * Fans a published notice out to the hostel's active residents: an in-app
 * notification always, plus an email when the platform has notice emails
 * enabled (EMAIL_SYSTEM.md). Delivery problems never fail the publish.
 */
async function broadcastNotice(notice: NoticeRecord) {
  try {
    return await deliverNoticeBroadcast(notice);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "notice_broadcast_failed",
        message: error instanceof Error ? error.message : "Unknown broadcast error",
        noticeId: notice._id.toString(),
      }),
    );

    return { emailed: 0, notified: 0 };
  }
}

async function deliverNoticeBroadcast(notice: NoticeRecord) {
  const config = await getOperationsConfig();
  const [hostelName, recipients] = await Promise.all([
    getHostelName(notice.hostelId),
    resolveActiveResidentRecipients(notice.hostelId),
  ]);
  const email = residentNewNoticeEmail({
    body: notice.content,
    category: notice.category,
    hostelName,
    isUrgent: notice.isUrgent,
    noticesUrl: appUrl("/resident/notices"),
    title: notice.title,
  });

  let emailed = 0;

  for (const recipient of recipients) {
    if (recipient.userId) {
      await createInAppNotification({
        body: notice.title,
        category: "NOTICE",
        data: { noticeId: notice._id.toString() },
        hostelId: notice.hostelId.toString(),
        title: notice.isUrgent ? "Urgent notice" : "New notice",
        userId: recipient.userId,
      });
    }

    if (!config.sendNoticeEmails) {
      continue;
    }

    const sent = await sendNotificationEmail({
      action: "resident_new_notice",
      html: email.html,
      subject: email.subject,
      to: recipient.email,
    });

    if (sent) {
      emailed += 1;
    }
  }

  return { emailed, notified: recipients.length };
}

export async function listNotices(query: NoticeListQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.category) {
    filter.category = query.category;
  }

  const notices = await NoticeModel.find(filter)
    .sort({ isUrgent: -1, publishedAt: -1 })
    .limit(100)
    .lean<NoticeRecord[]>();

  return {
    notices: notices.map((notice) => serializeNotice(notice)),
  };
}

export async function updateNotice(
  noticeId: string,
  input: NoticeUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const existingNotice = await NoticeModel.findOne({
    _id: normalizeObjectId(noticeId, "notice id"),
    ...scopedHostelFilter(principal, input.hostelId),
  }).lean<NoticeRecord | null>();

  if (!existingNotice) {
    throw new NoticeServiceError("Notice was not found.", "NOTICE_NOT_FOUND", 404);
  }

  const notice = await NoticeModel.findOneAndUpdate(
    { _id: existingNotice._id },
    {
      $set: {
        ...definedUpdate(input, ["hostelId"]),
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<NoticeRecord | null>();

  if (!notice) {
    throw new NoticeServiceError("Notice was not found.", "NOTICE_NOT_FOUND", 404);
  }

  await auditNoticeAction(
    principal,
    existingNotice.hostelId,
    existingNotice._id,
    "NOTICE_UPDATED",
  );

  return {
    notice: serializeNotice(notice),
  };
}

export async function listNoticesForResident(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const notices = await NoticeModel.find({
    hostelId: resident.hostelId,
    publishedAt: { $lte: new Date() },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  })
    .sort({ isUrgent: -1, publishedAt: -1 })
    .limit(100)
    .lean<NoticeRecord[]>();
  const readStatuses = await NoticeReadStatusModel.find({
    noticeId: { $in: notices.map((notice) => notice._id) },
    userId: normalizeObjectId(principal.userId, "user id"),
  }).lean<NoticeReadStatusRecord[]>();
  const readStatusByNoticeId = new Map(
    readStatuses.map((status) => [status.noticeId.toString(), status]),
  );

  return {
    notices: notices.map((notice) =>
      serializeNotice(notice, readStatusByNoticeId.get(notice._id.toString())),
    ),
    resident: serializeResidentSummary(resident),
  };
}

export async function markNoticeAsRead(noticeId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const notice = await NoticeModel.findOne({
    _id: normalizeObjectId(noticeId, "notice id"),
    hostelId: resident.hostelId,
  }).lean<NoticeRecord | null>();

  if (!notice) {
    throw new NoticeServiceError("Notice was not found.", "NOTICE_NOT_FOUND", 404);
  }

  const readStatus = await NoticeReadStatusModel.findOneAndUpdate(
    {
      noticeId: notice._id,
      userId: normalizeObjectId(principal.userId, "user id"),
    },
    {
      $setOnInsert: {
        readAt: new Date(),
      },
    },
    { new: true, upsert: true },
  ).lean<NoticeReadStatusRecord>();

  return {
    notice: serializeNotice(notice, readStatus),
    resident: serializeResidentSummary(resident),
  };
}
