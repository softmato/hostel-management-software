import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { BedModel } from "@hostel/db/models/Bed";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { ResidentModel } from "@hostel/db/models/Resident";
import { RoomModel } from "@hostel/db/models/Room";
import type {
  emergencyContactCreateSchema,
  guardianCreateSchema,
  residentCreateSchema,
  residentListQuerySchema,
  residentStatusSchema,
  residentUpdateSchema,
} from "@/modules/residents/resident.validation";

type ResidentCreateInput = z.infer<typeof residentCreateSchema>;
type ResidentUpdateInput = z.infer<typeof residentUpdateSchema>;
type ResidentListQuery = z.infer<typeof residentListQuerySchema>;
type ResidentStatusInput = z.infer<typeof residentStatusSchema>;
type GuardianCreateInput = z.infer<typeof guardianCreateSchema>;
type EmergencyContactCreateInput = z.infer<typeof emergencyContactCreateSchema>;

type ResidentStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "MOVED_OUT";

type ResidentRecord = {
  _id: Types.ObjectId;
  bedId: Types.ObjectId;
  createdAt?: Date;
  demoDataLabel?: string;
  depositAmount: number;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  isDemoData?: boolean;
  lastName: string;
  monthlyFee?: number;
  moveInDate: Date;
  phone: string;
  residentType?: "STUDENT" | "WORKING_PROFESSIONAL" | "OTHER";
  roomId: Types.ObjectId;
  status: ResidentStatus;
  updatedAt?: Date;
  userId?: Types.ObjectId;
};

type RoomRecord = {
  _id: Types.ObjectId;
  capacity: number;
  hostelId: Types.ObjectId;
};

type BedRecord = {
  _id: Types.ObjectId;
  assignedResidentId?: Types.ObjectId;
  hostelId: Types.ObjectId;
  roomId: Types.ObjectId;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE";
};

type GuardianRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  isPrimary: boolean;
  lastName: string;
  phone: string;
  relation: string;
  residentId: Types.ObjectId;
  updatedAt?: Date;
};

type EmergencyContactRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
  residentId: Types.ObjectId;
  updatedAt?: Date;
};

export class ResidentServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "RESIDENT_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new ResidentServiceError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value));
}

function definedUpdate(input: Record<string, unknown>, omittedKeys: string[] = []) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && !omittedKeys.includes(key),
    ),
  );
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new ResidentServiceError(
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

function serializeResident(resident: ResidentRecord) {
  return {
    bedId: resident.bedId.toString(),
    createdAt: resident.createdAt?.toISOString(),
    demoDataLabel: resident.demoDataLabel ?? "",
    depositAmount: resident.depositAmount,
    email: resident.email ?? "",
    firstName: resident.firstName,
    hostelId: resident.hostelId.toString(),
    id: resident._id.toString(),
    isDemoData: Boolean(resident.isDemoData),
    lastName: resident.lastName,
    monthlyFee: resident.monthlyFee ?? 0,
    moveInDate: resident.moveInDate.toISOString(),
    phone: resident.phone,
    residentType: resident.residentType ?? "STUDENT",
    roomId: resident.roomId.toString(),
    status: resident.status,
    updatedAt: resident.updatedAt?.toISOString(),
    userId: resident.userId?.toString(),
  };
}

function serializeGuardian(guardian: GuardianRecord) {
  return {
    createdAt: guardian.createdAt?.toISOString(),
    email: guardian.email ?? "",
    firstName: guardian.firstName,
    hostelId: guardian.hostelId.toString(),
    id: guardian._id.toString(),
    isPrimary: guardian.isPrimary,
    lastName: guardian.lastName,
    phone: guardian.phone,
    relation: guardian.relation,
    residentId: guardian.residentId.toString(),
    updatedAt: guardian.updatedAt?.toISOString(),
  };
}

function serializeEmergencyContact(contact: EmergencyContactRecord) {
  return {
    createdAt: contact.createdAt?.toISOString(),
    hostelId: contact.hostelId.toString(),
    id: contact._id.toString(),
    isPrimary: contact.isPrimary,
    name: contact.name,
    phone: contact.phone,
    relation: contact.relation,
    residentId: contact.residentId.toString(),
    updatedAt: contact.updatedAt?.toISOString(),
  };
}

async function auditResidentAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  residentId: Types.ObjectId,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: residentId.toString(),
    entityType: "Resident",
    hostelId,
    metadata,
  });
}

