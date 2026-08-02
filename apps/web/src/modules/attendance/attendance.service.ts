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
import { assertHostelAccess } from "@/lib/tenant";
import { AttendanceAlertModel } from "@hostel/db/models/AttendanceAlert";
import { AttendanceLogModel } from "@hostel/db/models/AttendanceLog";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { ConsentLogModel } from "@hostel/db/models/ConsentLog";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelSettingsModel } from "@hostel/db/models/HostelSettings";
import { ResidentModel } from "@hostel/db/models/Resident";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
  type ResidentRecord,
} from "@/modules/residents/resident-access";
import type {
  attendanceAlertResolveSchema,
  attendanceListQuerySchema,
  attendanceOverrideSchema,
  attendanceSettingsSchema,
  consentSchema,
  locationPingSchema,
} from "@/modules/attendance/attendance.validation";

type LocationPingInput = z.infer<typeof locationPingSchema>;
type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;
type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;
type ConsentInput = z.infer<typeof consentSchema>;
type AttendanceAlertResolveInput = z.infer<typeof attendanceAlertResolveSchema>;

export type AttendanceZone = "INSIDE" | "NEARBY" | "OUTSIDE" | "UNKNOWN";

export type AttendanceConfig = {
  absenceAlertDays: number;
  enabled: boolean;
  insideZoneRadiusMeters: number;
  nearbyZoneRadiusMeters: number;
  pingTimes: string[];
  retentionDays: number;
};

/** Platform-wide ceilings a hostel admin cannot exceed (PHASES.md §4.1). */
export const ATTENDANCE_DEFAULTS: AttendanceConfig = {
  absenceAlertDays: 14,
  enabled: false,
  insideZoneRadiusMeters: 50,
  nearbyZoneRadiusMeters: 200,
  pingTimes: ["06:00", "08:00", "22:00"],
  retentionDays: 600,
};

type AttendanceLogRecord = {
  _id: Types.ObjectId;
  day: Date;
  distanceMeters?: number;
  hostelId: Types.ObjectId;
  overrideReason?: string;
  recordedAt: Date;
  residentId: Types.ObjectId;
  source: "MOBILE_PING" | "MANUAL_OVERRIDE";
  zone: AttendanceZone;
};

export class AttendanceServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "ATTENDANCE_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

