import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { Role } from "@/lib/roles";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { ComplaintModel } from "@hostel/db/models/Complaint";
import { GuardianAccessModel } from "@hostel/db/models/GuardianAccess";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { getFoodRoutine, mealsOn } from "@/modules/food/food-routine.service";
import { GuardianPermissionModel } from "@hostel/db/models/GuardianPermission";
import { HostelModel } from "@hostel/db/models/Hostel";
import { NightStatusModel } from "@hostel/db/models/NightStatus";
import { NoticeModel } from "@hostel/db/models/Notice";
import { PaymentModel } from "@hostel/db/models/Payment";
import { ReceiptModel } from "@hostel/db/models/Receipt";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";
import { issueSessionForUser } from "@/modules/auth/auth.service";
import {
  normalizeObjectId,
  serializeResidentSummary,
} from "@/modules/residents/resident-access";
import type {
  guardianAccessCreateSchema,
  guardianLoginSchema,
} from "@/modules/guardian/guardian.validation";

type GuardianAccessCreateInput = z.infer<typeof guardianAccessCreateSchema>;
type GuardianLoginInput = z.infer<typeof guardianLoginSchema>;

type GuardianRecord = {
  _id: Types.ObjectId;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  phone: string;
  relation: string;
  residentId: Types.ObjectId;
};

type GuardianAccessRecord = {
  _id: Types.ObjectId;
  accessCode: string;
  allowComplaintStatus: boolean;
  expiresAt: Date;
  guardianId: Types.ObjectId;
  hostelId: Types.ObjectId;
  phone: string;
  residentId: Types.ObjectId;
  status: "ACTIVE" | "USED" | "REVOKED" | "EXPIRED";
  userId?: Types.ObjectId;
};

type GuardianPermissionRecord = {
  canViewComplaintStatus: boolean;
  canViewFood: boolean;
  canViewNotices: boolean;
  canViewPayments: boolean;
  canViewReceipts: boolean;
  canViewSafety: boolean;
};

type ResidentRecord = {
  _id: Types.ObjectId;
  depositAmount: number;
  email?: string;
  firstName: string;
  hostelId: Types.ObjectId;
  lastName: string;
  moveInDate: Date;
  phone: string;
  roomType: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "MOVED_OUT";
  userId?: Types.ObjectId;
};

type UserRecord = {
  _id: Types.ObjectId;
  email?: string | null;
  hostelIds?: Types.ObjectId[];
  name: string;
  phone?: string | null;
  role: Role;
  status: string;
};

export class GuardianServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "GUARDIAN_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function randomAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function expiresInDays(days: number) {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return date;
}

function resolveAdminHostelId(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId, "hostel id");
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0], "hostel id");
  }

  throw new GuardianServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

async function auditGuardianAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  entityId: Types.ObjectId,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: entityId.toString(),
    entityType: "GuardianAccess",
    hostelId,
    metadata,
  });
}

async function findAdminResident(
  residentId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const hostelId = resolveAdminHostelId(principal, requestedHostelId);
  const resident = await ResidentModel.findOne({
    _id: normalizeObjectId(residentId, "resident id"),
    hostelId,
    isDeleted: false,
  }).lean<ResidentRecord | null>();

  if (!resident) {
    throw new GuardianServiceError("Resident was not found.", "RESIDENT_NOT_FOUND", 404);
  }

  return resident;
}

function serializeGuardianAccess(access: GuardianAccessRecord) {
  return {
    accessCode: access.accessCode,
    expiresAt: access.expiresAt.toISOString(),
    guardianId: access.guardianId.toString(),
    hostelId: access.hostelId.toString(),
    id: access._id.toString(),
    phone: access.phone,
    residentId: access.residentId.toString(),
    status: access.status,
    userId: access.userId?.toString(),
  };
}

