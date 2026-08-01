import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { IncidentLogModel } from "@hostel/db/models/IncidentLog";
import { ManualStatusOverrideModel } from "@hostel/db/models/ManualStatusOverride";
import { NightStatusLogModel } from "@hostel/db/models/NightStatusLog";
import { NightStatusModel } from "@hostel/db/models/NightStatus";
import { ResidentModel } from "@hostel/db/models/Resident";
import { SOSAlertModel } from "@hostel/db/models/SOSAlert";
import { fanOutSOSAlert } from "@/modules/safety/safety-notify";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
  type ResidentRecord,
} from "@/modules/residents/resident-access";
import type {
  nightStatusListQuerySchema,
  nightStatusOverrideSchema,
  nightStatusUpdateSchema,
  sosCreateSchema,
  sosListQuerySchema,
  sosStatusUpdateSchema,
} from "@/modules/safety/safety.validation";

type NightStatusUpdateInput = z.infer<typeof nightStatusUpdateSchema>;
type NightStatusListQuery = z.infer<typeof nightStatusListQuerySchema>;
type NightStatusOverrideInput = z.infer<typeof nightStatusOverrideSchema>;
type SOSCreateInput = z.infer<typeof sosCreateSchema>;
type SOSListQuery = z.infer<typeof sosListQuerySchema>;
type SOSStatusUpdateInput = z.infer<typeof sosStatusUpdateSchema>;

type NightStatusValue =
  | "INSIDE_HOSTEL"
  | "OUTSIDE_HOSTEL"
  | "NOT_VERIFIED"
  | "MARKED_SAFE"
  | "SOS_TRIGGERED";

type NightStatusRecord = {
  _id: Types.ObjectId;
  checkedAt: Date;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  note?: string;
  residentId: Types.ObjectId;
  source: "RESIDENT" | "WARDEN_OVERRIDE" | "SOS";
  status: NightStatusValue;
  updatedAt?: Date;
  updatedBy: Types.ObjectId;
};

type SOSStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_ALARM";

type SOSAlertRecord = {
  _id: Types.ObjectId;
  acknowledgedAt?: Date;
  acknowledgedBy?: Types.ObjectId;
  createdAt?: Date;
  guardianAlertEnabled: boolean;
  hostelId: Types.ObjectId;
  message?: string;
  residentId: Types.ObjectId;
  resolvedAt?: Date;
  resolvedBy?: Types.ObjectId;
  status: SOSStatus;
  triggeredBy: Types.ObjectId;
  updatedAt?: Date;
};

type EmergencyContactRecord = {
  _id: Types.ObjectId;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
};

export class SafetyServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "SAFETY_ERROR",
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

  throw new SafetyServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

function scopedHostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    return { hostelId: resolveAdminHostelId(principal, requestedHostelId) };
  }

  return { hostelId: { $in: normalizeObjectIds(principal.hostelIds) } };
}

function serializeNightStatus(status: NightStatusRecord | null) {
  if (!status) {
    return {
      checkedAt: null,
      note: "",
      source: "RESIDENT",
      status: "NOT_VERIFIED",
    };
  }

  return {
    checkedAt: status.checkedAt.toISOString(),
    hostelId: status.hostelId.toString(),
    id: status._id.toString(),
    note: status.note ?? "",
    residentId: status.residentId.toString(),
    source: status.source,
    status: status.status,
    updatedAt: status.updatedAt?.toISOString(),
  };
}

function serializeSOS(alert: SOSAlertRecord) {
  return {
    acknowledgedAt: alert.acknowledgedAt?.toISOString(),
    acknowledgedBy: alert.acknowledgedBy?.toString(),
    createdAt: alert.createdAt?.toISOString(),
    guardianAlertEnabled: alert.guardianAlertEnabled,
    hostelId: alert.hostelId.toString(),
    id: alert._id.toString(),
    message: alert.message ?? "",
    residentId: alert.residentId.toString(),
    resolvedAt: alert.resolvedAt?.toISOString(),
    resolvedBy: alert.resolvedBy?.toString(),
    status: alert.status,
    triggeredBy: alert.triggeredBy.toString(),
    updatedAt: alert.updatedAt?.toISOString(),
  };
}

