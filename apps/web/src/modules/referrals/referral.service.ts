import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { InquiryModel } from "@hostel/db/models/Inquiry";
import { ReferralCodeModel } from "@hostel/db/models/ReferralCode";
import { ReferralModel } from "@hostel/db/models/Referral";
import { ReferralRewardModel } from "@hostel/db/models/ReferralReward";
import { ResidentModel } from "@hostel/db/models/Resident";
import {
  findCurrentResident,
  normalizeObjectId,
  serializeResidentSummary,
} from "@/modules/residents/resident-access";
import type {
  hostelAdminReferralListQuerySchema,
  referralConfirmSchema,
  referralRewardUpdateSchema,
  referredInquiryCreateSchema,
} from "@/modules/referrals/referral.validation";

type ReferredInquiryCreateInput = z.infer<typeof referredInquiryCreateSchema>;
type HostelAdminReferralListQuery = z.infer<typeof hostelAdminReferralListQuerySchema>;
type ReferralConfirmInput = z.infer<typeof referralConfirmSchema>;
type ReferralRewardUpdateInput = z.infer<typeof referralRewardUpdateSchema>;

type ReferralCodeRecord = {
  _id: Types.ObjectId;
  code: string;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  joinedCount?: number;
  residentId: Types.ObjectId;
  rewardCount?: number;
  status: "ACTIVE" | "INACTIVE";
  updatedAt?: Date;
  userId: Types.ObjectId;
};

type ReferralRecord = {
  _id: Types.ObjectId;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
  createdAt?: Date;
  email?: string;
  hostelId: Types.ObjectId;
  inquiryId?: Types.ObjectId;
  joinedResidentId?: Types.ObjectId;
  message?: string;
  name: string;
  phone: string;
  referralCodeId: Types.ObjectId;
  referrerResidentId: Types.ObjectId;
  status: "INQUIRY_CREATED" | "JOINED" | "REWARDED" | "CANCELLED";
  updatedAt?: Date;
};

type ReferralRewardRecord = {
  _id: Types.ObjectId;
  amount: number;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  hostelId: Types.ObjectId;
  notes?: string;
  referralId: Types.ObjectId;
  referrerResidentId: Types.ObjectId;
  rewardType: "DISCOUNT" | "CASH" | "SERVICE_CREDIT" | "OTHER";
  status: "PENDING" | "APPROVED" | "PAID" | "CANCELLED";
};

type ResidentRecord = {
  _id: Types.ObjectId;
  hostelId: Types.ObjectId;
};

type ReferrerRecord = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  phone?: string;
  roomType?: string;
};

function referrerName(resident?: ReferrerRecord) {
  return `${resident?.firstName ?? ""} ${resident?.lastName ?? ""}`.trim() || "—";
}

export class ReferralServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "REFERRAL_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function serializeReferralCode(code: ReferralCodeRecord) {
  return {
    code: code.code,
    createdAt: code.createdAt?.toISOString(),
    hostelId: code.hostelId.toString(),
    id: code._id.toString(),
    joinedCount: code.joinedCount ?? 0,
    link: `/inquiry?ref=${encodeURIComponent(code.code)}`,
    residentId: code.residentId.toString(),
    rewardCount: code.rewardCount ?? 0,
    status: code.status,
    updatedAt: code.updatedAt?.toISOString(),
    userId: code.userId.toString(),
  };
}

function serializeReferral(referral: ReferralRecord) {
  return {
    confirmedAt: referral.confirmedAt?.toISOString(),
    confirmedBy: referral.confirmedBy?.toString(),
    createdAt: referral.createdAt?.toISOString(),
    email: referral.email ?? "",
    hostelId: referral.hostelId.toString(),
    id: referral._id.toString(),
    inquiryId: referral.inquiryId?.toString(),
    joinedResidentId: referral.joinedResidentId?.toString(),
    message: referral.message ?? "",
    name: referral.name,
    phone: referral.phone,
    referralCodeId: referral.referralCodeId.toString(),
    referrerResidentId: referral.referrerResidentId.toString(),
    status: referral.status,
    updatedAt: referral.updatedAt?.toISOString(),
  };
}