/** UTC midnight for a timestamp — the bucket every reading is filed under. */
export function dayKey(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

/** Great-circle distance in metres. */
export function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(deltaLng / 2) ** 2;

  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function zoneForDistance(
  meters: number,
  config: AttendanceConfig,
): AttendanceZone {
  if (meters <= config.insideZoneRadiusMeters) {
    return "INSIDE";
  }

  if (meters <= config.nearbyZoneRadiusMeters) {
    return "NEARBY";
  }

  return "OUTSIDE";
}

export async function getAttendanceConfig(
  hostelId: Types.ObjectId | string,
): Promise<AttendanceConfig> {
  const settings = await HostelSettingsModel.findOne({ hostelId }).lean<{
    attendance?: Partial<AttendanceConfig>;
  } | null>();

  return { ...ATTENDANCE_DEFAULTS, ...(settings?.attendance ?? {}) };
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);

    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new AttendanceServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

function serializeLog(log: AttendanceLogRecord) {
  return {
    day: log.day.toISOString().slice(0, 10),
    distanceMeters: log.distanceMeters,
    id: log._id.toString(),
    overrideReason: log.overrideReason,
    residentId: log.residentId.toString(),
    source: log.source,
    zone: log.zone,
  };
}

/**
 * Has this user opted in to location tracking, and not since withdrawn?
 * Reads the most recent entry rather than any entry — consent is revocable.
 */
export async function hasLocationConsent(userId: string) {
  const latest = await ConsentLogModel.findOne({
    consentType: "LOCATION_TRACKING",
    userId: normalizeObjectId(userId, "user id"),
  })
    .sort({ recordedAt: -1 })
    .lean<{ granted: boolean } | null>();

  return Boolean(latest?.granted);
}

export async function recordConsent(input: ConsentInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await ResidentModel.findOne({
    isDeleted: false,
    userId: normalizeObjectId(principal.userId, "user id"),
  }).lean<{ _id: Types.ObjectId; hostelId: Types.ObjectId } | null>();

  await ConsentLogModel.create({
    consentType: input.consentType,
    granted: input.granted,
    hostelId: resident?.hostelId,
    policyVersion: input.policyVersion,
    residentId: resident?._id,
    source: input.source,
    userId: principal.userId,
  });

  return { consentType: input.consentType, granted: input.granted };
}

/**
 * Mobile background ping (PHASES.md §4.1). Computes the zone and stores only
 * that — the coordinates never leave this function. One reading per resident
 * per day wins: a later ping replaces an earlier one, so a phone that comes
 * back online in the evening corrects the day rather than duplicating it.
 */
export async function recordLocationPing(
  input: LocationPingInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);

  if (!(await hasLocationConsent(principal.userId))) {
    throw new AttendanceServiceError(
      "Location tracking has not been consented to for this account.",
      "LOCATION_CONSENT_REQUIRED",
      403,
    );
  }

  const config = await getAttendanceConfig(resident.hostelId);

  if (!config.enabled) {
    throw new AttendanceServiceError(
      "This hostel has attendance tracking switched off.",
      "ATTENDANCE_DISABLED",
      409,
    );
  }

  const hostel = await HostelModel.findOne({ _id: resident.hostelId })
    .select("location.lat location.lng")
    .lean<{ location?: { lat?: number; lng?: number } } | null>();
  const hostelLat = hostel?.location?.lat;
  const hostelLng = hostel?.location?.lng;

  // No hostel pin means no zone can be derived. UNKNOWN is the honest answer;
  // guessing INSIDE would silently mark attendance nobody verified.
  const meters =
    typeof hostelLat === "number" && typeof hostelLng === "number"
      ? distanceMeters(
          { lat: hostelLat, lng: hostelLng },
          { lat: input.lat, lng: input.lng },
        )
      : null;
  const zone: AttendanceZone =
    meters === null ? "UNKNOWN" : zoneForDistance(meters, config);
  const recordedAt = input.recordedAt ?? new Date();
  const log = (await AttendanceLogModel.findOneAndUpdate(
    { day: dayKey(recordedAt), residentId: resident._id },
    {
      $set: {
        distanceMeters: meters ?? undefined,
        hostelId: resident.hostelId,
        recordedAt,
        source: "MOBILE_PING",
        userId: principal.userId,
        zone,
      },
      $unset: { overriddenBy: "", overrideReason: "" },
    },
    { new: true, upsert: true },
  ).lean<AttendanceLogRecord>()) as AttendanceLogRecord;

  return { attendance: serializeLog(log) };
}

/** A resident's own attendance history — zones and days, never coordinates. */
export async function getResidentAttendance(principal: ApiPrincipal, days = 60) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const since = dayKey(new Date());

  since.setUTCDate(since.getUTCDate() - days);

  const logs = await AttendanceLogModel.find({
    day: { $gte: since },
    residentId: resident._id,
  })
    .sort({ day: -1 })
    .lean<AttendanceLogRecord[]>();

  return {
    attendance: logs.map((log) => ({
      day: log.day.toISOString().slice(0, 10),
      source: log.source,
      zone: log.zone,
    })),
    consentGranted: await hasLocationConsent(principal.userId),
    resident: serializeResidentSummary(resident),
  };
}

/**
 * Admin attendance dashboard: today's live split plus a filtered history.
 * Residents with no reading today count as UNKNOWN rather than vanishing —
 * a phone that is off is exactly what an admin needs to see.
 */
