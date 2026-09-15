import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { NoticeModel } from "@hostel/db/models/Notice";
import { NoticePushModel } from "@hostel/db/models/NoticePush";
import {
  NoticeServiceError,
  publishPushNotice,
  resolveAdminHostelId,
  scopedHostelFilter,
} from "@/modules/notices/notice.service";
import {
  laterFromDelay,
  nextNoticePushRun,
  noticePushExpiry,
  type NoticePushRepeat,
} from "@/modules/notices/notice-push-timing";
import type {
  noticePushCreateSchema,
  noticePushUpdateSchema,
} from "@/modules/notices/notice-push.validation";
import { nepalDateOf } from "@/modules/notifications/platform-push-schedule";
import { normalizeObjectId } from "@/modules/residents/resident-access";

type CreateInput = z.infer<typeof noticePushCreateSchema>;
type UpdateInput = z.infer<typeof noticePushUpdateSchema>;
type Status = "ACTIVE" | "PAUSED" | "DONE" | "DELETED";

type NoticePushRecord = {
  _id: Types.ObjectId;
  body: string;
  createdAt?: Date;
  createdBy: Types.ObjectId;
  hostelId: Types.ObjectId;
  isUrgent: boolean;
  lastNoticeId?: Types.ObjectId;
  lastRunAt?: Date | null;
  nextRunAt: Date | null;
  repeat: NoticePushRepeat;
  runCount?: number;
  seedKey?: string;
  startsOn?: string | null;
  status: Status;
  time?: string | null;
  title: string;
  weekdays?: number[];
};

type TimingInput = Pick<UpdateInput, "date" | "delayMinutes" | "repeat" | "time" | "weekdays">;

/** A repeat whose run was missed by more than this is skipped, not sent late. */
const REPEAT_GRACE_MS = 30 * 60_000;

/**
 * What every hostel starts with. Created the first time someone opens the push
 * notices list, so it appears where the admin can see, edit or delete it.
 * Sunday and Wednesday evening, for a washing round on Monday and Thursday.
 */
const DEFAULT_PUSHES = [
  {
    body: "Please put 2–3 of your clothes in the laundry basket. The laundry attendant will come tomorrow to wash them.",
    repeat: "WEEKLY" as const,
    seedKey: "CLOTHES_WASHING",
    time: "18:00",
    title: "Clothes Washing Notice",
    weekdays: [0, 3],
  },
];

function serializeNoticePush(push: NoticePushRecord) {
  return {
    body: push.body,
    createdAt: push.createdAt ? new Date(push.createdAt).toISOString() : null,
    hostelId: push.hostelId.toString(),
    id: push._id.toString(),
    isDefault: Boolean(push.seedKey),
    isUrgent: push.isUrgent,
    lastRunAt: push.lastRunAt ? new Date(push.lastRunAt).toISOString() : null,
    nextRunAt: push.nextRunAt ? new Date(push.nextRunAt).toISOString() : null,
    repeat: push.repeat,
    runCount: push.runCount ?? 0,
    startsOn: push.startsOn ?? null,
    status: push.status,
    time: push.time ?? null,
    title: push.title,
    weekdays: push.weekdays ?? [],
  };
}

async function audit(
  principal: ApiPrincipal,
  push: Pick<NoticePushRecord, "_id" | "hostelId">,
  action: string,
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: push._id.toString(),
    entityType: "NoticePush",
    hostelId: push.hostelId,
  });
}

async function announceChange(hostelId: Types.ObjectId) {
  await publishResourceChange({
    hostelIds: [hostelId.toString()],
    topics: [REALTIME_TOPIC.NOTICES],
  }).catch(() => undefined);
}

/** The stored timing for an input, falling back to what the push already has. */
function resolveTiming(input: TimingInput, existing: NoticePushRecord | null, now: Date) {
  const repeat = input.repeat ?? existing?.repeat ?? "NOW";

  if (repeat === "NOW") {
    return { repeat, startsOn: null, time: null, weekdays: [] as number[] };
  }

  if (repeat === "LATER") {
    if (input.delayMinutes) {
      return { repeat, ...laterFromDelay(now, input.delayMinutes), weekdays: [] as number[] };
    }

    const startsOn = input.date ?? existing?.startsOn;
    const time = input.time ?? existing?.time;

    if (!startsOn || !time) {
      throw new NoticeServiceError("Pick when it goes out.", "NOTICE_PUSH_TIME_REQUIRED", 422);
    }

    return { repeat, startsOn, time, weekdays: [] as number[] };
  }

  const time = input.time ?? existing?.time;

  if (!time) {
    throw new NoticeServiceError("Pick a time.", "NOTICE_PUSH_TIME_REQUIRED", 422);
  }

  const weekdays =
    repeat === "WEEKLY"
      ? [...new Set(input.weekdays ?? existing?.weekdays ?? [])].sort((a, b) => a - b)
      : [];

  if (repeat === "WEEKLY" && weekdays.length === 0) {
    throw new NoticeServiceError("Pick at least one day.", "NOTICE_PUSH_DAYS_REQUIRED", 422);
  }

  return { repeat, startsOn: nepalDateOf(now), time, weekdays };
}

