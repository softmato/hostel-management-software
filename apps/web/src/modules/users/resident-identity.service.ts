import { randomInt } from "node:crypto";

import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import {
  decryptPersonalData,
  encryptPersonalData,
} from "@/lib/personal-data-crypto";
import { siteUrl } from "@/lib/site";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelPageViewModel } from "@hostel/db/models/HostelPageView";
import { InquiryModel } from "@hostel/db/models/Inquiry";
import { NotificationModel } from "@hostel/db/models/Notification";
import { UserModel } from "@hostel/db/models/User";
import { UserResidentProfileModel } from "@hostel/db/models/UserResidentProfile";
import type {
  ResidentProfileData,
  residentIdentitySaveSchema,
} from "@/modules/users/resident-identity.validation";
import type { z } from "zod";

type ResidentIdentitySaveInput = z.infer<typeof residentIdentitySaveSchema>;

type UserRecord = {
  _id: Types.ObjectId;
  email?: string | null;
  name: string;
  userResidentId?: string | null;
};

type ProfileRecord = {
  _id: Types.ObjectId;
  completedAt?: Date;
  encryptedData: string;
  lastSharedAt?: Date;
  shareCount?: number;
  sharingEnabled?: boolean;
  updatedAt?: Date;
  userId: Types.ObjectId;
};

export class ResidentIdentityError extends Error {
  constructor(
    message: string,
    public errorCode = "RESIDENT_IDENTITY_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * How many hostel detail pages someone browses before we consider them a
 * genuine room-hunter and offer the one-time profile form.
 */
export const PROFILE_PROMPT_VIEW_THRESHOLD = 3;

/*
 * Crockford-style alphabet: no I, L, O, U, 0 or 1, because this id gets read
 * off a phone screen and typed into a warden's laptop by hand.
 */
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_BLOCK_LENGTH = 4;

function randomIdBlock() {
  let block = "";

  for (let index = 0; index < ID_BLOCK_LENGTH; index += 1) {
    block += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  }

  return block;
}

function generateResidentId() {
  return `HH-${randomIdBlock()}-${randomIdBlock()}`;
}

/** Strips formatting so `hh 4k7m-9xq2` and a scanned URL both resolve. */
export function normalizeResidentId(value: string) {
  // Drop any query/hash first — otherwise `/resident-id/HH-…?utm=qr` would
  // resolve to the tracking parameter instead of the id.
  const path = value.trim().split(/[?#]/)[0] ?? "";
  const tail = path.split("/").filter(Boolean).pop() ?? path;
  const compact = tail.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!/^HH[A-Z0-9]{8}$/.test(compact)) {
    return null;
  }

  return `HH-${compact.slice(2, 6)}-${compact.slice(6, 10)}`;
}

export function residentIdShareUrl(residentId: string) {
  return `${siteUrl()}/resident-id/${encodeURIComponent(residentId)}`;
}

async function mintResidentId(userId: string) {
  // Collisions are vanishingly unlikely (30^8) but the unique index is the real
  // guard; retry a few times rather than failing the user's first save.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateResidentId();
    const taken = await UserModel.exists({ userResidentId: candidate });

    if (taken) {
      continue;
    }

    const updated = await UserModel.findOneAndUpdate(
      { _id: userId, userResidentId: { $in: [null, ""] } },
      { $set: { userResidentId: candidate } },
      { new: true },
    ).lean<UserRecord | null>();

    // Another concurrent save won the race and already set one — use theirs.
    if (updated?.userResidentId) {
      return updated.userResidentId;
    }

    const current = await UserModel.findById(userId)
      .select("userResidentId")
      .lean<UserRecord | null>();

    if (current?.userResidentId) {
      return current.userResidentId;
    }
  }

  throw new ResidentIdentityError(
    "Could not allocate a resident ID. Please try again.",
    "RESIDENT_ID_ALLOCATION_FAILED",
    500,
  );
}

function ageFromDateOfBirth(dateOfBirth?: string) {
  if (!dateOfBirth) {
    return null;
  }

  const born = new Date(dateOfBirth);

  if (Number.isNaN(born.getTime())) {
    return null;
  }

  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
    age -= 1;
  }

  return age >= 0 && age < 130 ? age : null;
}

function readProfile(record: ProfileRecord) {
  return decryptPersonalData<ResidentProfileData>(record.encryptedData);
}

async function renderQrDataUrl(text: string) {
  try {
    const { toDataURL } = await import("qrcode");

    return await toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 420,
    });
  } catch {
    // The modal still shows the typed id, which is the manual-entry path.
    return null;
  }
}

