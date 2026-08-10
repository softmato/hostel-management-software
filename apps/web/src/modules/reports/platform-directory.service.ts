import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { ComplaintModel } from "@hostel/db/models/Complaint";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { HostelModel } from "@hostel/db/models/Hostel";
import { NightStatusModel } from "@hostel/db/models/NightStatus";
import { latestInvoicePerResident } from "@/modules/finance/ledger-read.service";
import { QRActivationModel } from "@hostel/db/models/QRActivation";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";

/**
 * Read-only, platform-wide directories for the Platform Owner portal. Unlike the
 * hostel-admin equivalents these are deliberately unscoped — the owner sees
 * across every tenant — so they are only ever reachable behind
 * `requirePlatformPrincipal`.
 */

type UserRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  demoDataLabel?: string;
  email?: string;
  hostelIds?: Types.ObjectId[];
  isDemoData?: boolean;
  lastLoginAt?: Date;
  name?: string;
  phone?: string;
  role?: string;
  status?: string;
};

type ResidentRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  depositAmount?: number;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  moveInDate?: Date;
  phone: string;
  roomType?: string;
  status: string;
  userId?: Types.ObjectId;
};

type ComplaintRecord = {
  _id: Types.ObjectId;
  category: string;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  isAnonymous?: boolean;
  resolvedAt?: Date;
  slaDueAt?: Date;
  status: string;
  title: string;
};

const LIST_LIMIT = 250;

async function hostelNameMap(hostelIds: Types.ObjectId[]) {
  const unique = [...new Set(hostelIds.map((id) => id.toString()))];
  const hostels = await HostelModel.find({ _id: { $in: unique } })
    .select("name")
    .lean<Array<{ _id: Types.ObjectId; name?: string }>>();

  return new Map(hostels.map((hostel) => [hostel._id.toString(), hostel.name ?? "—"]));
}

/** Keeps the newest record per resident from an already date-sorted list. */
function firstPerResident<T extends { residentId: Types.ObjectId }>(records: T[]) {
  const byResident = new Map<string, T>();

  for (const record of records) {
    const key = record.residentId.toString();
    if (!byResident.has(key)) {
      byResident.set(key, record);
    }
  }

  return byResident;
}

/**
 * The single people directory behind the platform "Users" tab: every account,
 * enriched with its resident record (room/bed, guardian, emergency contact, fee
 * state, night status, activation) when that account belongs to a resident.
 * Owners and wardens simply have those fields empty.
 */