async function refreshRoomVacancyStatus(room: RoomRecord) {
  const occupiedBeds = await BedModel.countDocuments({
    isDeleted: false,
    roomId: room._id,
    status: { $in: ["OCCUPIED", "RESERVED"] },
  });
  const nextStatus =
    occupiedBeds === 0 ? "VACANT" : occupiedBeds >= room.capacity ? "FULL" : "PARTIAL";

  await RoomModel.updateOne(
    { _id: room._id, isDeleted: false },
    { $set: { vacancyStatus: nextStatus } },
  );
}

async function findResidentForPrincipal(
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
    throw new ResidentServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  return resident;
}

async function validateRoomBedAssignment(
  hostelId: Types.ObjectId,
  roomId: string,
  bedId: string,
  currentResidentId?: Types.ObjectId,
) {
  const room = await RoomModel.findOne({
    _id: normalizeObjectId(roomId, "room id"),
    hostelId,
    isDeleted: false,
  }).lean<RoomRecord | null>();

  if (!room) {
    throw new ResidentServiceError("Room was not found.", "ROOM_NOT_FOUND", 404);
  }

  const bed = await BedModel.findOne({
    _id: normalizeObjectId(bedId, "bed id"),
    hostelId,
    isDeleted: false,
    roomId: room._id,
  }).lean<BedRecord | null>();

  if (!bed) {
    throw new ResidentServiceError(
      "Bed was not found in this room.",
      "BED_NOT_FOUND",
      404,
    );
  }

  const assignedToAnotherResident =
    bed.assignedResidentId &&
    (!currentResidentId ||
      bed.assignedResidentId.toString() !== currentResidentId.toString());
  const assignedToCurrentResident =
    bed.assignedResidentId &&
    currentResidentId &&
    bed.assignedResidentId.toString() === currentResidentId.toString();

  if (
    assignedToAnotherResident ||
    (["OCCUPIED", "RESERVED"].includes(bed.status) && !assignedToCurrentResident)
  ) {
    throw new ResidentServiceError(
      "Selected bed is not available.",
      "BED_NOT_AVAILABLE",
      409,
    );
  }

  if (bed.status === "MAINTENANCE") {
    throw new ResidentServiceError(
      "Selected bed is under maintenance.",
      "BED_UNDER_MAINTENANCE",
      409,
    );
  }

  return { bed, room };
}

export async function createResident(
  input: ResidentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const { bed, room } = await validateRoomBedAssignment(
    hostelId,
    input.roomId,
    input.bedId,
  );

  const resident = await ResidentModel.create({
    ...input,
    bedId: bed._id,
    createdBy: principal.userId,
    hostelId,
    roomId: room._id,
    updatedBy: principal.userId,
  });

  await BedModel.findOneAndUpdate(
    { _id: bed._id, isDeleted: false },
    {
      $set: {
        assignedResidentId: resident._id,
        status: "OCCUPIED",
        updatedBy: principal.userId,
      },
    },
  );
  await refreshRoomVacancyStatus(room);
  await auditResidentAction(principal, hostelId, resident._id, "RESIDENT_CREATED", {
    bedId: bed._id.toString(),
    roomId: room._id.toString(),
  });

  return {
    resident: serializeResident(resident as ResidentRecord),
  };
}

export async function listResidents(query: ResidentListQuery, principal: ApiPrincipal) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    isDeleted: false,
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.residentType) {
    filter.residentType = query.residentType;
  }

  if (query.q) {
    const pattern = new RegExp(query.q, "i");
    filter.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { phone: pattern },
      { email: pattern },
    ];
  }

  const residents = await ResidentModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<ResidentRecord[]>();

  return {
    residents: residents.map(serializeResident),
  };
}

export async function getResidentById(
  residentId: string,
  query: { hostelId?: string },
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal, query.hostelId);

  return {
    resident: serializeResident(resident),
  };
}