/** A minute of slack, so "today at the current minute" is not refused. */
function firstRun(timing: ReturnType<typeof resolveTiming>, now: Date) {
  return nextNoticePushRun(timing, new Date(now.getTime() - 60_000));
}

async function seedDefaults(hostelIds: Types.ObjectId[], actorId: string) {
  const now = new Date();

  await Promise.all(
    hostelIds.flatMap((hostelId) =>
      DEFAULT_PUSHES.map((seed) =>
        NoticePushModel.updateOne(
          { hostelId, seedKey: seed.seedKey },
          {
            $setOnInsert: {
              ...seed,
              createdBy: actorId,
              hostelId,
              isUrgent: false,
              nextRunAt: firstRun({ ...seed, startsOn: nepalDateOf(now) }, now),
              startsOn: nepalDateOf(now),
              status: "ACTIVE",
            },
          },
          { upsert: true },
          // Two first opens at once race on the unique index; the loser is fine.
        ).catch(() => undefined),
      ),
    ),
  );
}

async function findScoped(id: string, principal: ApiPrincipal, hostelId?: string) {
  const push = await NoticePushModel.findOne({
    _id: normalizeObjectId(id, "push notice id"),
    ...scopedHostelFilter(principal, hostelId),
    status: { $ne: "DELETED" },
  }).lean<NoticePushRecord | null>();

  if (!push) {
    throw new NoticeServiceError("Push notice was not found.", "NOTICE_PUSH_NOT_FOUND", 404);
  }

  return push;
}

/**
 * One send: a fresh residents' notice plus its push. The copy the last send put
 * on the board is expired first, so a repeat never stacks old copies.
 */
