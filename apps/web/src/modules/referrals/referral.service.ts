import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
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
  convertedCount?: number;
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
  converted?: boolean;
  convertedAt?: Date;
  convertedPaymentId?: Types.ObjectId;
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
    convertedCount: code.convertedCount ?? 0,
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
    converted: referral.converted ?? false,
    convertedAt: referral.convertedAt?.toISOString(),
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

/**
 * Resolves a typed or scanned referral code to its live row.
 *
 * `hostelId` is passed when the code has to belong to a specific hostel — a
 * resident of hostel A referring someone into hostel B would otherwise credit
 * the wrong leaderboard.
 */
async function findActiveReferralCode(code: string, hostelId?: Types.ObjectId) {
  const referralCode = await ReferralCodeModel.findOne({
    code: code.trim().toUpperCase(),
    status: "ACTIVE",
    ...(hostelId ? { hostelId } : {}),
  }).lean<ReferralCodeRecord | null>();

  if (!referralCode) {
    throw new ReferralServiceError(
      "Referral code was not found.",
      "REFERRAL_CODE_NOT_FOUND",
      404,
    );
  }

  return referralCode;
}

/**
 * Pre-flight check for resident intake: fails on a mistyped code *before* a bed
 * is claimed, so nothing has to be unwound.
 */
export async function assertActiveReferralCode(code: string, hostelId: Types.ObjectId) {
  await connectToDatabase();
  await findActiveReferralCode(code, hostelId);
}

/**
 * The same question as {@link assertActiveReferralCode}, answered rather than
 * thrown.
 *
 * The intake screen asks this while the warden is still typing, to quote what
 * the code is worth. A 404 there is not an error — it is "keep typing" — and
 * routing a half-entered code through the error path would flash a failure toast
 * at every keystroke.
 */
export async function isActiveReferralCode(code: string, hostelId: Types.ObjectId) {
  await connectToDatabase();

  const trimmed = code.trim();

  if (!trimmed) {
    return false;
  }

  return Boolean(
    await ReferralCodeModel.exists({
      code: trimmed.toUpperCase(),
      hostelId,
      status: "ACTIVE",
    }),
  );
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

  // Rewards are informational in v1 — nothing is paid out automatically, so the
  // resident sees what an admin has actually recorded against their referrals.
  const rewards =
    referrals.length > 0
      ? await ReferralRewardModel.find({
          referralId: { $in: referrals.map((referral) => referral._id) },
        }).lean<ReferralRewardRecord[]>()
      : [];
  const rewardByReferralId = new Map(
    rewards.map((reward) => [reward.referralId.toString(), reward]),
  );

  return {
    referralCode: serializeReferralCode(referralCode),
    referrals: referrals.map((referral) => ({
      ...serializeReferral(referral),
      reward: serializeReward(rewardByReferralId.get(referral._id.toString()) ?? null),
    })),
    resident: serializeResidentSummary(resident),
    summary: {
      converted: referrals.filter((referral) => referral.converted).length,
      joined: referrals.filter((referral) =>
        ["JOINED", "REWARDED"].includes(referral.status),
      ).length,
      rewardApprovedAmount: rewards
        .filter((reward) => reward.status === "APPROVED")
        .reduce((total, reward) => total + reward.amount, 0),
      rewardPaidAmount: rewards
        .filter((reward) => reward.status === "PAID")
        .reduce((total, reward) => total + reward.amount, 0),
      sent: referrals.length,
    },
  };
}

/**
 * Attaches a walk-in registration to the code that brought them in.
 *
 * Called from resident intake *before* the bed is claimed, so a mistyped code
 * fails the whole registration rather than half-creating a resident with no
 * referral — the admin can clear the field and retry.
 */
export async function linkReferralOnRegistration(input: {
  code: string;
  hostelId: Types.ObjectId;
  joinedResidentId: Types.ObjectId;
  name: string;
  phone: string;
  principal: ApiPrincipal;
}) {
  const referralCode = await findActiveReferralCode(input.code, input.hostelId);

  if (referralCode.residentId.equals(input.joinedResidentId)) {
    throw new ReferralServiceError(
      "A resident cannot refer themselves.",
      "REFERRAL_SELF_REFERENCE",
      422,
    );
  }

  // A referral may already exist from the public `?ref=` inquiry flow; that row
  // is the one to confirm, otherwise the same person shows up twice.
  const existing = await ReferralModel.findOne({
    hostelId: input.hostelId,
    isDeleted: false,
    phone: input.phone,
    referralCodeId: referralCode._id,
    status: { $ne: "CANCELLED" },
  }).lean<ReferralRecord | null>();

  const referral = existing
    ? await ReferralModel.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: {
            confirmedAt: new Date(),
            confirmedBy: input.principal.userId,
            joinedResidentId: input.joinedResidentId,
            status: "JOINED",
            updatedBy: input.principal.userId,
          },
        },
        { new: true },
      ).lean<ReferralRecord | null>()
    : ((await ReferralModel.create({
        confirmedAt: new Date(),
        confirmedBy: input.principal.userId,
        createdBy: input.principal.userId,
        hostelId: input.hostelId,
        joinedResidentId: input.joinedResidentId,
        name: input.name,
        phone: input.phone,
        referralCodeId: referralCode._id,
        referrerResidentId: referralCode.residentId,
        status: "JOINED",
      })) as ReferralRecord);

  if (!referral) {
    throw new ReferralServiceError("Referral was not found.", "REFERRAL_NOT_FOUND", 404);
  }

  // Only count the join once — an inquiry that was already confirmed by hand
  // must not add a second unit to the referrer's leaderboard total.
  if (!existing || existing.status === "INQUIRY_CREATED") {
    await ReferralCodeModel.updateOne(
      { _id: referralCode._id },
      { $inc: { joinedCount: 1 } },
    );
  }

  await auditReferralAction(
    input.principal,
    referral,
    "REFERRAL_JOINED_ON_REGISTRATION",
    {
      referralCode: referralCode.code,
    },
  );

  return {
    code: referralCode.code,
    referralId: referral._id.toString(),
    referrerResidentId: referralCode.residentId.toString(),
  };
}