async function loadGuardianAccess(principal: ApiPrincipal) {
  const access = await GuardianAccessModel.findOne({
    status: { $in: ["ACTIVE", "USED"] },
    userId: normalizeObjectId(principal.userId, "user id"),
  }).lean<GuardianAccessRecord | null>();

  if (!access) {
    throw new GuardianServiceError(
      "Guardian access was not found for this account.",
      "GUARDIAN_ACCESS_NOT_FOUND",
      404,
    );
  }

  if (!principal.hostelIds.includes(access.hostelId.toString())) {
    // Reported exactly like a genuine miss (RULES.md §3).
    throw new GuardianServiceError(
      "Guardian access was not found for this account.",
      "GUARDIAN_ACCESS_NOT_FOUND",
      404,
    );
  }

  const [resident, guardian, permission] = await Promise.all([
    ResidentModel.findOne({
      _id: access.residentId,
      hostelId: access.hostelId,
      isDeleted: false,
    }).lean<ResidentRecord | null>(),
    GuardianModel.findOne({
      _id: access.guardianId,
      hostelId: access.hostelId,
      residentId: access.residentId,
    }).lean<GuardianRecord | null>(),
    GuardianPermissionModel.findOne({
      guardianAccessId: access._id,
    }).lean<GuardianPermissionRecord | null>(),
  ]);

  if (!resident || !guardian) {
    throw new GuardianServiceError(
      "Guardian resident link was not found.",
      "GUARDIAN_LINK_NOT_FOUND",
      404,
    );
  }

  return {
    access,
    guardian,
    // Default-deny (PRD.md §10). A missing or partial permission document means
    // the resident has not shared that field, never "share everything" — the
    // guardian dashboard is opt-in field by field.
    permission: {
      canViewComplaintStatus:
        permission?.canViewComplaintStatus ?? access.allowComplaintStatus ?? false,
      canViewFood: permission?.canViewFood ?? false,
      canViewNotices: permission?.canViewNotices ?? false,
      canViewPayments: permission?.canViewPayments ?? false,
      canViewReceipts: permission?.canViewReceipts ?? false,
      canViewSafety: permission?.canViewSafety ?? false,
    },
    resident,
  };
}

function serializePayment(payment: {
  _id: Types.ObjectId;
  dueAmount: number;
  dueDate: Date;
  month: string;
  paidAmount: number;
  status: string;
}) {
  return {
    dueAmount: payment.dueAmount,
    dueDate: payment.dueDate.toISOString(),
    id: payment._id.toString(),
    month: payment.month,
    paidAmount: payment.paidAmount,
    status: payment.status,
  };
}

export async function createGuardianAccess(
  residentId: string,
  input: GuardianAccessCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findAdminResident(residentId, principal, input.hostelId);
  const guardian = await GuardianModel.findOne({
    _id: normalizeObjectId(input.guardianId, "guardian id"),
    hostelId: resident.hostelId,
    residentId: resident._id,
  }).lean<GuardianRecord | null>();

  if (!guardian) {
    throw new GuardianServiceError("Guardian was not found.", "GUARDIAN_NOT_FOUND", 404);
  }

  await GuardianAccessModel.updateMany(
    { guardianId: guardian._id, status: "ACTIVE" },
    { $set: { status: "REVOKED" } },
  );

  const access = (await GuardianAccessModel.create({
    accessCode: randomAccessCode(),
    allowComplaintStatus: input.allowComplaintStatus,
    createdBy: principal.userId,
    expiresAt: expiresInDays(input.expiresInDays),
    guardianId: guardian._id,
    hostelId: resident.hostelId,
    phone: guardian.phone,
    residentId: resident._id,
    status: "ACTIVE",
  })) as GuardianAccessRecord;

  await GuardianPermissionModel.create({
    canViewComplaintStatus: input.allowComplaintStatus,
    guardianAccessId: access._id,
    hostelId: resident.hostelId,
    residentId: resident._id,
  });
  await auditGuardianAction(
    principal,
    resident.hostelId,
    access._id,
    "GUARDIAN_ACCESS_CREATED",
    { guardianId: guardian._id.toString(), residentId: resident._id.toString() },
  );

  return {
    access: serializeGuardianAccess(access),
    resident: serializeResidentSummary(resident),
  };
}

