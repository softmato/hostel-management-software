import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { NotificationModel } from "@hostel/db/models/Notification";
import { UserModel } from "@hostel/db/models/User";
import { Role } from "@/lib/roles";
import type {
  PLATFORM_PUSH_AUDIENCES,
  platformPushSchema,
} from "@/modules/notifications/notification.validation";
import { sendPushToUsers } from "@/modules/notifications/push.service";

type PlatformPushInput = z.infer<typeof platformPushSchema>;
type PlatformPushAudience = (typeof PLATFORM_PUSH_AUDIENCES)[number];

const ACTION = "PLATFORM_PUSH_SENT";
const ENTITY_TYPE = "PlatformPush";

/**
 * Not `ANNOUNCEMENT`: that category deep-links into the resident notices tab,
 * which a hostel admin or guardian cannot open. An unknown category lands on
 * each app's own notifications screen, where the bell row below is waiting.
 */
const CATEGORY = "PLATFORM";

/** `null` is every active account, platform staff included — so the sender's own phone proves it went. */
const AUDIENCE_ROLES: Record<PlatformPushAudience, Role[] | null> = {
  EVERYONE: null,
  GUARDIANS: [Role.GUARDIAN],
  HOSTEL_STAFF: [Role.HOSTEL_ADMIN, Role.WARDEN, Role.COOK],
  RESIDENTS: [Role.RESIDENT],
};

type PushLogRecord = {
  _id: Types.ObjectId;
  createdAt: Date;
  metadata?: {
    audience?: PlatformPushAudience;
    body?: string;
    devices?: number;
    recipients?: number;
    title?: string;
    urgency?: "NORMAL" | "URGENT";
  };
};

/**
 * Sends one push to every device of the chosen audience — phones through Expo,
 * browsers through Web Push, in the single `sendPushToUsers` fan-out.
 *
 * A bell row is written per recipient first, so the tap has something to open
 * and a phone that was off still finds it later. No socket broadcast: the push
 * banner is the interruption, and a socket toast on top of it would chime twice.
 *
 * Awaited rather than fired off, so the page can report how many devices took
 * it — a superadmin pressing Send wants that number, not "queued".
 */
export async function sendPlatformPush(input: PlatformPushInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const roles = AUDIENCE_ROLES[input.audience];
  const filter: Record<string, unknown> = { isDeleted: { $ne: true }, status: "ACTIVE" };

  if (roles) {
    filter.role = { $in: roles };
  }

  const users = await UserModel.find(filter)
    .select("_id")
    .lean<Array<{ _id: Types.ObjectId }>>();
  const userIds = users.map((user) => user._id.toString());
  const now = new Date();

  if (userIds.length > 0) {
    await NotificationModel.insertMany(
      userIds.map((userId) => ({
        body: input.body,
        category: CATEGORY,
        channel: "IN_APP",
        deliveredAt: now,
        priority: input.urgency,
        status: "SENT",
        title: input.title,
        userId,
      })),
      { ordered: false },
    );
  }

  const result =
    userIds.length > 0
      ? await sendPushToUsers(userIds, {
          body: input.body,
          category: CATEGORY,
          priority: input.urgency,
          title: input.title,
        })
      : { revoked: 0, sent: 0, skipped: true };

  const log = await AuditLogModel.create({
    action: ACTION,
    actorId: principal.userId,
    entityId: new Types.ObjectId().toString(),
    entityType: ENTITY_TYPE,
    metadata: {
      audience: input.audience,
      body: input.body,
      devices: result.sent,
      recipients: userIds.length,
      title: input.title,
      urgency: input.urgency,
    },
  });

  return {
    push: serializePush({
      _id: log._id as Types.ObjectId,
      createdAt: now,
      metadata: log.metadata as PushLogRecord["metadata"],
    }),
  };
}

export async function listPlatformPushes() {
  await connectToDatabase();

  const logs = await AuditLogModel.find({ action: ACTION })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean<PushLogRecord[]>();

  return { pushes: logs.map(serializePush) };
}

function serializePush(log: PushLogRecord) {
  return {
    audience: log.metadata?.audience ?? "EVERYONE",
    body: log.metadata?.body ?? "",
    devices: log.metadata?.devices ?? 0,
    id: log._id.toString(),
    recipients: log.metadata?.recipients ?? 0,
    sentAt: new Date(log.createdAt).toISOString(),
    title: log.metadata?.title ?? "",
    urgency: log.metadata?.urgency ?? "NORMAL",
  };
}
