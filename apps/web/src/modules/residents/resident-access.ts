import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { ResidentModel } from "@hostel/db/models/Resident";

export type ResidentStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "MOVED_OUT";

export type ResidentRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  depositAmount: number;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  moveInDate: Date;
  phone: string;
  roomType: string;
  status: ResidentStatus;
  updatedAt?: Date;
  userId?: Types.ObjectId;
};

export class ResidentAccessError extends Error {
  constructor(
    message: string,
    public errorCode = "RESIDENT_ACCESS_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

export function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new ResidentAccessError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

export function serializeResidentSummary(resident: ResidentRecord) {
  return {
    createdAt: resident.createdAt?.toISOString(),
    depositAmount: resident.depositAmount,
    email: resident.email ?? "",
    firstName: resident.firstName,
    fullName: `${resident.firstName} ${resident.lastName}`.trim(),
    hostelId: resident.hostelId.toString(),
    id: resident._id.toString(),
    lastName: resident.lastName,
    moveInDate: resident.moveInDate.toISOString(),
    phone: resident.phone,
    roomType: resident.roomType,
    status: resident.status,
    updatedAt: resident.updatedAt?.toISOString(),
    userId: resident.userId?.toString(),
  };
}

export async function findCurrentResident(principal: ApiPrincipal) {
  const resident = await ResidentModel.findOne({
    isDeleted: false,
    status: { $in: ["ACTIVE", "PENDING"] },
    userId: normalizeObjectId(principal.userId, "user id"),
  }).lean<ResidentRecord | null>();

  if (!resident) {
    throw new ResidentAccessError(
      "Resident profile was not found for this account.",
      "RESIDENT_PROFILE_NOT_FOUND",
      404,
    );
  }

  if (!principal.hostelIds.includes(resident.hostelId.toString())) {
    throw new ResidentAccessError(
      "This resident profile is outside the current session hostel scope.",
      "TENANT_ACCESS_DENIED",
      403,
    );
  }

  return resident;
}