async function emitNoticePush(push: NoticePushRecord, actorId: string, now = new Date()) {
  if (push.lastNoticeId) {
    await NoticeModel.updateOne(
      {
        _id: push.lastNoticeId,
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { $set: { expiresAt: now } },
    );
  }

  const { delivery, noticeId } = await publishPushNotice({
    actorId,
    body: push.body,
    expiresAt: noticePushExpiry(push, now),
    hostelId: push.hostelId,
    isUrgent: push.isUrgent,
    title: push.title,
  });
  const updated = await NoticePushModel.findByIdAndUpdate(
    push._id,
    { $inc: { runCount: 1 }, $set: { lastNoticeId: noticeId, lastRunAt: now } },
    { new: true },
  ).lean<NoticePushRecord | null>();

  return { delivery, push: updated ?? push };
}

export async function listNoticePushes(principal: ApiPrincipal, hostelId?: string) {
  await connectToDatabase();

  const hostelIds = hostelId
    ? [resolveAdminHostelId(principal, hostelId)]
    : principal.hostelIds.map((value) => normalizeObjectId(value, "hostel id"));

  await seedDefaults(hostelIds, principal.userId);

  const pushes = await NoticePushModel.find({
    ...scopedHostelFilter(principal, hostelId),
    status: { $ne: "DELETED" },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<NoticePushRecord[]>();

  return { pushes: pushes.map(serializeNoticePush) };
}

export async function createNoticePush(input: CreateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const now = new Date();
  const timing = resolveTiming(input, null, now);
  const nextRunAt = firstRun(timing, now);

  if (timing.repeat !== "NOW" && !nextRunAt) {
    throw new NoticeServiceError("Pick a time in the future.", "NOTICE_PUSH_NEVER_RUNS", 422);
  }

  const created = await NoticePushModel.create({
    ...timing,
    body: input.body,
    createdBy: principal.userId,
    hostelId,
    isUrgent: input.isUrgent ?? false,
    nextRunAt,
    status: timing.repeat === "NOW" ? "DONE" : "ACTIVE",
    title: input.title,
    updatedBy: principal.userId,
  });
  let push = created.toObject() as NoticePushRecord;

  await audit(principal, push, "NOTICE_PUSH_CREATED");

  if (timing.repeat === "NOW") {
    push = (await emitNoticePush(push, principal.userId, now)).push;
  } else {
    await announceChange(hostelId);
  }

  return { push: serializeNoticePush(push) };
}

export async function updateNoticePush(id: string, input: UpdateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const existing = await findScoped(id, principal, input.hostelId);
  const now = new Date();
  const timing = resolveTiming(input, existing, now);
  const nextRunAt = firstRun(timing, now);
  const timingTouched =
    input.repeat !== undefined ||
    input.delayMinutes !== undefined ||
    input.date !== undefined ||
    input.time !== undefined ||
    input.weekdays !== undefined;
  const paused = input.active === undefined ? existing.status === "PAUSED" : !input.active;

  let status: Status;

  if (timing.repeat === "NOW") {
    status = "DONE";
  } else if (paused) {
    status = "PAUSED";
  } else if (nextRunAt) {
    status = "ACTIVE";
  } else if (timingTouched || (input.active === true && existing.status === "PAUSED")) {
    throw new NoticeServiceError("Pick a time in the future.", "NOTICE_PUSH_NEVER_RUNS", 422);
  } else {
    status = "DONE";
  }

  const set: Record<string, unknown> = {
    ...timing,
    nextRunAt: status === "ACTIVE" ? nextRunAt : null,
    status,
    updatedBy: principal.userId,
  };

  for (const key of ["title", "body", "isUrgent"] as const) {
    if (input[key] !== undefined) {
      set[key] = input[key];
    }
  }

  const push = await NoticePushModel.findByIdAndUpdate(
    existing._id,
    { $set: set },
    { new: true },
  ).lean<NoticePushRecord | null>();

  await audit(principal, existing, "NOTICE_PUSH_UPDATED");
  await announceChange(existing.hostelId);

  return { push: serializeNoticePush(push ?? existing) };
}

export async function deleteNoticePush(id: string, principal: ApiPrincipal, hostelId?: string) {
  await connectToDatabase();

  const existing = await findScoped(id, principal, hostelId);

  await NoticePushModel.updateOne(
    { _id: existing._id },
    { $set: { nextRunAt: null, status: "DELETED", updatedBy: principal.userId } },
  );
  await audit(principal, existing, "NOTICE_PUSH_DELETED");
  await announceChange(existing.hostelId);

  return { id: existing._id.toString() };
}

/** Sends it right now, whatever its schedule says; the schedule is untouched. */
export async function sendNoticePushNow(id: string, principal: ApiPrincipal, hostelId?: string) {
  await connectToDatabase();

  const existing = await findScoped(id, principal, hostelId);
  const { delivery, push } = await emitNoticePush(existing, principal.userId);

  await audit(principal, existing, "NOTICE_PUSH_SENT");

  return { delivery, push: serializeNoticePush(push) };
}

/**
 * Cron: sends every push notice whose `nextRunAt` has passed. The claim is the
 * advance — `nextRunAt` moves on with a filter on its old value, so the
 * every-minute job and the 15-minute fallback cannot both send one run.
 */
export async function dispatchDueNoticePushes(now = new Date()) {
  await connectToDatabase();

  const due = await NoticePushModel.find({ nextRunAt: { $lte: now }, status: "ACTIVE" })
    .sort({ nextRunAt: 1 })
    .limit(50)
    .lean<NoticePushRecord[]>();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const push of due) {
    const following = push.repeat === "LATER" ? null : nextNoticePushRun(push, now);
    const stale =
      push.repeat !== "LATER" &&
      now.getTime() - (push.nextRunAt as Date).getTime() > REPEAT_GRACE_MS;
    const claimed = await NoticePushModel.findOneAndUpdate(
      { _id: push._id, nextRunAt: push.nextRunAt, status: "ACTIVE" },
      { $set: { nextRunAt: following, status: following ? "ACTIVE" : "DONE" } },
      { new: true },
    ).lean<NoticePushRecord | null>();

    if (!claimed) {
      continue;
    }

    if (stale) {
      skipped += 1;
      continue;
    }

    try {
      await emitNoticePush(claimed, push.createdBy.toString(), now);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("[notice-push] scheduled send failed", push._id.toString(), error);
    }
  }

  return { due: due.length, failed, sent, skipped };
}
