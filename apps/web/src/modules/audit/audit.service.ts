import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { UserModel } from "@hostel/db/models/User";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

type AuditLogRecord = {
  _id: Types.ObjectId;
  action: string;
  actorId?: Types.ObjectId;
  createdAt?: Date;
  entityId: string;
  entityType: string;
  hostelId?: Types.ObjectId;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
};

type RefRecord = { _id: Types.ObjectId; email?: string; name?: string };

export type PlatformAuditLogQuery = {
  action?: string;
  entityType?: string;
  limit?: number;
};

function serializeAuditLog(
  log: AuditLogRecord,
  actors: Map<string, RefRecord>,
  hostels: Map<string, RefRecord>,
) {
  const actorId = log.actorId ? String(log.actorId) : null;
  const hostelId = log.hostelId ? String(log.hostelId) : null;
  const actor = actorId ? actors.get(actorId) : undefined;
  const hostel = hostelId ? hostels.get(hostelId) : undefined;

  return {
    action: log.action,
    actorId,
    actorLabel: actor?.name || actor?.email || actorId || "Unknown actor",
    createdAt: log.createdAt?.toISOString() ?? null,
    entityId: log.entityId,
    entityType: log.entityType,
    hostelId,
    hostelLabel: hostel?.name ?? null,
    id: String(log._id),
    ipAddress: log.ipAddress ?? null,
    metadata: log.metadata ?? {},
  };
}

/**
 * Read-only audit trail for the platform owner portal (PHASES.md §1.1).
 * Newest first, capped, with actor/hostel names resolved for readability.
 * SUPERADMIN-only — the calling route enforces the principal.
 */
export async function listPlatformAuditLogs(query: PlatformAuditLogQuery = {}) {
  await connectToDatabase();

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const filter: Record<string, unknown> = {};
  if (query.action) {
    filter.action = query.action;
  }
  if (query.entityType) {
    filter.entityType = query.entityType;
  }

  const logs = await AuditLogModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<AuditLogRecord[]>();

  const actorIds = [
    ...new Set(
      logs
        .map((log) => log.actorId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const hostelIds = [
    ...new Set(
      logs
        .map((log) => log.hostelId)
        .filter(Boolean)
        .map(String),
    ),
  ];

  const [actors, hostels] = await Promise.all([
    actorIds.length
      ? UserModel.find({ _id: { $in: actorIds } })
          .select("name email")
          .lean<RefRecord[]>()
      : Promise.resolve([]),
    hostelIds.length
      ? HostelModel.find({ _id: { $in: hostelIds } })
          .select("name")
          .lean<RefRecord[]>()
      : Promise.resolve([]),
  ]);

  const actorMap = new Map(actors.map((actor) => [String(actor._id), actor]));
  const hostelMap = new Map(hostels.map((hostel) => [String(hostel._id), hostel]));

  return {
    logs: logs.map((log) => serializeAuditLog(log, actorMap, hostelMap)),
  };
}
