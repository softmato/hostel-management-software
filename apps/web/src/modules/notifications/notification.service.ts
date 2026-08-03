import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import {
  MAX_PAGE_SIZE,
  paginationMeta,
  paginationRange,
  type PaginationQuery,
} from "@/lib/pagination";
import { DeviceTokenModel } from "@hostel/db/models/DeviceToken";
import { NotificationModel } from "@hostel/db/models/Notification";
import { normalizeObjectId } from "@/modules/residents/resident-access";
import type { deviceTokenSaveSchema } from "@/modules/notifications/notification.validation";

type DeviceTokenSaveInput = z.infer<typeof deviceTokenSaveSchema>;

type NotificationRecord = {
  _id: Types.ObjectId;
  body: string;
  category: string;
  channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS";
  createdAt?: Date;
  data?: Record<string, unknown>;
  hostelId?: Types.ObjectId;
  readAt?: Date;
  status: "QUEUED" | "SENT" | "FAILED";
  title: string;
  userId: Types.ObjectId;
};

export class NotificationServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "NOTIFICATION_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function serializeNotification(notification: NotificationRecord) {
  return {
    body: notification.body,
    category: notification.category,
    channel: notification.channel,
    createdAt: notification.createdAt?.toISOString(),
    data: notification.data ?? {},
    hostelId: notification.hostelId?.toString(),
    id: notification._id.toString(),
    isRead: Boolean(notification.readAt),
    readAt: notification.readAt?.toISOString(),
    status: notification.status,
    title: notification.title,
    userId: notification.userId.toString(),
  };
}

export async function createInAppNotification(input: {
  body: string;
  category: string;
  createdBy?: string;
  data?: Record<string, unknown>;
  hostelId?: string;
  title: string;
  userId: string;
}) {
  await connectToDatabase();

  return NotificationModel.create({
    body: input.body,
    category: input.category,
    channel: "IN_APP",
    createdBy: input.createdBy,
    data: input.data,
    hostelId: input.hostelId,
    status: "SENT",
    title: input.title,
    userId: input.userId,
  });
}

/**
 * Collapse repeated notifications about the same thing into one row.
 *
 * Anything that can fire many times in a row for a single recipient — reactions
 * on one post, say — would otherwise flood the bell with near-identical rows.
 * Instead the first event writes a notification carrying a `dedupeKey`, and
 * every later event for the same key rewrites that same row's title/body and
 * bumps it back to the top of the feed.
 *
 * Only *unread* rows are reused. Once the author has read "5 people reacted",
 * the next reaction writes a fresh row, so they are told about it rather than
 * having an already-seen notification silently mutate behind them.
 */
export async function createOrUpdateBatchedNotification(input: {
  body: string;
  category: string;
  data?: Record<string, unknown>;
  /** Identifies the thing being batched, e.g. `reaction:<postId>`. */
  dedupeKey: string;
  hostelId?: string;
  title: string;
  userId: string;
}) {
  await connectToDatabase();

  const now = new Date();
  const existing = await NotificationModel.findOneAndUpdate(
    {
      category: input.category,
      "data.dedupeKey": input.dedupeKey,
      readAt: { $exists: false },
      userId: normalizeObjectId(input.userId, "user id"),
    },
    {
      $set: {
        body: input.body,
        createdAt: now,
        data: { ...input.data, dedupeKey: input.dedupeKey },
        title: input.title,
      },
    },
    { new: true },
  );

  if (existing) {
    return existing;
  }

  return createInAppNotification({
    body: input.body,
    category: input.category,
    data: { ...input.data, dedupeKey: input.dedupeKey },
    hostelId: input.hostelId,
    title: input.title,
    userId: input.userId,
  });
}

export async function listNotifications(
  principal: ApiPrincipal,
  query: PaginationQuery = { page: 1, pageSize: MAX_PAGE_SIZE },
) {
  await connectToDatabase();

  const filter = { userId: normalizeObjectId(principal.userId, "user id") };
  const { limit, skip } = paginationRange(query);

  const [notifications, total, unread] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<NotificationRecord[]>(),
    NotificationModel.countDocuments(filter),
    // The bell badge counts every unread notification, not the unread ones on
    // this page.
    NotificationModel.countDocuments({ ...filter, readAt: { $exists: false } }),
  ]);

  return {
    notifications: notifications.map(serializeNotification),
    pagination: paginationMeta(query, total),
    unreadCount: unread,
  };
}

export async function markNotificationRead(
  notificationId: string,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const notification = await NotificationModel.findOneAndUpdate(
    {
      _id: normalizeObjectId(notificationId, "notification id"),
      userId: normalizeObjectId(principal.userId, "user id"),
    },
    { $set: { readAt: new Date(), updatedBy: principal.userId } },
    { new: true },
  ).lean<NotificationRecord | null>();

  if (!notification) {
    throw new NotificationServiceError(
      "Notification was not found.",
      "NOTIFICATION_NOT_FOUND",
      404,
    );
  }

  return {
    notification: serializeNotification(notification),
  };
}

export async function saveDeviceToken(
  input: DeviceTokenSaveInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const token = await DeviceTokenModel.findOneAndUpdate(
    { token: input.token },
    {
      $set: {
        deviceId: input.deviceId,
        lastSeenAt: new Date(),
        platform: input.platform,
        status: "ACTIVE",
        userId: principal.userId,
      },
    },
    { new: true, upsert: true },
  ).lean<{
    _id: Types.ObjectId;
    deviceId?: string;
    lastSeenAt: Date;
    platform: string;
    status: string;
    token: string;
    userId: Types.ObjectId;
  }>();

  if (!token) {
    throw new NotificationServiceError(
      "Device token could not be saved.",
      "DEVICE_TOKEN_SAVE_FAILED",
      500,
    );
  }

  return {
    deviceToken: {
      deviceId: token.deviceId ?? "",
      id: token._id.toString(),
      lastSeenAt: token.lastSeenAt.toISOString(),
      platform: token.platform,
      status: token.status,
      token: token.token,
      userId: token.userId.toString(),
    },
  };
}