export async function listPlatformDirectory() {
  await connectToDatabase();

  const [users, residents] = await Promise.all([
    UserModel.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean<UserRecord[]>(),
    ResidentModel.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(LIST_LIMIT)
      .lean<ResidentRecord[]>(),
  ]);

  const residentIds = residents.map((resident) => resident._id);

  const [guardians, emergencyContacts, payments, nightStatuses, activations] =
    await Promise.all([
      GuardianModel.find({ residentId: { $in: residentIds } })
        .sort({ isPrimary: -1, createdAt: -1 })
        .lean<
          Array<{
            firstName: string;
            lastName: string;
            phone: string;
            relation: string;
            residentId: Types.ObjectId;
          }>
        >(),
      EmergencyContactModel.find({ residentId: { $in: residentIds } })
        .sort({ isPrimary: -1, createdAt: -1 })
        .lean<
          Array<{
            name: string;
            phone: string;
            relation: string;
            residentId: Types.ObjectId;
          }>
        >(),
      // Through the ledger facade (ADR-3): it already returns one row per
      // resident, so the local firstPerResident pass is not needed here.
      latestInvoicePerResident(residentIds),
      NightStatusModel.find({ residentId: { $in: residentIds } })
        .sort({ checkedAt: -1 })
        .lean<Array<{ residentId: Types.ObjectId; status: string; checkedAt?: Date }>>(),
      QRActivationModel.find({ residentId: { $in: residentIds } })
        .sort({ createdAt: -1 })
        .lean<
          Array<{
            createdAt?: Date;
            residentId: Types.ObjectId;
            status: string;
            usedAt?: Date;
          }>
        >(),
    ]);

  const nameById = await hostelNameMap([
    ...residents.map((resident) => resident.hostelId),
    ...users.flatMap((user) => user.hostelIds ?? []),
  ]);

  const guardianByResident = firstPerResident(guardians);
  const emergencyByResident = firstPerResident(emergencyContacts);
  const paymentByResident = payments;
  const nightByResident = firstPerResident(nightStatuses);
  const activationByResident = firstPerResident(activations);

  const residentByUserId = new Map<string, ResidentRecord>();
  for (const resident of residents) {
    if (resident.userId) {
      residentByUserId.set(resident.userId.toString(), resident);
    }
  }

  function enrich(resident: ResidentRecord | undefined) {
    if (!resident) {
      return {
        activationStatus: "",
        emergencyContact: null,
        feeMonth: "",
        feeStatus: "",
        guardian: null,
        moveInDate: null as string | null,
        nightStatus: "",
        residentId: null as string | null,
        residentStatus: "",
        stayType: "",
      };
    }

    const key = resident._id.toString();
    const guardian = guardianByResident.get(key);
    const emergency = emergencyByResident.get(key);
    const payment = paymentByResident.get(key);
    const night = nightByResident.get(key);
    const activation = activationByResident.get(key);

    return {
      activationStatus: activation?.status ?? "NOT_GENERATED",
      emergencyContact: emergency
        ? {
            name: emergency.name,
            phone: emergency.phone,
            relation: emergency.relation,
          }
        : null,
      feeMonth: payment?.period ?? "",
      feeStatus: payment?.status ?? "",
      guardian: guardian
        ? {
            name: `${guardian.firstName} ${guardian.lastName}`.trim(),
            phone: guardian.phone,
            relation: guardian.relation,
          }
        : null,
      moveInDate: resident.moveInDate?.toISOString() ?? null,
      nightStatus: night?.status ?? "",
      residentId: key,
      residentStatus: resident.status,
      stayType: resident.roomType ?? "",
    };
  }

  const people = users.map((user) => {
    const resident = residentByUserId.get(user._id.toString());
    const hostelId =
      resident?.hostelId?.toString() ?? user.hostelIds?.[0]?.toString() ?? "";

    return {
      createdAt: user.createdAt?.toISOString() ?? null,
      demoDataLabel: user.demoDataLabel ?? "",
      email: user.email ?? resident?.email ?? "",
      hostelCount: (user.hostelIds ?? []).length,
      hostelId,
      hostelName: hostelId ? (nameById.get(hostelId) ?? "—") : "",
      id: user._id.toString(),
      isDemoData: Boolean(user.isDemoData),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      name: user.name ?? "Unnamed user",
      phone: user.phone ?? resident?.phone ?? "",
      role: user.role ?? "PUBLIC",
      status: user.status ?? "ACTIVE",
      ...enrich(resident),
    };
  });

  // Residents whose activation has not produced a User account yet still belong
  // in the directory — otherwise the owner cannot see who is pending.
  const linkedResidentIds = new Set(
    [...residentByUserId.values()].map((resident) => resident._id.toString()),
  );

  const unlinked = residents
    .filter((resident) => !linkedResidentIds.has(resident._id.toString()))
    .map((resident) => {
      const hostelId = resident.hostelId.toString();

      return {
        createdAt: resident.createdAt?.toISOString() ?? null,
        demoDataLabel: "",
        email: resident.email ?? "",
        hostelCount: 1,
        hostelId,
        hostelName: nameById.get(hostelId) ?? "—",
        id: `resident:${resident._id.toString()}`,
        isDemoData: false,
        lastLoginAt: null,
        name: `${resident.firstName} ${resident.lastName}`.trim(),
        phone: resident.phone,
        role: "RESIDENT",
        status: resident.status,
        ...enrich(resident),
      };
    });

  const all = [...people, ...unlinked];

  const roleCounts = all.reduce<Record<string, number>>((counts, person) => {
    counts[person.role] = (counts[person.role] ?? 0) + 1;
    return counts;
  }, {});

  return {
    people: all,
    roleCounts,
    total: all.length,
  };
}

export async function listPlatformComplaints() {
  await connectToDatabase();

  const complaints = await ComplaintModel.find({})
    .sort({ createdAt: -1 })
    .limit(LIST_LIMIT)
    .lean<ComplaintRecord[]>();

  const nameById = await hostelNameMap(complaints.map((complaint) => complaint.hostelId));
  const now = Date.now();

  const statusCounts = complaints.reduce<Record<string, number>>((counts, complaint) => {
    counts[complaint.status] = (counts[complaint.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    complaints: complaints.map((complaint) => ({
      category: complaint.category,
      createdAt: complaint.createdAt?.toISOString() ?? null,
      hostelId: complaint.hostelId.toString(),
      hostelName: nameById.get(complaint.hostelId.toString()) ?? "—",
      id: complaint._id.toString(),
      isAnonymous: Boolean(complaint.isAnonymous),
      // Breached = past its SLA deadline and still not resolved.
      isOverdue:
        complaint.status !== "RESOLVED" &&
        complaint.status !== "REJECTED" &&
        Boolean(complaint.slaDueAt) &&
        complaint.slaDueAt!.getTime() < now,
      resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
      slaDueAt: complaint.slaDueAt?.toISOString() ?? null,
      status: complaint.status,
      title: complaint.title,
    })),
    statusCounts,
    total: complaints.length,
  };
}