export async function getResidentIdentity(userId: string) {
  await connectToDatabase();

  const user = await UserModel.findOne({ _id: userId, isDeleted: { $ne: true } })
    .select("email name userResidentId")
    .lean<UserRecord | null>();

  if (!user) {
    throw new ResidentIdentityError("User was not found.", "USER_NOT_FOUND", 404);
  }

  const record = await UserResidentProfileModel.findOne({
    isDeleted: { $ne: true },
    userId: user._id,
  }).lean<ProfileRecord | null>();

  const profile = record ? readProfile(record) : null;

  return {
    identity: {
      accountEmail: user.email ?? null,
      accountName: user.name,
      hasProfile: Boolean(record?.completedAt),
      lastSharedAt: record?.lastSharedAt?.toISOString() ?? null,
      residentId: user.userResidentId ?? null,
      shareCount: record?.shareCount ?? 0,
      shareUrl: user.userResidentId ? residentIdShareUrl(user.userResidentId) : null,
      sharingEnabled: record?.sharingEnabled ?? true,
      updatedAt: record?.updatedAt?.toISOString() ?? null,
    },
    profile: profile ? { ...profile, age: ageFromDateOfBirth(profile.dateOfBirth) } : null,
  };
}

export async function getResidentIdentityQr(userId: string) {
  const { identity } = await getResidentIdentity(userId);

  if (!identity.residentId || !identity.shareUrl) {
    throw new ResidentIdentityError(
      "Save your resident profile first to get a QR code.",
      "RESIDENT_PROFILE_MISSING",
      404,
    );
  }

  return {
    qrDataUrl: await renderQrDataUrl(identity.shareUrl),
    residentId: identity.residentId,
    shareUrl: identity.shareUrl,
  };
}

export async function saveResidentIdentity(
  userId: string,
  input: ResidentIdentitySaveInput,
) {
  await connectToDatabase();

  const user = await UserModel.findOne({ _id: userId, isDeleted: { $ne: true } })
    .select("email name userResidentId")
    .lean<UserRecord | null>();

  if (!user) {
    throw new ResidentIdentityError("User was not found.", "USER_NOT_FOUND", 404);
  }

  const residentId = user.userResidentId || (await mintResidentId(userId));

  await UserResidentProfileModel.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        completedAt: new Date(),
        encryptedData: encryptPersonalData(input.profile),
        isDeleted: false,
        payloadVersion: 1,
        sharingEnabled: input.sharingEnabled,
        updatedBy: user._id,
      },
      $setOnInsert: { createdBy: user._id },
    },
    { new: true, upsert: true },
  );

  await AuditLogModel.create({
    action: "RESIDENT_PROFILE_SAVED",
    actorId: user._id,
    entityId: residentId,
    entityType: "UserResidentProfile",
    metadata: { sharingEnabled: input.sharingEnabled },
  });

  return getResidentIdentity(userId);
}

export async function setResidentIdentitySharing(userId: string, enabled: boolean) {
  await connectToDatabase();

  const updated = await UserResidentProfileModel.findOneAndUpdate(
    { isDeleted: { $ne: true }, userId: normalizeUserId(userId) },
    { $set: { sharingEnabled: enabled } },
    { new: true },
  ).lean<ProfileRecord | null>();

  if (!updated) {
    throw new ResidentIdentityError(
      "You have not saved a resident profile yet.",
      "RESIDENT_PROFILE_MISSING",
      404,
    );
  }

  return getResidentIdentity(userId);
}