function serializeEmergencyContact(contact: EmergencyContactRecord) {
  return {
    id: contact._id.toString(),
    isPrimary: contact.isPrimary,
    name: contact.name,
    phone: contact.phone,
    relation: contact.relation,
  };
}

async function auditSafetyAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  entityId: Types.ObjectId,
  entityType: string,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: entityId.toString(),
    entityType,
    hostelId,
    metadata,
  });
}

async function writeNightStatus(
  resident: ResidentRecord,
  principal: ApiPrincipal,
  input: {
    note?: string;
    source: "RESIDENT" | "WARDEN_OVERRIDE" | "SOS";
    status: NightStatusValue;
  },
) {
  const existing = await NightStatusModel.findOne({
    residentId: resident._id,
  }).lean<NightStatusRecord | null>();
  const status = await NightStatusModel.findOneAndUpdate(
    { residentId: resident._id },
    {
      $set: {
        checkedAt: new Date(),
        hostelId: resident.hostelId,
        note: input.note,
        residentId: resident._id,
        source: input.source,
        status: input.status,
        updatedBy: principal.userId,
      },
    },
    { new: true, upsert: true },
  ).lean<NightStatusRecord>();

  await NightStatusLogModel.create({
    changedBy: principal.userId,
    hostelId: resident.hostelId,
    nextStatus: input.status,
    note: input.note,
    previousStatus: existing?.status,
    residentId: resident._id,
    source: input.source,
  });

  return status;
}

