import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { escapeRegex } from "@/lib/validators";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { assertHostelAccess } from "@/lib/tenant";
import { Role } from "@/lib/roles";
import { demoteToPublicAccount } from "@/modules/auth/auth.service";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { EmergencyContactModel } from "@hostel/db/models/EmergencyContact";
import { GuardianModel } from "@hostel/db/models/Guardian";
import { HostelModel } from "@hostel/db/models/Hostel";
import { ResidentModel } from "@hostel/db/models/Resident";
import { UserModel } from "@hostel/db/models/User";
import { sendEmail } from "@hostel/shared/email/sender";
import { residentLinkedEmail } from "@hostel/shared/email/templates/resident/resident-linked";
import {
  assertActiveReferralCode,
  linkReferralOnRegistration,
} from "@/modules/referrals/referral.service";
import {
  registerOrUpgradeUserByEmail,
  UserServiceError,
} from "@/modules/users/user.service";
import {
  getIntakeQuote,
  raiseAdmissionInvoice,
} from "@/modules/residents/resident-intake.service";
import {
  claimBedForRoomType,
  moveBedBetweenRoomTypes,
  releaseBedForRoomType,
} from "@/modules/hostels/hostel-capacity.service";
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
  admissionFee?: number | null;
  admissionFeeDiscount?: number;
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
  referralCode?: string;
  residentType?: "STUDENT" | "WORKING_PROFESSIONAL" | "OTHER";
  roomType: string;
  status: ResidentStatus;
  updatedAt?: Date;
  userId?: Types.ObjectId;
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
    /** What was levied at intake. Null — not zero — when none was. */
    admissionFee: resident.admissionFee ?? null,
    admissionFeeDiscount: resident.admissionFeeDiscount ?? 0,
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
    referralCode: resident.referralCode ?? "",
    residentType: resident.residentType ?? "STUDENT",
    roomType: resident.roomType,
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