function normalizeUserId(value: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new ResidentIdentityError("Invalid user id.", "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

/** Guardian is stored as one name but persisted as first + last. */
function splitName(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] ?? value,
    lastName: parts.slice(1).join(" ") || parts[0] || value,
  };
}

/**
 * Turns a saved profile into exactly the fields the hostel-admin "Register New
 * Resident" form needs, so the warden reviews prefilled inputs instead of
 * transcribing them.
 */
function toResidentPrefill(profile: ResidentProfileData) {
  const [firstName, ...restName] = profile.fullName.split(/\s+/).filter(Boolean);
  const guardians = [
    {
      email: profile.guardianEmail,
      ...splitName(profile.guardianName),
      isPrimary: true,
      phone: profile.guardianPhone,
      relation: profile.guardianRelation,
    },
  ];

  if (profile.secondGuardianName && profile.secondGuardianPhone) {
    guardians.push({
      email: profile.secondGuardianEmail,
      ...splitName(profile.secondGuardianName),
      isPrimary: false,
      phone: profile.secondGuardianPhone,
      relation: profile.secondGuardianRelation ?? "Guardian",
    });
  }

  const emergencyContact =
    profile.emergencyContactName && profile.emergencyContactPhone
      ? {
          isPrimary: true,
          name: profile.emergencyContactName,
          phone: profile.emergencyContactPhone,
          relation: profile.emergencyContactRelation ?? "Emergency contact",
        }
      : {
          isPrimary: true,
          name: profile.guardianName,
          phone: profile.guardianPhone,
          relation: profile.guardianRelation,
        };

  return {
    emergencyContact,
    guardians,
    resident: {
      email: profile.primaryEmail,
      firstName: firstName ?? profile.fullName,
      lastName: restName.join(" ") || firstName || profile.fullName,
      phone: profile.primaryPhone,
      residentType: profile.occupation,
    },
    details: {
      age: ageFromDateOfBirth(profile.dateOfBirth),
      alternatePhone: profile.alternatePhone ?? null,
      backupEmail: profile.backupEmail ?? null,
      bloodGroup: profile.bloodGroup,
      budgetRange: profile.budgetRange ?? null,
      city: profile.city ?? null,
      courseOrDesignation: profile.courseOrDesignation ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      dietaryPreference: profile.dietaryPreference,
      gender: profile.gender,
      governmentIdNumber: profile.governmentIdNumber ?? null,
      governmentIdType: profile.governmentIdType ?? null,
      institution: profile.institution ?? null,
      interests: profile.interests,
      medicalNotes: profile.medicalNotes ?? null,
      permanentAddress: profile.permanentAddress ?? null,
      province: profile.province ?? null,
    },
  };
}

/**
 * Staff-only. Every successful read is audited and the owner is notified in-app,
 * because handing a hostel someone's guardian numbers and blood group should
 * never be silent.
 */
