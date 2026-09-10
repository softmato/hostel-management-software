import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";

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
  residentType?: "STUDENT" | "WORKING_PROFESSIONAL" | "OTHER";
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

/**
 * Faces for a page of residents, in one query.
 *
 * A resident row is a *hostel's* record and carries no picture; the picture
 * belongs to the account behind it — the photo its owner put on their ID card,
 * which is what this product shows for a person everywhere. Keyed by `userId`
 * because that is the only thing the two sides share.
 *
 * One query for a whole list, never one per row: these lists are the roster,
 * the roll call and the money matrix, all of which draw forty people at once.
 */
export type ResidentAvatars = Map<string, string | null>;

export async function findResidentAvatars(
  residents: { userId?: Types.ObjectId | null }[],
): Promise<ResidentAvatars> {
  const userIds = residents
    .map((resident) => resident.userId)
    .filter((userId): userId is Types.ObjectId => Boolean(userId));

  if (userIds.length === 0) {
    return new Map();
  }

  const users = await UserModel.find({
    _id: { $in: userIds },
    isDeleted: { $ne: true },
  })
    .select("_id image")
    .lean<{ _id: Types.ObjectId; image?: string | null }[]>();

  return new Map(users.map((user) => [user._id.toString(), user.image ?? null]));
}

/**
 * @param avatars from {@link findResidentAvatars}. Omitting it is not "they
 *   have no photo" — it is a caller that did not join the accounts, and `image`
 *   comes back null. Pass it from anything a person's face is drawn on.
 */
export function serializeResidentSummary(
  resident: ResidentRecord,
  avatars?: ResidentAvatars,
) {
  return {
    createdAt: resident.createdAt?.toISOString(),
    depositAmount: resident.depositAmount,
    email: resident.email ?? "",
    firstName: resident.firstName,
    fullName: `${resident.firstName} ${resident.lastName}`.trim(),
    hostelId: resident.hostelId.toString(),
    id: resident._id.toString(),
    /** Their profile picture — a URL, or null. See {@link findResidentAvatars}. */
    image: resident.userId ? (avatars?.get(resident.userId.toString()) ?? null) : null,
    lastName: resident.lastName,
    moveInDate: resident.moveInDate.toISOString(),
    phone: resident.phone,
    // Drives the STUDENT-only QuestionCall entry point on the dashboard.
    residentType: resident.residentType ?? "STUDENT",
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
    // Out-of-scope is reported exactly like a genuine miss (RULES.md §3), so
    // the two cases above are indistinguishable from outside the tenant.
    throw new ResidentAccessError(
      "Resident profile was not found for this account.",
      "RESIDENT_PROFILE_NOT_FOUND",
      404,
    );
  }

  return resident;
}