export async function loginGuardian(input: GuardianLoginInput) {
  await connectToDatabase();

  const access = await GuardianAccessModel.findOne({
    accessCode: input.accessCode.toUpperCase(),
    phone: input.phone,
    status: "ACTIVE",
  }).lean<GuardianAccessRecord | null>();

  if (!access) {
    throw new GuardianServiceError(
      "Invalid guardian access.",
      "INVALID_GUARDIAN_LOGIN",
      401,
    );
  }

  if (access.expiresAt.getTime() < Date.now()) {
    await GuardianAccessModel.updateOne(
      { _id: access._id },
      { $set: { status: "EXPIRED" } },
    );
    throw new GuardianServiceError(
      "Guardian access expired.",
      "GUARDIAN_ACCESS_EXPIRED",
      410,
    );
  }

  const guardian = await GuardianModel.findById(
    access.guardianId,
  ).lean<GuardianRecord | null>();

  if (!guardian) {
    throw new GuardianServiceError("Guardian was not found.", "GUARDIAN_NOT_FOUND", 404);
  }

  // A phone number is not proof of identity for anything but a guardian link.
  // Upserting blindly on `phone` would rewrite the role of whoever already owns
  // that number — a resident sharing a family phone would be demoted out of
  // their own portal — so an established non-PUBLIC account is refused instead.
  const existingUser = await UserModel.findOne({
    isDeleted: { $ne: true },
    phone: input.phone,
  }).lean<UserRecord | null>();

  if (
    existingUser &&
    existingUser.role !== Role.PUBLIC &&
    existingUser.role !== Role.GUARDIAN
  ) {
    throw new GuardianServiceError(
      "This phone number already belongs to another hostel account. Ask the hostel to register the guardian with a different number.",
      "PHONE_ALREADY_HAS_ROLE",
      409,
    );
  }

  const user = (await UserModel.findOneAndUpdate(
    existingUser ? { _id: existingUser._id } : { phone: input.phone },
    {
      $addToSet: { hostelIds: access.hostelId },
      $set: {
        name: `${guardian.firstName} ${guardian.lastName}`.trim(),
        phone: input.phone,
        role: Role.GUARDIAN,
        status: "ACTIVE",
      },
    },
    { new: true, upsert: true },
  ).lean<UserRecord>()) as UserRecord;

  await GuardianAccessModel.updateOne(
    { _id: access._id },
    { $set: { status: "USED", usedAt: new Date(), userId: user._id } },
  );

  return issueSessionForUser(user);
}