export async function listHostelAttendance(
  query: AttendanceListQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, query.hostelId);
  const today = dayKey(new Date());
  const residents = await ResidentModel.find({
    hostelId,
    isDeleted: false,
    status: "ACTIVE",
  })
    .sort({ firstName: 1, lastName: 1 })
    .lean<ResidentRecord[]>();

  const historyFilter: Record<string, unknown> = { hostelId };

  if (query.residentId) {
    historyFilter.residentId = normalizeObjectId(query.residentId, "resident id");
  }

  if (query.zone) {
    historyFilter.zone = query.zone;
  }

  if (query.from || query.to) {
    historyFilter.day = {
      ...(query.from ? { $gte: dayKey(query.from) } : {}),
      ...(query.to ? { $lte: dayKey(query.to) } : {}),
    };
  }

  const [todayLogs, history] = await Promise.all([
    AttendanceLogModel.find({ day: today, hostelId }).lean<AttendanceLogRecord[]>(),
    AttendanceLogModel.find(historyFilter)
      .sort({ day: -1 })
      .limit(500)
      .lean<AttendanceLogRecord[]>(),
  ]);
  const zoneByResidentId = new Map(
    todayLogs.map((log) => [log.residentId.toString(), log.zone]),
  );
  const rows = residents.map((resident) => ({
    resident: serializeResidentSummary(resident),
    zone: zoneByResidentId.get(resident._id.toString()) ?? ("UNKNOWN" as AttendanceZone),
  }));

  return {
    history: history.map(serializeLog),
    summary: rows.reduce(
      (summary, row) => {
        summary[row.zone] += 1;
        summary.total += 1;

        return summary;
      },
      { INSIDE: 0, NEARBY: 0, OUTSIDE: 0, UNKNOWN: 0, total: 0 },
    ),
    today: rows,
  };
}

/**
 * Manual correction for the phone-was-off case. Requires a reason, writes an
 * AuditLog entry, and marks the row so it is never mistaken for a real reading.
 */
export async function overrideAttendance(
  residentId: string,
  input: AttendanceOverrideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const resident = await ResidentModel.findOne({
    _id: normalizeObjectId(residentId, "resident id"),
    hostelId,
    isDeleted: false,
  }).lean<ResidentRecord | null>();

  if (!resident) {
    throw new AttendanceServiceError(
      "Resident was not found.",
      "RESIDENT_NOT_FOUND",
      404,
    );
  }

  const log = (await AttendanceLogModel.findOneAndUpdate(
    { day: dayKey(input.day), residentId: resident._id },
    {
      $set: {
        hostelId,
        overriddenBy: principal.userId,
        overrideReason: input.reason,
        recordedAt: new Date(),
        source: "MANUAL_OVERRIDE",
        userId: resident.userId,
        zone: input.zone,
      },
      $unset: { distanceMeters: "" },
    },
    { new: true, upsert: true },
  ).lean<AttendanceLogRecord>()) as AttendanceLogRecord;

  await AuditLogModel.create({
    action: "ATTENDANCE_OVERRIDDEN",
    actorId: principal.userId,
    entityId: log._id.toString(),
    entityType: "AttendanceLog",
    hostelId,
    metadata: {
      day: input.day.toISOString().slice(0, 10),
      reason: input.reason,
      residentId: resident._id.toString(),
      zone: input.zone,
    },
  });

  return { attendance: serializeLog(log) };
}

export async function getAttendanceSettings(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, requestedHostelId);

  return { hostelId: hostelId.toString(), settings: await getAttendanceConfig(hostelId) };
}

export async function updateAttendanceSettings(
  input: AttendanceSettingsInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const { hostelId: requestedHostelId, ...settings } = input;
  const hostelId = resolveAdminHostelId(principal, requestedHostelId);
  const current = await getAttendanceConfig(hostelId);
  const next = { ...current, ...settings };

  if (next.nearbyZoneRadiusMeters <= next.insideZoneRadiusMeters) {
    throw new AttendanceServiceError(
      "The nearby radius must be larger than the inside radius.",
      "INVALID_GEOFENCE",
      422,
    );
  }

  // The platform owns the outer bounds; a hostel tunes inside them
  // (ARCHITECTURE.md §5). Enforced here, not just in the form, because the
  // widest geofence and the longest retention are the privacy-relevant knobs.
  const limits = await getOperationsConfig();

  if (next.insideZoneRadiusMeters > limits.maxInsideZoneRadiusMeters) {
    throw new AttendanceServiceError(
      `The inside radius cannot exceed ${limits.maxInsideZoneRadiusMeters} m.`,
      "GEOFENCE_ABOVE_PLATFORM_LIMIT",
      422,
    );
  }

  if (next.nearbyZoneRadiusMeters > limits.maxNearbyZoneRadiusMeters) {
    throw new AttendanceServiceError(
      `The nearby radius cannot exceed ${limits.maxNearbyZoneRadiusMeters} m.`,
      "GEOFENCE_ABOVE_PLATFORM_LIMIT",
      422,
    );
  }

  if (next.retentionDays > limits.maxAttendanceRetentionDays) {
    throw new AttendanceServiceError(
      `Attendance logs cannot be kept longer than ${limits.maxAttendanceRetentionDays} days.`,
      "RETENTION_ABOVE_PLATFORM_LIMIT",
      422,
    );
  }

  await HostelSettingsModel.updateOne(
    { hostelId },
    { $set: { attendance: next, updatedBy: principal.userId } },
    { upsert: true },
  );
  await AuditLogModel.create({
    action: "ATTENDANCE_SETTINGS_UPDATED",
    actorId: principal.userId,
    entityId: hostelId.toString(),
    entityType: "HostelSettings",
    hostelId,
    metadata: { settings },
  });

  return { settings: next };
}