/**
 * Flips a referral to converted the first time the person they brought in has a
 * payment verified. Idempotent and never throws: it runs after the money has
 * already been credited, so a referral bookkeeping problem must not turn a
 * successful verification into a failed request.
 */
export async function markReferralConverted(input: {
  hostelId: Types.ObjectId | string;
  paymentId: Types.ObjectId | string;
  residentId: Types.ObjectId | string;
}) {
  try {
    await connectToDatabase();

    const referral = await ReferralModel.findOneAndUpdate(
      {
        converted: { $ne: true },
        hostelId: input.hostelId,
        isDeleted: false,
        joinedResidentId: input.residentId,
      },
      {
        $set: {
          converted: true,
          convertedAt: new Date(),
          convertedPaymentId: input.paymentId,
        },
      },
      { new: true },
    ).lean<ReferralRecord | null>();

    if (!referral) {
      return { converted: false };
    }

    await ReferralCodeModel.updateOne(
      { _id: referral.referralCodeId },
      { $inc: { convertedCount: 1 } },
    );

    return { converted: true, referralId: referral._id.toString() };
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "referral_conversion_failed",
        message: error instanceof Error ? error.message : "Unknown referral error",
        residentId: input.residentId.toString(),
      }),
    );

    return { converted: false };
  }
}

export async function createReferredInquiry(input: ReferredInquiryCreateInput) {
  await connectToDatabase();

  const referralCode = await findActiveReferralCode(input.referralCode);

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

  const { limit, skip } = paginationRange(query);

  const [referrals, total] = await Promise.all([
    ReferralModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ReferralRecord[]>(),
    ReferralModel.countDocuments(filter),
  ]);
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

  /*
   * The summary describes every referral in the hostel scope, not the page and
   * not the current status filter. Deriving `byStatus` from the returned rows
   * would make the breakdown collapse to a single bucket the moment an admin
   * filtered by status, and shrink to the page size otherwise.
   */
  const summaryFilter = {
    isDeleted: false,
    ...scopedHostelFilter(principal, query.hostelId),
  };
  const [statusCounts, convertedTotal, rewardSums] = await Promise.all([
    ReferralModel.aggregate<{ _id: string; count: number }>([
      { $match: summaryFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    ReferralModel.countDocuments({ ...summaryFilter, converted: true }),
    ReferralRewardModel.aggregate<{ _id: string; amount: number }>([
      { $match: scopedHostelFilter(principal, query.hostelId) },
      { $group: { _id: "$status", amount: { $sum: "$amount" } } },
    ]),
  ]);
  const rewardByStatus = new Map(rewardSums.map((row) => [row._id, row.amount]));
  const rewardTotals = {
    approved: rewardByStatus.get("APPROVED") ?? 0,
    paid: rewardByStatus.get("PAID") ?? 0,
    pending: rewardByStatus.get("PENDING") ?? 0,
  };
  const byStatus = statusCounts.reduce<Record<string, number>>((counts, row) => {
    counts[row._id] = row.count;
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
    pagination: paginationMeta(query, total),
    summary: {
      byStatus,
      converted: convertedTotal,
      joined: (byStatus.JOINED ?? 0) + (byStatus.REWARDED ?? 0),
      pendingConfirmation: byStatus.INQUIRY_CREATED ?? 0,
      rewardApprovedAmount: rewardTotals.approved,
      rewardPaidAmount: rewardTotals.paid,
      rewardPendingAmount: rewardTotals.pending,
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
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

  // Confirming an already-confirmed referral (a second click, an edited reward)
  // must not add another join to the referrer's leaderboard total.
  const alreadyJoined = referral.status !== "INQUIRY_CREATED";

  await ReferralCodeModel.updateOne(
    { _id: referral.referralCodeId },
    {
      $inc: {
        joinedCount: alreadyJoined ? 0 : 1,
        rewardCount: input.rewardAmount > 0 && !alreadyJoined ? 1 : 0,
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