export async function getGuardianDashboard(principal: ApiPrincipal) {
  await connectToDatabase();

  const { access, guardian, permission, resident } = await loadGuardianAccess(principal);
  // Each query is gated by its own permission flag rather than fetched and
  // filtered afterwards: a field the resident did not share is never read out
  // of the database at all, so it cannot leak through a serializer mistake.
  const [hostel, payments, notices, food, nightStatus, complaints, receipts] =
    await Promise.all([
      HostelModel.findOne({ _id: access.hostelId, isDeleted: false }).lean<{
        _id: Types.ObjectId;
        name: string;
        location?: Record<string, unknown>;
      } | null>(),
      permission.canViewPayments
        ? PaymentModel.find({
            hostelId: access.hostelId,
            residentId: access.residentId,
          })
            .sort({ dueDate: -1 })
            .limit(6)
            .lean<
              Array<{
                _id: Types.ObjectId;
                dueAmount: number;
                dueDate: Date;
                month: string;
                paidAmount: number;
                status: string;
              }>
            >()
        : Promise.resolve([]),
      permission.canViewNotices
        ? NoticeModel.find({
            hostelId: access.hostelId,
            targetAudience: { $in: ["ALL", "GUARDIANS"] },
          })
            .sort({ isUrgent: -1, publishedAt: -1 })
            .limit(5)
            .lean<
              Array<{
                _id: Types.ObjectId;
                title: string;
                content: string;
                category: string;
                isUrgent: boolean;
              }>
            >()
        : Promise.resolve([]),
      permission.canViewFood ? getFoodRoutine(access.hostelId) : Promise.resolve(null),
      permission.canViewSafety
        ? NightStatusModel.findOne({ residentId: resident._id }).lean<{
            checkedAt: Date;
            status: string;
          } | null>()
        : Promise.resolve(null),
      permission.canViewComplaintStatus
        ? ComplaintModel.find({
            hostelId: access.hostelId,
            residentId: access.residentId,
          })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean<Array<{ _id: Types.ObjectId; status: string; title: string }>>()
        : Promise.resolve([]),
      permission.canViewReceipts
        ? ReceiptModel.find({
            hostelId: access.hostelId,
            residentId: access.residentId,
          })
            .sort({ issuedAt: -1 })
            .limit(12)
            .lean<
              Array<{
                _id: Types.ObjectId;
                amount: number;
                issuedAt: Date;
                month: string;
                receiptNumber: string;
              }>
            >()
        : Promise.resolve([]),
    ]);
  const dueAmount = payments.reduce(
    (sum, payment) =>
      ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"].includes(payment.status)
        ? sum + Math.max(payment.dueAmount - payment.paidAmount, 0)
        : sum,
    0,
  );

  return {
    dashboard: {
      access: serializeGuardianAccess(access),
      complaints: complaints.map((complaint) => ({
        id: complaint._id.toString(),
        status: complaint.status,
        title: complaint.title,
      })),
      // Today's meals off the weekly routine — a guardian wants "what are they
      // eating", not the whole week.
      food: food ? mealsOn(food, new Date()) : [],
      guardian: {
        id: guardian._id.toString(),
        name: `${guardian.firstName} ${guardian.lastName}`.trim(),
        phone: guardian.phone,
        relation: guardian.relation,
      },
      hostel: hostel
        ? {
            id: hostel._id.toString(),
            location: hostel.location ?? {},
            name: hostel.name,
          }
        : null,
      notices: notices.map((notice) => ({
        category: notice.category,
        content: notice.content,
        id: notice._id.toString(),
        isUrgent: notice.isUrgent,
        title: notice.title,
      })),
      payments: payments.map(serializePayment),
      permissions: permission,
      receipts: receipts.map((receipt) => ({
        amount: receipt.amount,
        id: receipt._id.toString(),
        issuedOn: receipt.issuedAt.toISOString().slice(0, 10),
        month: receipt.month,
        receiptNumber: receipt.receiptNumber,
      })),
      // A guardian gets the resident's identity and room, never their deposit,
      // contact details or account linkage (PRD.md §10).
      resident: {
        fullName: `${resident.firstName} ${resident.lastName}`.trim(),
        id: resident._id.toString(),
        roomType: resident.roomType,
        status: resident.status,
      },
      // Day-level only. `checkedAt` is deliberately truncated to a date: the
      // exact time a resident was checked is the sort of surveillance detail
      // §4.1 forbids showing a guardian.
      safety: permission.canViewSafety
        ? {
            asOf: nightStatus?.checkedAt.toISOString().slice(0, 10) ?? null,
            status: nightStatus?.status ?? "NOT_VERIFIED",
          }
        : null,
      summary: permission.canViewPayments
        ? {
            dueAmount,
            unpaidCount: payments.filter((payment) =>
              ["UNPAID", "PARTIAL", "OVERDUE", "PENDING_PROOF"].includes(payment.status),
            ).length,
          }
        : null,
    },
  };
}

export async function listGuardianPayments(principal: ApiPrincipal) {
  const result = await getGuardianDashboard(principal);

  return {
    payments: result.dashboard.payments,
    receipts: result.dashboard.receipts,
    summary: result.dashboard.summary,
  };
}

export async function listGuardianNotices(principal: ApiPrincipal) {
  const result = await getGuardianDashboard(principal);

  return { notices: result.dashboard.notices };
}

export async function listGuardianFood(principal: ApiPrincipal) {
  const result = await getGuardianDashboard(principal);

  return { food: result.dashboard.food };
}

export async function getGuardianSafetySummary(principal: ApiPrincipal) {
  const result = await getGuardianDashboard(principal);

  return {
    complaints: result.dashboard.complaints,
    safety: result.dashboard.safety,
  };
}