export async function listAttendanceAlerts(
  principal: ApiPrincipal,
  requestedHostelId?: string,
  query: PaginationQuery = { page: 1, pageSize: MAX_PAGE_SIZE },
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, requestedHostelId);
  const { limit, skip } = paginationRange(query);
  const alertTotal = await AttendanceAlertModel.countDocuments({ hostelId });
  const alerts = await AttendanceAlertModel.find({ hostelId })
    .sort({ status: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean<
      Array<{
        _id: Types.ObjectId;
        consecutiveDays: number;
        createdAt?: Date;
        lastSeenAt?: Date;
        residentId: Types.ObjectId;
        resolutionNote?: string;
        status: string;
      }>
    >();
  const residents = await ResidentModel.find({
    _id: { $in: alerts.map((alert) => alert.residentId) },
  }).lean<ResidentRecord[]>();
  const nameByResidentId = new Map(
    residents.map((resident) => [
      resident._id.toString(),
      `${resident.firstName} ${resident.lastName}`.trim(),
    ]),
  );

  return {
    alerts: alerts.map((alert) => ({
      consecutiveDays: alert.consecutiveDays,
      createdAt: alert.createdAt?.toISOString(),
      id: alert._id.toString(),
      lastSeenAt: alert.lastSeenAt?.toISOString().slice(0, 10),
      residentId: alert.residentId.toString(),
      residentName: nameByResidentId.get(alert.residentId.toString()) ?? "Resident",
      resolutionNote: alert.resolutionNote ?? "",
      status: alert.status,
    })),
    pagination: paginationMeta(query, alertTotal),
  };
}

export async function resolveAttendanceAlert(
  alertId: string,
  input: AttendanceAlertResolveInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const alert = await AttendanceAlertModel.findOneAndUpdate(
    { _id: normalizeObjectId(alertId, "alert id"), hostelId, status: "OPEN" },
    {
      $set: {
        resolutionNote: input.note,
        resolvedAt: new Date(),
        resolvedBy: principal.userId,
        status: "RESOLVED",
      },
    },
    { new: true },
  ).lean<{ _id: Types.ObjectId } | null>();

  if (!alert) {
    throw new AttendanceServiceError(
      "Open attendance alert was not found.",
      "ATTENDANCE_ALERT_NOT_FOUND",
      404,
    );
  }

  await AuditLogModel.create({
    action: "ATTENDANCE_ALERT_RESOLVED",
    actorId: principal.userId,
    entityId: alert._id.toString(),
    entityType: "AttendanceAlert",
    hostelId,
    metadata: { note: input.note },
  });

  return { alertId: alert._id.toString(), status: "RESOLVED" as const };
}

/**
 * Resident-initiated erasure of their own location history
 * (PRIVACY_POLICY.md). Deletes immediately rather than queuing a request: the
 * data is coarse zone history the hostel has no operational claim on, and a
 * "request" a resident cannot see the outcome of is not a right.
 */
export async function deleteResidentLocationHistory(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const result = await AttendanceLogModel.deleteMany({ residentId: resident._id });

  await AuditLogModel.create({
    action: "ATTENDANCE_HISTORY_ERASED",
    actorId: principal.userId,
    entityId: resident._id.toString(),
    entityType: "Resident",
    hostelId: resident.hostelId,
    metadata: { deletedCount: result.deletedCount ?? 0 },
  });

  return { deletedCount: result.deletedCount ?? 0 };
}