function residentDashboardUrl() {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/resident/dashboard`;
}

export type ResidentAccountLink = {
  /** Why the account was not linked, when it was not. */
  reason?: string;
  emailed: boolean;
  linked: boolean;
};

/**
 * Turns the resident's email into a working login the moment they are
 * registered — the same account upgrade a hostel owner gets when the platform
 * approves their hostel (ARCHITECTURE.md §3.2). A PUBLIC account keeps its
 * password and is simply promoted to RESIDENT, so the resident signs in the way
 * they always did and lands on /resident/dashboard.
 *
 * QR activation stays as the manual fallback: residents registered without an
 * email, or whose email already belongs to a staff account, still redeem a code.
 * Nothing here may fail the registration itself — the resident record and their
 * bed are already committed by the time this runs.
 */
async function linkResidentAccount(
  resident: ResidentRecord,
  hostelId: Types.ObjectId,
  principal: ApiPrincipal,
): Promise<ResidentAccountLink> {
  const email = resident.email?.trim().toLowerCase();

  if (!email) {
    return { emailed: false, linked: false, reason: "NO_EMAIL" };
  }

  // Only ever promotes an account the resident already owns. If they have none,
  // creating one would mean mailing them a temporary password — and residents
  // are never sent credentials — so QR activation takes over instead.
  const existingAccount = await UserModel.findOne({
    email,
    isDeleted: { $ne: true },
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();

  if (!existingAccount) {
    return { emailed: false, linked: false, reason: "NO_ACCOUNT" };
  }

  try {
    const hostel = await HostelModel.findById(hostelId)
      .select("name")
      .lean<{ name?: string } | null>();

    const upgrade = await registerOrUpgradeUserByEmail({
      email,
      hostelId: hostelId.toString(),
      hostelName: hostel?.name,
      // Their own password / Google sign-in stays exactly as it was.
      issueTemporaryPassword: false,
      name: `${resident.firstName} ${resident.lastName}`.trim(),
      performedBy: principal.userId,
      phone: resident.phone,
      role: Role.RESIDENT,
      // The generic "account upgraded" mail is replaced by a resident-specific
      // welcome below, sent only once the link actually holds.
      sendEmailNotification: false,
    });

    const userId = normalizeObjectId(upgrade.user.id, "user id");

    // Same guard the QR flow enforces: one live resident profile per account,
    // so a returning resident cannot end up occupying two beds at once.
    const conflicting = await ResidentModel.findOne({
      _id: { $ne: resident._id },
      isDeleted: false,
      status: { $in: ["ACTIVE", "PENDING"] },
      userId,
    }).lean<ResidentRecord | null>();

    if (conflicting) {
      return { emailed: false, linked: false, reason: "ACCOUNT_ALREADY_LINKED" };
    }

    await ResidentModel.updateOne(
      { _id: resident._id, isDeleted: false },
      {
        $set: {
          status: "ACTIVE",
          updatedBy: principal.userId,
          userId,
        },
      },
    );

    await auditResidentAction(
      principal,
      hostelId,
      resident._id,
      "RESIDENT_ACCOUNT_LINKED",
      { created: upgrade.created, email, upgraded: upgrade.upgraded },
    );

    // Never blocks the link: a bounced welcome mail must not leave the resident
    // unable to reach a portal they can already sign in to.
    let emailed = false;

    try {
      await sendEmail({
        to: email,
        ...residentLinkedEmail({
          dashboardUrl: residentDashboardUrl(),
          hostelName: hostel?.name ?? "your hostel",
          residentName: resident.firstName,
        }),
      });
      emailed = true;
    } catch {
      emailed = false;
    }

    return {
      emailed,
      linked: true,
    };
  } catch (error) {
    // A staff account on the same address, a bounced email — the resident is
    // registered either way and can still be activated by QR code.
    return {
      emailed: false,
      linked: false,
      reason: error instanceof UserServiceError ? error.errorCode : "ACCOUNT_LINK_FAILED",
    };
  }
}

/** True for a MongoServerError raised by a unique-index violation. */
function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Which field a duplicate-key error was actually about.
 *
 * There are two unique indexes on a resident now, so mapping every E11000 to
 * "phone taken" would tell an admin to change a number that was never the
 * problem. Mongo names the offending index in `keyPattern`; when the driver
 * gives us neither that nor `keyValue` we fall back to the phone, which is the
 * older and far more common collision.
 */
function duplicateKeyField(error: unknown): "email" | "phone" {
  const key = (error as { keyPattern?: Record<string, unknown> })?.keyPattern;

  return key && "email" in key ? "email" : "phone";
}

/**
 * The email as it is stored — `Resident.email` carries `lowercase: true`, so a
 * query built from raw form input would miss `Asha@Gmail.com` against the
 * `asha@gmail.com` already on the roll. Empty string and whitespace collapse to
 * `undefined`: "no email" is not a value two residents can collide on.
 */
function normalizedEmail(email: string | undefined): string | undefined {
  return email?.trim().toLowerCase() || undefined;
}

export async function createResident(
  input: ResidentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);

  const email = normalizedEmail(input.email);

  /*
   * Checked before the bed is claimed so a duplicate never spends and refunds a
   * unit of vacancy. Soft-deleted residents are excluded on purpose: removing
   * someone has to free their phone number for a later re-registration.
   *
   * **Email is checked here too, and it was not before.** An admin who hit the
   * phone conflict, changed the number and submitted again registered the same
   * person twice — same mailbox, two resident records, and `linkResidentAccount`
   * then refusing the second one with `ACCOUNT_ALREADY_LINKED` because one
   * account cannot hold two live resident profiles. The number was the only
   * thing the hostel was ever asked to keep unique; the mailbox is what actually
   * identifies the person to the product, because it is what they sign in with.
   *
   * One query, not two: this runs on the slowest path in the portal and a second
   * round trip for the second field would be paid on every intake.
   */
  const existing = await ResidentModel.findOne({
    hostelId,
    isDeleted: false,
    ...(email
      ? { $or: [{ phone: input.phone }, { email }] }
      : { phone: input.phone }),
  }).lean<ResidentRecord>();

  if (existing) {
    const onPhone = existing.phone === input.phone;

    throw new ResidentServiceError(
      onPhone
        ? `${existing.firstName} ${existing.lastName} is already registered here with the phone ${input.phone}.`
        : `${existing.firstName} ${existing.lastName} is already registered here with the email ${email}. Use a different address, or edit the resident that already exists.`,
      onPhone ? "RESIDENT_PHONE_TAKEN" : "RESIDENT_EMAIL_TAKEN",
      409,
    );
  }

  // A mistyped referral code fails here, before any bed is spent — the admin
  // clears the field and retries rather than losing the whole intake.
  if (input.referralCode) {
    await assertActiveReferralCode(input.referralCode, hostelId);
  }

  /*
   * The price is resolved here, not received. The screen showed the same figures
   * before the warden pressed the button, but quoting again at the moment of
   * writing is what makes them true: a rate card can be replaced between opening
   * the form and submitting it, and the number that goes on the invoice has to
   * be the one in force now rather than the one on somebody's screen.
   */
  const quote = await getIntakeQuote(hostelId, {
    moveInDate: input.moveInDate,
    referralCode: input.referralCode,
    roomType: input.roomType,
  });

  // Claim the bed before creating the resident: if the room type is full this
  // throws and no half-registered resident is left behind.
  await claimBedForRoomType(hostelId, input.roomType);

  let resident;

  try {
    resident = await ResidentModel.create({
      ...definedUpdate(input, ["depositAmount", "referralCode"]),
      admissionFee: quote.admissionFee > 0 ? quote.admissionFee : null,
      admissionFeeDiscount: quote.referral.discount,
      createdBy: principal.userId,
      // What was actually collected when it was said, the rate card's figure
      // otherwise. Not `?? 0`: a schedule that names a deposit is the answer to
      // a form that left the box alone.
      depositAmount: input.depositAmount ?? quote.depositAmount,
      hostelId,
      isDeleted: false,
      referralCode: quote.referral.code ?? undefined,
      updatedBy: principal.userId,
    });
  } catch (error) {
    // Duplicate phone, validation failure — give the bed back rather than
    // leaking a unit of vacancy on every failed intake.
    await releaseBedForRoomType(hostelId, input.roomType);

    // Two intakes racing on the same number or mailbox land here; the check
    // above only narrows the window, the index is what actually closes it.
    if (isDuplicateKeyError(error)) {
      const field = duplicateKeyField(error);

      throw new ResidentServiceError(
        field === "email"
          ? `Someone is already registered here with the email ${email}.`
          : `Someone is already registered here with the phone ${input.phone}.`,
        field === "email" ? "RESIDENT_EMAIL_TAKEN" : "RESIDENT_PHONE_TAKEN",
        409,
      );
    }

    throw error;
  }

  await auditResidentAction(principal, hostelId, resident._id, "RESIDENT_CREATED", {
    roomType: input.roomType,
  });

  const referral = input.referralCode
    ? await linkReferralOnRegistration({
        code: input.referralCode,
        hostelId,
        joinedResidentId: resident._id,
        name: `${input.firstName} ${input.lastName}`.trim(),
        phone: input.phone,
        principal,
      })
    : null;

  // Last, and never fatally: the resident is registered by this point, so an
  // admission fee that cannot be invoiced is a reason returned to the screen,
  // not an error that tells the hostel their intake failed when it did not.
  const admission = await raiseAdmissionInvoice({
    dueDate: input.moveInDate,
    hostelId,
    principal,
    quote,
    residentId: resident._id,
  });

  const accountLink = await linkResidentAccount(
    resident as ResidentRecord,
    hostelId,
    principal,
  );

  return {
    accountLink,
    admission,
    quote,
    referral,
    resident: serializeResident(
      (accountLink.linked
        ? await ResidentModel.findById(resident._id).lean<ResidentRecord>()
        : resident) as ResidentRecord,
    ),
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
    // Escaped — the search box feeds this straight into a Mongo pattern.
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { phone: pattern },
      { email: pattern },
    ];
  }

  const { limit, skip } = paginationRange(query);

  const [residents, total] = await Promise.all([
    ResidentModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ResidentRecord[]>(),
    ResidentModel.countDocuments(filter),
  ]);

  return {
    pagination: paginationMeta(query, total),
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

  // Editing a phone onto one that is already on the roll would otherwise
  // surface as a raw duplicate-key 500.
  if (input.phone && input.phone !== resident.phone) {
    const phoneTaken = await ResidentModel.exists({
      _id: { $ne: resident._id },
      hostelId: resident.hostelId,
      isDeleted: false,
      phone: input.phone,
    });

    if (phoneTaken) {
      throw new ResidentServiceError(
        `Someone is already registered here with the phone ${input.phone}.`,
        "RESIDENT_PHONE_TAKEN",
        409,
      );
    }
  }

  // Same rule as intake, and for the same reason: the edit form is the other
  // door onto the roll, and a uniqueness rule that only one door enforces is
  // not a rule.
  const nextEmail = normalizedEmail(input.email);

  if (nextEmail && nextEmail !== normalizedEmail(resident.email)) {
    const emailTaken = await ResidentModel.exists({
      _id: { $ne: resident._id },
      email: nextEmail,
      hostelId: resident.hostelId,
      isDeleted: false,
    });

    if (emailTaken) {
      throw new ResidentServiceError(
        `Someone is already registered here with the email ${nextEmail}.`,
        "RESIDENT_EMAIL_TAKEN",
        409,
      );
    }
  }

  // Switching room type moves a unit of vacancy from one type to the other.
  // Done before the write so a full destination type aborts the whole update.
  if (input.roomType && input.roomType !== resident.roomType) {
    await moveBedBetweenRoomTypes(resident.hostelId, resident.roomType, input.roomType);
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

  // Moving out frees their bed. Guarded on the previous status so re-saving an
  // already MOVED_OUT resident does not hand back a second bed.
  if (input.status === "MOVED_OUT" && resident.status !== "MOVED_OUT") {
    await releaseBedForRoomType(resident.hostelId, resident.roomType);
  }

  // Marking someone active by hand has to give them a working login too,
  // otherwise the status says ACTIVE while their account is still PUBLIC and
  // signing in drops them on the public home page. Residents created before
  // auto-linking existed reach their portal through exactly this path.
  const accountLink =
    input.status === "ACTIVE" && !resident.userId
      ? await linkResidentAccount(updatedResident, resident.hostelId, principal)
      : { emailed: false, linked: Boolean(resident.userId) };

  await auditResidentAction(
    principal,
    resident.hostelId,
    resident._id,
    "RESIDENT_STATUS_UPDATED",
    { status: input.status },
  );

  return {
    accountLink,
    resident: serializeResident(
      accountLink.linked && !resident.userId
        ? ((await ResidentModel.findById(resident._id).lean<ResidentRecord>()) ??
            updatedResident)
        : updatedResident,
    ),
  };
}

/**
 * Guardian + emergency records already on file for a resident. When the intake
 * form was filled from a resident ID these exist from the moment the resident
 * is created, so the admin panel can show them instead of a blank form.
 */
export async function listResidentContacts(
  residentId: string,
  query: { hostelId?: string },
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal, query.hostelId);
  const [guardians, emergencyContacts] = await Promise.all([
    GuardianModel.find({ residentId: resident._id })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean<GuardianRecord[]>(),
    EmergencyContactModel.find({ residentId: resident._id })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean<EmergencyContactRecord[]>(),
  ]);

  return {
    emergencyContacts: emergencyContacts.map(serializeEmergencyContact),
    guardians: guardians.map(serializeGuardian),
  };
}

/**
 * Soft-deletes a resident and hands their bed back. Soft because payments,
 * complaints and audit rows still reference the id; every read path already
 * filters on `isDeleted: false`.
 */
export async function deleteResident(
  residentId: string,
  query: { hostelId?: string },
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const resident = await findResidentForPrincipal(residentId, principal, query.hostelId);

  await ResidentModel.updateOne(
    { _id: resident._id, isDeleted: false },
    {
      $set: {
        deletedAt: new Date(),
        deletedBy: principal.userId,
        isDeleted: true,
        updatedBy: principal.userId,
      },
    },
  );

  // A resident who already moved out gave their bed back then; releasing again
  // would invent a unit of vacancy.
  if (resident.status !== "MOVED_OUT") {
    await releaseBedForRoomType(resident.hostelId, resident.roomType);
  }

  // The account outlives the resident profile: losing your room does not lose
  // you your login. Drop this hostel from its scope and, once no resident
  // profile is left anywhere, hand the account back its plain public role — the
  // state it was in before a hostel took it on. Without this it keeps the
  // RESIDENT role and keeps landing on a resident dashboard whose every call
  // now 404s.
  if (resident.userId) {
    const stillResidentElsewhere = await ResidentModel.exists({
      _id: { $ne: resident._id },
      isDeleted: false,
      status: { $in: ["ACTIVE", "PENDING"] },
      userId: resident.userId,
    });

    await UserModel.updateOne(
      { _id: resident.userId },
      { $pull: { hostelIds: resident.hostelId } },
    );

    if (!stillResidentElsewhere) {
      await demoteToPublicAccount(resident.userId);
    }
  }

  await auditResidentAction(
    principal,
    resident.hostelId,
    resident._id,
    "RESIDENT_DELETED",
    {
      roomType: resident.roomType,
      status: resident.status,
    },
  );

  return {
    residentId: resident._id.toString(),
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