function serializeReward(reward: ReferralRewardRecord | null) {
  if (!reward) {
    return null;
  }

  return {
    amount: reward.amount,
    approvedAt: reward.approvedAt?.toISOString(),
    approvedBy: reward.approvedBy?.toString(),
    hostelId: reward.hostelId.toString(),
    id: reward._id.toString(),
    notes: reward.notes ?? "",
    referralId: reward.referralId.toString(),
    referrerResidentId: reward.referrerResidentId.toString(),
    rewardType: reward.rewardType,
    status: reward.status,
  };
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

  throw new ReferralServiceError(
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

async function auditReferralAction(
  principal: ApiPrincipal,
  referral: ReferralRecord,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: referral._id.toString(),
    entityType: "Referral",
    hostelId: referral.hostelId,
    metadata,
  });
}

function referralCodeCandidate(residentId: string, phone: string) {
  const phoneTail = phone.replace(/\D/g, "").slice(-4) || "0000";

  return `HH${phoneTail}${residentId.slice(-4)}`.toUpperCase();
}

async function uniqueReferralCode(residentId: string, phone: string) {
  const base = referralCodeCandidate(residentId, phone);
  let candidate = base;
  let suffix = 2;

  while (await ReferralCodeModel.exists({ code: candidate })) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export async function getResidentReferral(principal: ApiPrincipal) {
  await connectToDatabase();

  const resident = await findCurrentResident(principal);
  let referralCode = await ReferralCodeModel.findOne({
    hostelId: resident.hostelId,
    residentId: resident._id,
  }).lean<ReferralCodeRecord | null>();

  if (!referralCode) {
    referralCode = (await ReferralCodeModel.create({
      code: await uniqueReferralCode(resident._id.toString(), resident.phone),
      hostelId: resident.hostelId,
      residentId: resident._id,
      status: "ACTIVE",
      userId: principal.userId,
    })) as ReferralCodeRecord;
  }

  const referrals = await ReferralModel.find({
    hostelId: resident.hostelId,
    isDeleted: false,
    referrerResidentId: resident._id,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<ReferralRecord[]>();

  return {
    referralCode: serializeReferralCode(referralCode),
    referrals: referrals.map(serializeReferral),
    resident: serializeResidentSummary(resident),
  };
}

export async function createReferredInquiry(input: ReferredInquiryCreateInput) {
  await connectToDatabase();

  const referralCode = await ReferralCodeModel.findOne({
    code: input.referralCode.toUpperCase(),
    status: "ACTIVE",
  }).lean<ReferralCodeRecord | null>();

  if (!referralCode) {
    throw new ReferralServiceError(
      "Referral code was not found.",
      "REFERRAL_CODE_NOT_FOUND",
      404,
    );
  }

  const existingReferral = await ReferralModel.findOne({
    hostelId: referralCode.hostelId,
    isDeleted: false,
    phone: input.phone,
    referralCodeId: referralCode._id,
    status: { $ne: "CANCELLED" },
  }).lean<ReferralRecord | null>();

  if (existingReferral) {
    throw new ReferralServiceError(
      "This referral inquiry already exists.",
      "REFERRAL_ALREADY_EXISTS",
      409,
    );
  }

  const inquiry = await InquiryModel.create({
    email: input.email,
    hostelId: referralCode.hostelId,
    message: input.message,
    name: input.name,
    phone: input.phone,
    source: "PUBLIC_WEBSITE",
    status: "NEW",
  });
  const referral = (await ReferralModel.create({
    email: input.email,
    hostelId: referralCode.hostelId,
    inquiryId: inquiry._id,
    message: input.message,
    name: input.name,
    phone: input.phone,
    referralCodeId: referralCode._id,
    referrerResidentId: referralCode.residentId,
    status: "INQUIRY_CREATED",
  })) as ReferralRecord;

  return {
    inquiry: {
      id: inquiry._id.toString(),
      status: "NEW",
    },
    referral: serializeReferral(referral),
  };
}

export async function listHostelAdminReferrals(
  query: HostelAdminReferralListQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    isDeleted: false,
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.status) {
    filter.status = query.status;
  }

  const referrals = await ReferralModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(120)
    .lean<ReferralRecord[]>();
  const referralIds = referrals.map((referral) => referral._id);
  const rewards =
    referralIds.length > 0
      ? await ReferralRewardModel.find({ referralId: { $in: referralIds } }).lean<
          ReferralRewardRecord[]
        >()
      : [];
  const rewardByReferralId = new Map(
    rewards.map((reward) => [reward.referralId.toString(), reward]),
  );

  // Resolve referrer names and their codes in two queries rather than per row,
  // so the admin sees "who brought this person in" instead of an ObjectId.
  const referrerIds = [
    ...new Set(referrals.map((referral) => referral.referrerResidentId.toString())),
  ];
  const [referrerRows, codes] = await Promise.all([
    ResidentModel.find({ _id: { $in: referrerIds } })
      .select("firstName lastName phone roomType")
      .lean<ReferrerRecord[]>(),
    ReferralCodeModel.find(scopedHostelFilter(principal, query.hostelId))
      .sort({ joinedCount: -1 })
      .limit(10)
      .lean<ReferralCodeRecord[]>(),
  ]);
  const referrerById = new Map(
    referrerRows.map((resident) => [resident._id.toString(), resident]),
  );
  const leaderboardResidentIds = codes.map((code) => code.residentId.toString());
  const leaderboardRows = await ResidentModel.find({
    _id: { $in: leaderboardResidentIds },
  })
    .select("firstName lastName phone roomType")
    .lean<ReferrerRecord[]>();
  const leaderboardById = new Map(
    leaderboardRows.map((resident) => [resident._id.toString(), resident]),
  );

  const rewardTotals = rewards.reduce(
    (totals, reward) => ({
      approved: totals.approved + (reward.status === "APPROVED" ? reward.amount : 0),
      paid: totals.paid + (reward.status === "PAID" ? reward.amount : 0),
      pending: totals.pending + (reward.status === "PENDING" ? reward.amount : 0),
    }),
    { approved: 0, paid: 0, pending: 0 },
  );
  const byStatus = referrals.reduce<Record<string, number>>((counts, referral) => {
    counts[referral.status] = (counts[referral.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    referrals: referrals.map((referral) => {
      const referrer = referrerById.get(referral.referrerResidentId.toString());

      return {
        ...serializeReferral(referral),
        referrerName: referrerName(referrer),
        referrerPhone: referrer?.phone ?? "",
        reward: serializeReward(rewardByReferralId.get(referral._id.toString()) ?? null),
      };
    }),
    summary: {
      byStatus,
      joined: (byStatus.JOINED ?? 0) + (byStatus.REWARDED ?? 0),
      pendingConfirmation: byStatus.INQUIRY_CREATED ?? 0,
      rewardApprovedAmount: rewardTotals.approved,
      rewardPaidAmount: rewardTotals.paid,
      rewardPendingAmount: rewardTotals.pending,
      total: referrals.length,
    },
    topReferrers: codes
      .filter((code) => (code.joinedCount ?? 0) > 0 || (code.rewardCount ?? 0) > 0)
      .map((code) => ({
        code: code.code,
        id: code._id.toString(),
        joinedCount: code.joinedCount ?? 0,
        name: referrerName(leaderboardById.get(code.residentId.toString())),
        rewardCount: code.rewardCount ?? 0,
        roomType: leaderboardById.get(code.residentId.toString())?.roomType ?? "",
      })),
  };
}

/**
 * Records a payout decision on a confirmed referral's reward. Marking it PAID
 * also moves the referral itself to REWARDED so the two never disagree.
 */
export async function updateReferralReward(
  referralId: string,
  input: ReferralRewardUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const referral = await ReferralModel.findOne({
    _id: normalizeObjectId(referralId, "referral id"),
    isDeleted: false,
    ...scopedHostelFilter(principal, input.hostelId),
  }).lean<ReferralRecord | null>();

  if (!referral) {
    throw new ReferralServiceError("Referral was not found.", "REFERRAL_NOT_FOUND", 404);
  }

  if (referral.status === "INQUIRY_CREATED") {
    throw new ReferralServiceError(
      "Confirm the referral as joined before recording a reward.",
      "REFERRAL_NOT_CONFIRMED",
      409,
    );
  }

  const set: Record<string, unknown> = {
    hostelId: referral.hostelId,
    referrerResidentId: referral.referrerResidentId,
    status: input.status,
  };

  if (input.amount !== undefined) {
    set.amount = input.amount;
  }

  if (input.notes !== undefined) {
    set.notes = input.notes;
  }

  if (input.rewardType) {
    set.rewardType = input.rewardType;
  }

  if (input.status === "PAID") {
    set.approvedAt = new Date();
    set.approvedBy = principal.userId;
  }

  const reward = await ReferralRewardModel.findOneAndUpdate(
    { referralId: referral._id },
    { $set: set },
    { new: true, upsert: true },
  ).lean<ReferralRewardRecord | null>();

  const nextStatus = input.status === "PAID" ? "REWARDED" : referral.status;
  const updatedReferral = await ReferralModel.findOneAndUpdate(
    { _id: referral._id, isDeleted: false },
    { $set: { status: nextStatus, updatedBy: principal.userId } },
    { new: true },
  ).lean<ReferralRecord | null>();

  await auditReferralAction(principal, referral, "REFERRAL_REWARD_UPDATED", {
    amount: reward?.amount ?? 0,
    status: input.status,
  });

  return {
    referral: serializeReferral(updatedReferral ?? referral),
    reward: serializeReward(reward),
  };
}

export async function confirmReferralJoined(
  referralId: string,
  input: ReferralConfirmInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const referral = await ReferralModel.findOne({
    _id: normalizeObjectId(referralId, "referral id"),
    isDeleted: false,
    ...scopedHostelFilter(principal, input.hostelId),
  }).lean<ReferralRecord | null>();

  if (!referral) {
    throw new ReferralServiceError("Referral was not found.", "REFERRAL_NOT_FOUND", 404);
  }

  let joinedResidentId: Types.ObjectId | undefined;

  if (input.joinedResidentId) {
    const resident = await ResidentModel.findOne({
      _id: normalizeObjectId(input.joinedResidentId, "resident id"),
      hostelId: referral.hostelId,
      isDeleted: false,
    }).lean<ResidentRecord | null>();

    if (!resident) {
      throw new ReferralServiceError(
        "Joined resident was not found.",
        "RESIDENT_NOT_FOUND",
        404,
      );
    }

    joinedResidentId = resident._id;
  }

  const updatedReferral = await ReferralModel.findOneAndUpdate(
    { _id: referral._id, isDeleted: false },
    {
      $set: {
        confirmedAt: new Date(),
        confirmedBy: principal.userId,
        joinedResidentId,
        status: "JOINED",
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<ReferralRecord | null>();

  if (!updatedReferral) {
    throw new ReferralServiceError("Referral was not found.", "REFERRAL_NOT_FOUND", 404);
  }

  const reward = await ReferralRewardModel.findOneAndUpdate(
    { referralId: referral._id },
    {
      $set: {
        amount: input.rewardAmount,
        approvedAt: new Date(),
        approvedBy: principal.userId,
        hostelId: referral.hostelId,
        notes: input.rewardNotes,
        referrerResidentId: referral.referrerResidentId,
        rewardType: input.rewardType,
        status: input.rewardAmount > 0 ? "APPROVED" : "PENDING",
      },
    },
    { new: true, upsert: true },
  ).lean<ReferralRewardRecord | null>();

  await ReferralCodeModel.updateOne(
    { _id: referral.referralCodeId },
    {
      $inc: {
        joinedCount: 1,
        rewardCount: input.rewardAmount > 0 ? 1 : 0,
      },
    },
  );
  await auditReferralAction(principal, updatedReferral, "REFERRAL_JOINED_CONFIRMED", {
    rewardAmount: input.rewardAmount,
  });

  return {
    referral: serializeReferral(updatedReferral),
    reward: serializeReward(reward),
  };
}