export async function updateResident(
  residentId: string,
  input: ResidentUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal, input.hostelId);
  const residentUpdate = definedUpdate(input, ["hostelId"]);
  let previousRoom: RoomRecord | null = null;
  let nextRoom: RoomRecord | null = null;
  let nextBed: BedRecord | null = null;

  if (input.roomId || input.bedId) {
    const assignment = await validateRoomBedAssignment(
      resident.hostelId,
      input.roomId ?? resident.roomId.toString(),
      input.bedId ?? resident.bedId.toString(),
      resident._id,
    );

    nextRoom = assignment.room;
    nextBed = assignment.bed;
    residentUpdate.roomId = nextRoom._id;
    residentUpdate.bedId = nextBed._id;

    if (nextBed._id.toString() !== resident.bedId.toString()) {
      previousRoom = await RoomModel.findOne({
        _id: resident.roomId,
        hostelId: resident.hostelId,
        isDeleted: false,
      }).lean<RoomRecord | null>();
    }
  }

  const updatedResident = await ResidentModel.findOneAndUpdate(
    { _id: resident._id, isDeleted: false },
    {
      $set: {
        ...residentUpdate,
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<ResidentRecord | null>();

  if (!updatedResident) {
    throw new ResidentServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  if (nextBed && nextBed._id.toString() !== resident.bedId.toString()) {
    await BedModel.findOneAndUpdate(
      { _id: resident.bedId, isDeleted: false },
      {
        $unset: { assignedResidentId: "" },
        $set: { status: "AVAILABLE", updatedBy: principal.userId },
      },
    );
    await BedModel.findOneAndUpdate(
      { _id: nextBed._id, isDeleted: false },
      {
        $set: {
          assignedResidentId: resident._id,
          status: "OCCUPIED",
          updatedBy: principal.userId,
        },
      },
    );
  }

  if (previousRoom) {
    await refreshRoomVacancyStatus(previousRoom);
  }

  if (nextRoom) {
    await refreshRoomVacancyStatus(nextRoom);
  }

  await auditResidentAction(
    principal,
    resident.hostelId,
    resident._id,
    "RESIDENT_UPDATED",
  );

  return {
    resident: serializeResident(updatedResident),
  };
}

export async function updateResidentStatus(
  residentId: string,
  input: ResidentStatusInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal, input.hostelId);
  const updatedResident = await ResidentModel.findOneAndUpdate(
    { _id: resident._id, isDeleted: false },
    {
      $set: {
        status: input.status,
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<ResidentRecord | null>();

  if (!updatedResident) {
    throw new ResidentServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  if (input.status === "MOVED_OUT") {
    const room = await RoomModel.findOne({
      _id: resident.roomId,
      hostelId: resident.hostelId,
      isDeleted: false,
    }).lean<RoomRecord | null>();

    await BedModel.findOneAndUpdate(
      { _id: resident.bedId, isDeleted: false },
      {
        $unset: { assignedResidentId: "" },
        $set: { status: "AVAILABLE", updatedBy: principal.userId },
      },
    );

    if (room) {
      await refreshRoomVacancyStatus(room);
    }
  }

  await auditResidentAction(
    principal,
    resident.hostelId,
    resident._id,
    "RESIDENT_STATUS_UPDATED",
    { status: input.status },
  );

  return {
    resident: serializeResident(updatedResident),
  };
}

export async function addGuardian(
  residentId: string,
  input: GuardianCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal);
  const guardian = await GuardianModel.create({
    ...input,
    hostelId: resident.hostelId,
    residentId: resident._id,
  });

  return {
    guardian: serializeGuardian(guardian as GuardianRecord),
    resident: serializeResident(resident),
  };
}

export async function addEmergencyContact(
  residentId: string,
  input: EmergencyContactCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal);
  const emergencyContact = await EmergencyContactModel.create({
    ...input,
    hostelId: resident.hostelId,
    residentId: resident._id,
  });

  return {
    emergencyContact: serializeEmergencyContact(
      emergencyContact as EmergencyContactRecord,
    ),
    resident: serializeResident(resident),
  };
}