export async function lookupResidentProfile(
  residentIdInput: string,
  principal: ApiPrincipal,
  hostelId?: string,
) {
  await connectToDatabase();

  const residentId = normalizeResidentId(residentIdInput);

  if (!residentId) {
    throw new ResidentIdentityError(
      "That does not look like a resident ID. It should read like HH-4K7M-9XQ2.",
      "RESIDENT_ID_INVALID",
      422,
    );
  }

  const user = await UserModel.findOne({
    isDeleted: { $ne: true },
    userResidentId: residentId,
  })
    .select("email name userResidentId")
    .lean<UserRecord | null>();

  if (!user) {
    throw new ResidentIdentityError(
      "No resident profile matches that ID.",
      "RESIDENT_PROFILE_NOT_FOUND",
      404,
    );
  }

  const record = await UserResidentProfileModel.findOne({
    isDeleted: { $ne: true },
    userId: user._id,
  }).lean<ProfileRecord | null>();

  if (!record?.completedAt) {
    throw new ResidentIdentityError(
      "That resident has not finished their profile yet.",
      "RESIDENT_PROFILE_INCOMPLETE",
      404,
    );
  }

  if (record.sharingEnabled === false) {
    throw new ResidentIdentityError(
      "That resident has turned off profile sharing.",
      "RESIDENT_PROFILE_SHARING_DISABLED",
      403,
    );
  }

  const scopedHostelId =
    hostelId && Types.ObjectId.isValid(hostelId)
      ? new Types.ObjectId(hostelId)
      : principal.hostelIds.find((id) => Types.ObjectId.isValid(id))
        ? new Types.ObjectId(principal.hostelIds[0])
        : undefined;

  await UserResidentProfileModel.updateOne(
    { _id: record._id },
    {
      $inc: { shareCount: 1 },
      $set: {
        lastSharedAt: new Date(),
        ...(scopedHostelId ? { lastSharedWithHostelId: scopedHostelId } : {}),
      },
    },
  );

  await AuditLogModel.create({
    action: "RESIDENT_PROFILE_SHARED",
    actorId: principal.userId,
    entityId: residentId,
    entityType: "UserResidentProfile",
    ...(scopedHostelId ? { hostelId: scopedHostelId } : {}),
    metadata: { residentId, subjectUserId: user._id.toString() },
  });

  await NotificationModel.create({
    body: "A hostel used your resident ID to fill in your details. If this was not you, turn off sharing from your profile menu.",
    category: "ACCOUNT",
    channel: "IN_APP",
    data: { residentId },
    ...(scopedHostelId ? { hostelId: scopedHostelId } : {}),
    status: "SENT",
    title: "Your resident profile was shared",
    userId: user._id,
  }).catch(() => null);

  return {
    prefill: toResidentPrefill(readProfile(record)),
    residentId,
    sharedAt: new Date().toISOString(),
  };
}

/**
 * Decides whether to interrupt a visitor with the one-time profile form. We ask
 * after they commit (an inquiry) or after they have clearly been shopping
 * around ({@link PROFILE_PROMPT_VIEW_THRESHOLD} hostel pages) — never on a first
 * visit, and never once a profile exists.
 */
export async function evaluateProfilePrompt(options: {
  userId?: string;
  visitorKey: string;
}) {
  await connectToDatabase();

  if (options.userId) {
    const existing = await UserResidentProfileModel.findOne({
      completedAt: { $ne: null },
      isDeleted: { $ne: true },
      userId: normalizeUserId(options.userId),
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>();

    if (existing) {
      return { reason: null, shouldCollectProfile: false, viewedHostels: 0, views: 0 };
    }
  }

  const viewFilter = options.userId
    ? { userId: normalizeUserId(options.userId) }
    : { visitorKey: options.visitorKey };

  // Total visits, not distinct hostels: coming back to the same hostel three
  // times is as strong a buying signal as looking at three different ones, and
  // a small catalogue would otherwise never reach the threshold. The rows are
  // already de-duplicated per 30-minute window, so these are real return trips.
  const [totalViews, distinctHostels] = await Promise.all([
    HostelPageViewModel.countDocuments(viewFilter),
    HostelPageViewModel.distinct("hostelId", viewFilter),
  ]);

  if (totalViews >= PROFILE_PROMPT_VIEW_THRESHOLD) {
    return {
      reason: "BROWSING" as const,
      shouldCollectProfile: true,
      viewedHostels: distinctHostels.length,
      views: totalViews,
    };
  }

  return {
    reason: null,
    shouldCollectProfile: false,
    viewedHostels: distinctHostels.length,
    views: totalViews,
  };
}

/** Same question, asked right after someone submits an inquiry. */
export async function shouldPromptAfterInquiry(userId?: string, email?: string) {
  await connectToDatabase();

  if (userId) {
    const existing = await UserResidentProfileModel.findOne({
      completedAt: { $ne: null },
      isDeleted: { $ne: true },
      userId: normalizeUserId(userId),
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>();

    return !existing;
  }

  if (!email) {
    return true;
  }

  // Signed-out enquirers get asked too — a repeat enquirer benefits most.
  const priorInquiries = await InquiryModel.countDocuments({
    email: email.toLowerCase(),
    isDeleted: false,
  });

  return priorInquiries >= 1;
}