async function findAdminResident(
  residentId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const resident = await ResidentModel.findOne({
    _id: normalizeObjectId(residentId, "resident id"),
    isDeleted: false,
    ...scopedHostelFilter(principal, requestedHostelId),
  }).lean<ResidentRecord | null>();

  if (!resident) {
    throw new SafetyServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  return resident;
}

export async function updateResidentNightStatus(
  input: NightStatusUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const status = await writeNightStatus(resident, principal, {
    note: input.note,
    source: "RESIDENT",
    status: input.status,
  });

  return {
    resident: serializeResidentSummary(resident),
    status: serializeNightStatus(status),
  };
}

export async function getResidentNightStatus(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const status = await NightStatusModel.findOne({
    residentId: resident._id,
  }).lean<NightStatusRecord | null>();

  return {
    resident: serializeResidentSummary(resident),
    status: serializeNightStatus(status),
  };
}

export async function listAdminNightStatus(
  query: NightStatusListQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const residentFilter = {
    isDeleted: false,
    ...scopedHostelFilter(principal, query.hostelId),
  };
  const residents = await ResidentModel.find(residentFilter)
    .sort({ firstName: 1, lastName: 1 })
    .limit(200)
    .lean<ResidentRecord[]>();
  const statuses = await NightStatusModel.find({
    residentId: { $in: residents.map((resident) => resident._id) },
    ...(query.status ? { status: query.status } : {}),
  }).lean<NightStatusRecord[]>();
  const statusByResidentId = new Map(
    statuses.map((status) => [status.residentId.toString(), status]),
  );
  const rows = residents
    .map((resident) => ({
      resident: serializeResidentSummary(resident),
      status: serializeNightStatus(
        statusByResidentId.get(resident._id.toString()) ?? null,
      ),
    }))
    .filter((row) => !query.status || row.status.status === query.status);

  return {
    statuses: rows,
    summary: rows.reduce(
      (summary, row) => {
        summary.total += 1;
        summary[row.status.status as NightStatusValue] += 1;
        return summary;
      },
      {
        INSIDE_HOSTEL: 0,
        MARKED_SAFE: 0,
        NOT_VERIFIED: 0,
        OUTSIDE_HOSTEL: 0,
        SOS_TRIGGERED: 0,
        total: 0,
      },
    ),
  };
}

export async function overrideNightStatus(
  residentId: string,
  input: NightStatusOverrideInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findAdminResident(residentId, principal, input.hostelId);
  const previous = await NightStatusModel.findOne({
    residentId: resident._id,
  }).lean<NightStatusRecord | null>();
  const status = await writeNightStatus(resident, principal, {
    note: input.reason,
    source: "WARDEN_OVERRIDE",
    status: input.status,
  });

  await ManualStatusOverrideModel.create({
    hostelId: resident.hostelId,
    nextStatus: input.status,
    overriddenBy: principal.userId,
    previousStatus: previous?.status,
    reason: input.reason,
    residentId: resident._id,
  });
  await auditSafetyAction(
    principal,
    resident.hostelId,
    resident._id,
    "NightStatus",
    "NIGHT_STATUS_OVERRIDDEN",
    { reason: input.reason, status: input.status },
  );

  return {
    resident: serializeResidentSummary(resident),
    status: serializeNightStatus(status),
  };
}

export async function triggerSOS(input: SOSCreateInput, principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const alert = (await SOSAlertModel.create({
    guardianAlertEnabled: input.guardianAlertEnabled,
    hostelId: resident.hostelId,
    message: input.message,
    residentId: resident._id,
    status: "ACTIVE",
    triggeredBy: principal.userId,
  })) as SOSAlertRecord;

  await Promise.all([
    writeNightStatus(resident, principal, {
      note: "SOS alert triggered.",
      source: "SOS",
      status: "SOS_TRIGGERED",
    }),
    IncidentLogModel.create({
      action: "SOS_TRIGGERED",
      actorId: principal.userId,
      hostelId: resident.hostelId,
      note: input.message,
      residentId: resident._id,
      sosAlertId: alert._id,
    }),
    auditSafetyAction(
      principal,
      resident.hostelId,
      alert._id,
      "SOSAlert",
      "SOS_TRIGGERED",
    ),
  ]);

  // Awaited rather than fired and forgotten: §4.2 wants staff and guardians
  // alerted within seconds, and a serverless function stops executing the
  // moment the response is returned. fanOutSOSAlert swallows its own failures.
  const fanOut = await fanOutSOSAlert({
    alertId: alert._id.toString(),
    guardianAlertEnabled: input.guardianAlertEnabled,
    hostelId: resident.hostelId,
    message: input.message,
    residentId: resident._id,
    residentName: `${resident.firstName} ${resident.lastName}`.trim(),
    residentPhone: resident.phone,
    triggeredAt: alert.createdAt ?? new Date(),
  });

  return {
    alert: serializeSOS(alert),
    notified: {
      guardians: fanOut.guardiansNotified,
      staff: fanOut.staffNotified,
    },
    resident: serializeResidentSummary(resident),
  };
}

export async function listAdminSOSAlerts(query: SOSListQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  const alerts = await SOSAlertModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<SOSAlertRecord[]>();

  return {
    alerts: alerts.map(serializeSOS),
  };
}

export async function updateSOSAlertStatus(
  alertId: string,
  input: SOSStatusUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const alert = await SOSAlertModel.findOne({
    _id: normalizeObjectId(alertId, "sos alert id"),
    ...scopedHostelFilter(principal, input.hostelId),
  }).lean<SOSAlertRecord | null>();

  if (!alert) {
    throw new SafetyServiceError("SOS alert was not found.", "SOS_NOT_FOUND", 404);
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: input.status };

  if (input.status === "ACKNOWLEDGED") {
    set.acknowledgedAt = now;
    set.acknowledgedBy = principal.userId;
  }

  if (["RESOLVED", "FALSE_ALARM"].includes(input.status)) {
    set.resolvedAt = now;
    set.resolvedBy = principal.userId;
  }

  const updatedAlert = await SOSAlertModel.findOneAndUpdate(
    { _id: alert._id },
    { $set: set },
    { new: true },
  ).lean<SOSAlertRecord | null>();

  if (!updatedAlert) {
    throw new SafetyServiceError("SOS alert was not found.", "SOS_NOT_FOUND", 404);
  }

  await Promise.all([
    IncidentLogModel.create({
      action: `SOS_${input.status}`,
      actorId: principal.userId,
      hostelId: alert.hostelId,
      note: input.note,
      residentId: alert.residentId,
      sosAlertId: alert._id,
    }),
    auditSafetyAction(
      principal,
      alert.hostelId,
      alert._id,
      "SOSAlert",
      "SOS_STATUS_UPDATED",
      { status: input.status },
    ),
  ]);

  return {
    alert: serializeSOS(updatedAlert),
  };
}

export async function listResidentEmergencyContacts(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  const contacts = await EmergencyContactModel.find({
    hostelId: resident.hostelId,
    residentId: resident._id,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean<EmergencyContactRecord[]>();

  return {
    contacts: contacts.map(serializeEmergencyContact),
    resident: serializeResidentSummary(resident),
  };
}
