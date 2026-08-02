import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { escapeRegex } from "@/lib/validators";
import { Role } from "@/lib/roles";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelApplicationModel } from "@hostel/db/models/HostelApplication";
import { HostelDocumentModel } from "@hostel/db/models/HostelDocument";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelVerificationModel } from "@hostel/db/models/HostelVerification";
import { InquiryModel } from "@hostel/db/models/Inquiry";
import { RatingReviewModel } from "@hostel/db/models/RatingReview";
import { UserModel } from "@hostel/db/models/User";
import { provisionCookAccount } from "@/modules/food/cook.service";
import { getFoodRoutine } from "@/modules/food/food-routine.service";
import { registerOrUpgradeUserByEmail } from "@/modules/users/user.service";
import { sendEmail } from "@hostel/shared/email/sender";
import { hostelApprovedEmail } from "@hostel/shared/email/templates/hostel/hostel-approved";
import { hostelPublishedEmail } from "@hostel/shared/email/templates/hostel/hostel-published";
import { hostelUnpublishedEmail } from "@hostel/shared/email/templates/hostel/hostel-unpublished";
import { hostelDocumentsRequestedEmail } from "@hostel/shared/email/templates/hostel/documents-requested";
import { hostelRejectedEmail } from "@hostel/shared/email/templates/hostel/hostel-rejected";
import { hostelSubmissionReceivedEmail } from "@hostel/shared/email/templates/hostel/submission-received";
import {
  notifyHostelOfInquiry,
  notifyPlatformOfPendingHostel,
} from "@/modules/hostels/hostel-notify";
import type {
  hostelRejectSchema,
  hostelRequestDocumentsSchema,
  hostelResubmitDocumentsSchema,
  hostelUnpublishSchema,
  platformHostelCreateSchema,
  platformHostelListQuerySchema,
  publicHostelCompareQuerySchema,
  publicHostelApplicationCreateSchema,
  publicInquiryCreateSchema,
  publicHostelListQuerySchema,
} from "@/modules/hostels/hostel.validation";
import type { z } from "zod";

type PlatformHostelCreateInput = z.infer<typeof platformHostelCreateSchema>;
type PublicHostelApplicationCreateInput = z.infer<
  typeof publicHostelApplicationCreateSchema
>;
type PlatformHostelListQuery = z.infer<typeof platformHostelListQuerySchema>;
type HostelRejectInput = z.infer<typeof hostelRejectSchema>;
type HostelRequestDocumentsInput = z.infer<typeof hostelRequestDocumentsSchema>;
type HostelUnpublishInput = z.infer<typeof hostelUnpublishSchema>;

/**
 * Result of trying to email a hostel owner about a review decision. Delivery
 * never fails the underlying action, so this is how the reviewer finds out the
 * owner was (or was not) actually reached.
 */
export type OwnerNotification = {
  reason?: "no_owner_email" | "not_configured" | "send_failed";
  sent: boolean;
  to?: string;
};
type HostelResubmitDocumentsInput = z.infer<typeof hostelResubmitDocumentsSchema>;
type PublicHostelListQuery = z.infer<typeof publicHostelListQuerySchema>;
type PublicHostelCompareQuery = z.infer<typeof publicHostelCompareQuerySchema>;
type PublicInquiryCreateInput = z.infer<typeof publicInquiryCreateSchema>;

export type HostelRecord = {
  _id: Types.ObjectId;
  capacitySummary?: {
    totalBeds?: number;
    totalRooms?: number;
    vacantBeds?: number;
  };
  contact?: {
    email?: string;
    phone?: string;
  };
  createdAt?: Date;
  totalFloors?: number;
  demoDataLabel?: string;
  description?: string;
  facilities?: string[];
  food?: {
    hasNonVeg?: boolean;
    hasVeg?: boolean;
    mealsPerDay?: number;
    notes?: string;
  };
  hostelType?: "BOYS" | "GIRLS" | "CO_LIVING";
  isDemoData?: boolean;
  location: {
    address?: string;
    area: string;
    city?: string;
    lat?: number;
    lng?: number;
    locationSource?: "MANUAL" | "GEOCODED";
    province?: string;
  };
  name: string;
  nameChangeCount?: number;
  nearbyPlaces?: Array<{
    coordinates?: { lat?: number; lng?: number };
    distance?: number;
    name?: string;
    type?: string;
  }>;
  nearbyPlacesLastUpdated?: Date;
  ownerId: Types.ObjectId;
  photos?: Array<{
    _id?: Types.ObjectId;
    alt?: string;
    fileAssetId?: Types.ObjectId;
    kind?: "EXTERIOR" | "INTERIOR" | "ROOM";
    /** Set only on ROOM photos — matches roomConfigurations[].roomType. */
    roomType?: string;
    url?: string;
  }>;
  pricing?: {
    admissionFee?: number;
    currency?: string;
    monthlyRentMax?: number;
    monthlyRentMin?: number;
  };
  roomConfigurations?: Array<{
    _id?: Types.ObjectId;
    bedsPerRoom?: number;
    mealInclusion?: "Included" | "Not Included" | "Optional";
    monthlyRent?: number;
    rooms?: number;
    roomType: string;
    vacantBeds?: number;
  }>;
  roomTypes?: string[];
  rules?: string[];
  slug: string;
  status:
    | "DRAFT"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "PUBLISHED"
    | "REJECTED"
    | "SUSPENDED";
  updatedAt?: Date;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
};

type HostelApplicationRecord = {
  _id: Types.ObjectId;
  applicantId: Types.ObjectId;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  infoRequestNote?: string;
  infoRequestedAt?: Date;
  notes?: string;
  rejectionReason?: string;
  requestedDocuments?: { documentType: string; note?: string }[];
  reviewedAt?: Date;
  snapshot?: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO";
  submittedBy: Types.ObjectId;
  updatedAt?: Date;
};

type UserOwnerRecord = {
  _id: Types.ObjectId;
  role?: string;
};

type HostelStatus = HostelRecord["status"];

type RatingSummaryRecord = {
  _id: Types.ObjectId;
  averageRating: number;
  cleanlinessRating: number;
  foodRating: number;
  safetyRating: number;
  total: number;
};

export class HostelServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "HOSTEL_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

export function normalizeObjectId(value: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new HostelServiceError("Invalid hostel id.", "INVALID_HOSTEL_ID", 422);
  }

  return new Types.ObjectId(value);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(name: string, area: string) {
  const baseSlug = slugify(`${name}-${area}`) || `hostel-${Date.now()}`;
  let candidate = baseSlug;
  let suffix = 2;

  while (await HostelModel.exists({ slug: candidate })) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function serializeRoomConfigurations(hostel: HostelRecord) {
  return (hostel.roomConfigurations ?? []).map((config) => ({
    bedsPerRoom: config.bedsPerRoom ?? 0,
    id: config._id?.toString(),
    mealInclusion: config.mealInclusion ?? "Included",
    monthlyRent: config.monthlyRent ?? 0,
    rooms: config.rooms ?? 0,
    roomType: config.roomType,
    vacantBeds: config.vacantBeds ?? 0,
  }));
}

export function serializeHostel(hostel: HostelRecord) {
  return {
    capacitySummary: hostel.capacitySummary ?? {},
    contact: hostel.contact ?? {},
    createdAt: hostel.createdAt?.toISOString(),
    demoDataLabel: hostel.demoDataLabel ?? "",
    description: hostel.description ?? "",
    facilities: hostel.facilities ?? [],
    food: hostel.food ?? {},
    hostelType: hostel.hostelType ?? "CO_LIVING",
    id: hostel._id.toString(),
    isDemoData: Boolean(hostel.isDemoData),
    location: hostel.location,
    name: hostel.name,
    nameChangeCount: hostel.nameChangeCount ?? 0,
    ownerId: hostel.ownerId.toString(),
    photos: (hostel.photos ?? []).map((photo) => ({
      alt: photo.alt ?? "",
      fileAssetId: photo.fileAssetId?.toString(),
      id: photo._id?.toString(),
      kind: photo.kind ?? "INTERIOR",
      roomType: photo.roomType ?? "",
      url: photo.url ?? "",
    })),
    pricing: hostel.pricing ?? {},
    roomConfigurations: serializeRoomConfigurations(hostel),
    roomTypes: hostel.roomTypes ?? [],
    rules: hostel.rules ?? [],
    slug: hostel.slug,
    status: hostel.status,
    totalFloors: hostel.totalFloors ?? 0,
    updatedAt: hostel.updatedAt?.toISOString(),
    verificationStatus: hostel.verificationStatus,
  };
}

const PUBLIC_PHOTO_ORDER = { EXTERIOR: 0, INTERIOR: 1, ROOM: 2 } as const;

export function serializePublicHostel(hostel: HostelRecord) {
  return {
    capacitySummary: hostel.capacitySummary ?? {},
    // Phone only, so a visitor can call the hostel directly instead of being
    // funnelled through the inquiry form. The email stays private — inbound
    // mail goes through the inquiry flow.
    contact: { phone: hostel.contact?.phone ?? "" },
    demoDataLabel: hostel.demoDataLabel ?? "",
    description: hostel.description ?? "",
    facilities: hostel.facilities ?? [],
    food: hostel.food ?? {},
    hostelType: hostel.hostelType ?? "CO_LIVING",
    coordinates:
      hostel.location?.lat != null && hostel.location?.lng != null
        ? { lat: hostel.location.lat, lng: hostel.location.lng }
        : null,
    id: hostel._id.toString(),
    isDemoData: Boolean(hostel.isDemoData),
    location: hostel.location,
    name: hostel.name,
    nearbyPlaces: (hostel.nearbyPlaces ?? [])
      .map((place) => {
        const lat = place.coordinates?.lat;
        const lng = place.coordinates?.lng;
        if (lat == null || lng == null) {
          return null;
        }
        return {
          coordinates: { lat, lng },
          distance: place.distance ?? 0,
          name: place.name ?? "",
          type: place.type ?? "other",
        };
      })
      .filter((place): place is NonNullable<typeof place> => place !== null),
    // Exterior photos lead the public gallery — they're the cover shots —
    // then interiors. Room shots trail: they belong to a single room type and
    // only stand in for the gallery when nothing else was uploaded.
    photos: [...(hostel.photos ?? [])]
      .sort(
        (a, b) =>
          PUBLIC_PHOTO_ORDER[a.kind ?? "INTERIOR"] -
          PUBLIC_PHOTO_ORDER[b.kind ?? "INTERIOR"],
      )
      .map((photo) => ({
        alt: photo.alt ?? "",
        id: photo._id?.toString(),
        kind: photo.kind ?? "INTERIOR",
        roomType: photo.roomType ?? "",
        url: photo.url ?? "",
      })),
    pricing: hostel.pricing ?? {},
    roomConfigurations: serializeRoomConfigurations(hostel),
    roomTypes: hostel.roomTypes ?? [],
    rules: hostel.rules ?? [],
    slug: hostel.slug,
    verificationStatus: hostel.verificationStatus,
  };
}

type InquiryStatus = "NEW" | "CONTACTED" | "VISIT_SCHEDULED" | "CONVERTED" | "CLOSED";

type InquiryRecord = {
  _id: Types.ObjectId;
  budgetRange?: string;
  createdAt?: Date;
  email?: string;
  gender?: string;
  hostelId: Types.ObjectId;
  message?: string;
  name: string;
  phone: string;
  preferredRoomType?: string;
  preferredVisitDate?: Date;
  source: "PUBLIC_WEBSITE" | "ADMIN_CREATED";
  status: InquiryStatus;
  updatedAt?: Date;
};

function serializeInquiry(inquiry: InquiryRecord) {
  return {
    budgetRange: inquiry.budgetRange ?? "",
    createdAt: inquiry.createdAt?.toISOString(),
    email: inquiry.email ?? "",
    gender: inquiry.gender ?? "",
    hostelId: inquiry.hostelId.toString(),
    id: inquiry._id.toString(),
    message: inquiry.message ?? "",
    name: inquiry.name,
    phone: inquiry.phone,
    preferredRoomType: inquiry.preferredRoomType ?? "",
    preferredVisitDate: inquiry.preferredVisitDate?.toISOString(),
    source: inquiry.source,
    status: inquiry.status,
    updatedAt: inquiry.updatedAt?.toISOString(),
  };
}

type HostelDocumentRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  documentType: string;
  fileAssetId?: Types.ObjectId | null;
  fileUrl?: string | null;
  rejectionReason?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

function serializeHostelDocument(document: HostelDocumentRecord) {
  return {
    createdAt: document.createdAt?.toISOString() ?? null,
    documentType: document.documentType,
    // Prefer the FileAsset id so the client links to the secure, auth-gated
    // presign route (/api/v1/files/:id/url) instead of a raw R2 URL.
    fileAssetId: document.fileAssetId?.toString() ?? null,
    fileUrl: document.fileUrl ?? "",
    id: document._id.toString(),
    rejectionReason: document.rejectionReason ?? "",
    status: document.status,
  };
}

function serializeApplication(application: HostelApplicationRecord | null) {
  if (!application) {
    return null;
  }

  return {
    applicantId: application.applicantId.toString(),
    hostelId: application.hostelId.toString(),
    id: application._id.toString(),
    infoRequestNote: application.infoRequestNote ?? "",
    infoRequestedAt: application.infoRequestedAt?.toISOString() ?? null,
    notes: application.notes ?? "",
    rejectionReason: application.rejectionReason ?? "",
    requestedDocuments: (application.requestedDocuments ?? []).map((doc) => ({
      documentType: doc.documentType,
      note: doc.note ?? "",
    })),
    reviewedAt: application.reviewedAt?.toISOString() ?? null,
    // Exactly what the owner typed into the registration form, kept verbatim so
    // a reviewer can compare it against the live hostel record.
    snapshot: (application.snapshot ?? {}) as Record<string, unknown>,
    status: application.status,
    submittedAt: application.createdAt?.toISOString() ?? null,
    submittedBy: application.submittedBy.toString(),
  };
}

export async function auditHostelAction(
  principal: ApiPrincipal,
  hostelId: Types.ObjectId,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: hostelId.toString(),
    entityType: "Hostel",
    hostelId,
    metadata,
  });
}

export async function findHostelByIdOrThrow(hostelId: string) {
  const hostel = await HostelModel.findOne({
    _id: normalizeObjectId(hostelId),
    isDeleted: false,
  }).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  return hostel;
}

export function definedUpdate(
  input: Record<string, unknown>,
  omittedKeys: string[] = [],
) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => value !== undefined && !omittedKeys.includes(key),
    ),
  );
}

export function normalizeObjectIds(values: string[]) {
  return values.map((value) => normalizeObjectId(value));
}

export function resolveAdminHostelId(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  if (requestedHostelId) {
    assertHostelAccess(principal, requestedHostelId);
    return normalizeObjectId(requestedHostelId);
  }

  if (principal.hostelIds.length === 1) {
    return normalizeObjectId(principal.hostelIds[0]);
  }

  throw new HostelServiceError(
    "A hostelId is required for this hostel admin action.",
    "HOSTEL_SCOPE_REQUIRED",
    422,
  );
}

export function scopedHostelFilter(principal: ApiPrincipal, requestedHostelId?: string) {
  if (requestedHostelId) {
    return { hostelId: resolveAdminHostelId(principal, requestedHostelId) };
  }

  return {
    hostelId: {
      $in: normalizeObjectIds(principal.hostelIds),
    },
  };
}

export async function findScopedHostel(
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const hostelId = resolveAdminHostelId(principal, requestedHostelId);
  const hostel = await HostelModel.findOne({
    _id: hostelId,
    isDeleted: false,
  }).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  return hostel;
}

/**
 * Owner resolution for an authenticated submission. Approval mails credentials
 * to the owner account's address, so a signed-in applicant is bound to their own
 * account and the client-sent applicant contact is never consulted — otherwise a
 * forged (or merely mistyped) email/phone in the request body could point the
 * hostel at someone else's account and send the credentials there.
 */
async function resolveAuthenticatedHostelOwner(authUserId: string) {
  const user = await UserModel.findOne({
    _id: normalizeObjectId(authUserId),
    isDeleted: { $ne: true },
  }).lean<(UserOwnerRecord & { email?: string }) | null>();

  if (!user) {
    throw new HostelServiceError(
      "Your account could not be found. Sign in again and retry.",
      "HOSTEL_OWNER_NOT_FOUND",
      401,
    );
  }

  // Same rule as the contact-resolved path: PUBLIC upgrades to HOSTEL_ADMIN at
  // approval time, existing HOSTEL_ADMINs may register more hostels.
  if (user.role !== Role.HOSTEL_ADMIN && user.role !== Role.PUBLIC) {
    throw new HostelServiceError(
      "This account role cannot register a hostel.",
      "HOSTEL_OWNER_CONTACT_CONFLICT",
      409,
    );
  }

  return user;
}

async function findOrCreatePublicHostelOwner(
  applicant: PublicHostelApplicationCreateInput["applicant"],
) {
  const contactFilter: Array<{ email?: string; phone?: string }> = [
    { phone: applicant.phone },
  ];

  if (applicant.email) {
    contactFilter.push({ email: applicant.email.toLowerCase() });
  }

  const existingUser = await UserModel.findOne({
    $or: contactFilter,
    isDeleted: { $ne: true },
  }).lean<UserOwnerRecord | null>();

  if (existingUser) {
    // PUBLIC accounts are upgraded to HOSTEL_ADMIN at approval time
    // (ARCHITECTURE.md §3.2); existing HOSTEL_ADMIN owners can register
    // additional hostels. Any other role is a conflict.
    if (existingUser.role !== Role.HOSTEL_ADMIN && existingUser.role !== Role.PUBLIC) {
      throw new HostelServiceError(
        "This contact already belongs to another account role.",
        "HOSTEL_OWNER_CONTACT_CONFLICT",
        409,
      );
    }

    return existingUser._id;
  }

  const user = await UserModel.create({
    email: applicant.email,
    name: applicant.name,
    phone: applicant.phone,
    role: Role.PUBLIC,
    status: "INVITED",
  });

  return user._id as Types.ObjectId;
}

function appLoginUrl() {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/login`;
}

function appHostelStatusUrl() {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/register-hostel/form`;
}

function appHostelListingUrl(slug: string) {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/hostels/${slug}`;
}

async function resolveHostelOwner(hostelId: Types.ObjectId | string) {
  const hostel = await HostelModel.findOne({ _id: hostelId })
    .select("ownerId name")
    .lean<{ ownerId?: Types.ObjectId; name?: string } | null>();

  if (!hostel?.ownerId) {
    return null;
  }

  const owner = await UserModel.findOne({
    _id: hostel.ownerId,
    isDeleted: { $ne: true },
  }).lean<{ _id: Types.ObjectId; email?: string; name?: string } | null>();

  if (!owner?.email) {
    return null;
  }

  return {
    hostelName: hostel.name ?? "your hostel",
    owner: { id: owner._id, email: owner.email, name: owner.name },
  };
}

/**
 * Emails a hostel owner about a review decision, without ever failing the
 * decision itself. Both silent-failure paths (no resolvable owner, Resend
 * rejecting the send) are logged and reported back so the reviewer is not shown
 * a plain success when nobody was actually contacted.
 */
async function notifyHostelOwner(
  hostelId: Types.ObjectId,
  action: string,
  buildEmail: (context: {
    hostelName: string;
    owner: { email: string; name?: string };
  }) => { subject: string; html: string },
): Promise<OwnerNotification> {
  const ownerInfo = await resolveHostelOwner(hostelId);

  if (!ownerInfo) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: `${action}_email_skipped`,
        message: "Hostel has no resolvable owner email; owner was not notified.",
        hostelId: hostelId.toString(),
      }),
    );
    return { reason: "no_owner_email", sent: false };
  }

  const delivery = await sendEmail({
    to: ownerInfo.owner.email,
    ...buildEmail({ hostelName: ownerInfo.hostelName, owner: ownerInfo.owner }),
  });

  if (delivery.sent) {
    return { sent: true, to: ownerInfo.owner.email };
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      action: `${action}_email_failed`,
      message: `Owner was not notified (${delivery.reason}).`,
      detail: delivery.detail ?? null,
      hostelId: hostelId.toString(),
      to: ownerInfo.owner.email,
    }),
  );

  return { reason: delivery.reason, sent: false, to: ownerInfo.owner.email };
}

export async function createPlatformHostelApplication(
  input: PlatformHostelCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const ownerId = normalizeObjectId(input.ownerId);
  const slug = await uniqueSlug(input.name, input.location.area);

  const hostel = await HostelModel.create({
    capacitySummary: input.capacitySummary,
    contact: input.contact,
    createdBy: principal.userId,
    description: input.description,
    facilities: input.facilities,
    food: input.food,
    hostelType: input.hostelType,
    location: input.location,
    name: input.name,
    ownerId,
    photos: input.photos,
    pricing: input.pricing,
    roomConfigurations: input.roomConfigurations,
    roomTypes: input.roomTypes,
    rules: input.rules,
    totalFloors: input.totalFloors,
    slug,
    status: "PENDING_APPROVAL",
    updatedBy: principal.userId,
    verificationStatus: "PENDING",
  });

  const application = await HostelApplicationModel.create({
    applicantId: ownerId,
    hostelId: hostel._id,
    notes: input.notes,
    snapshot: {
      contact: input.contact,
      location: input.location,
      name: input.name,
    },
    status: "PENDING",
    submittedBy: principal.userId,
  });

  await HostelVerificationModel.create({
    createdBy: principal.userId,
    hostelId: hostel._id,
    status: "PENDING",
    updatedBy: principal.userId,
  });

  if (input.documents.length > 0) {
    await HostelDocumentModel.insertMany(
      input.documents.map((document) => ({
        createdBy: principal.userId,
        documentType: document.documentType,
        fileAssetId: document.fileAssetId,
        fileUrl: document.fileUrl,
        hostelId: hostel._id,
        ownerId,
        status: "PENDING",
        updatedBy: principal.userId,
      })),
    );
  }

  await auditHostelAction(principal, hostel._id, "HOSTEL_APPLICATION_CREATED", {
    ownerId: ownerId.toString(),
  });

  const createdHostel = await findHostelByIdOrThrow(hostel._id.toString());
  const createdApplication = await HostelApplicationModel.findById(
    application._id,
  ).lean<HostelApplicationRecord | null>();

  return {
    application: serializeApplication(createdApplication),
    hostel: serializeHostel(createdHostel),
  };
}

export async function registerPublicHostelApplication(
  input: PublicHostelApplicationCreateInput,
  options: { authUserId?: string } = {},
) {
  await connectToDatabase();

  // An authenticated submission is owned by the signed-in account, full stop;
  // only anonymous submissions fall back to resolving an owner from the typed
  // contact details. This is what guarantees the approval email reaches the
  // person who filled the form — the request body cannot redirect it.
  const authenticatedOwner = options.authUserId
    ? await resolveAuthenticatedHostelOwner(options.authUserId)
    : null;

  // The reviewer should see the address the credentials will actually go to,
  // not whatever the client posted.
  const applicant = authenticatedOwner?.email
    ? { ...input.applicant, email: authenticatedOwner.email }
    : input.applicant;

  const ownerId =
    authenticatedOwner?._id ?? (await findOrCreatePublicHostelOwner(applicant));
  const slug = await uniqueSlug(input.name, input.location.area);

  const hostel = await HostelModel.create({
    capacitySummary: input.capacitySummary,
    contact: input.contact,
    createdBy: ownerId,
    description: input.description,
    facilities: input.facilities,
    food: input.food,
    hostelType: input.hostelType,
    location: input.location,
    name: input.name,
    ownerId,
    photos: input.photos,
    pricing: input.pricing,
    roomConfigurations: input.roomConfigurations,
    roomTypes: input.roomTypes,
    rules: input.rules,
    totalFloors: input.totalFloors,
    slug,
    status: "PENDING_APPROVAL",
    updatedBy: ownerId,
    verificationStatus: "PENDING",
  });

  const application = await HostelApplicationModel.create({
    applicantId: ownerId,
    hostelId: hostel._id,
    notes: input.notes,
    snapshot: {
      applicant,
      capacitySummary: input.capacitySummary,
      contact: input.contact,
      documents: input.documents,
      location: input.location,
      name: input.name,
      pricing: input.pricing,
      roomConfigurations: input.roomConfigurations,
      selectedPlan: input.selectedPlan,
    },
    status: "PENDING",
    submittedBy: ownerId,
  });

  await HostelVerificationModel.create({
    createdBy: ownerId,
    hostelId: hostel._id,
    status: "PENDING",
    updatedBy: ownerId,
  });

  if (input.documents.length > 0) {
    await HostelDocumentModel.insertMany(
      input.documents.map((document) => ({
        createdBy: ownerId,
        documentType: document.documentType,
        fileAssetId: document.fileAssetId,
        fileUrl: document.fileUrl,
        hostelId: hostel._id,
        ownerId,
        status: "PENDING",
        updatedBy: ownerId,
      })),
    );
  }

  await AuditLogModel.create({
    action: "PUBLIC_HOSTEL_APPLICATION_SUBMITTED",
    actorId: ownerId,
    entityId: hostel._id.toString(),
    entityType: "Hostel",
    hostelId: hostel._id,
    metadata: {
      selectedPlan: input.selectedPlan,
      submittedFrom: "public-registration",
    },
  });

  if (input.applicant.email) {
    await sendEmail({
      to: input.applicant.email,
      ...hostelSubmissionReceivedEmail({
        hostelName: input.name,
        ownerName: input.applicant.name,
      }),
    });
  }

  // EMAIL_SYSTEM.md §7.1. The owner was already told; until this landed the
  // platform staff who have to act on it were not.
  await notifyPlatformOfPendingHostel(hostel, {
    email: input.applicant.email,
    name: input.applicant.name,
  }).catch(() => {});

  const createdHostel = await findHostelByIdOrThrow(hostel._id.toString());
  const createdApplication = await HostelApplicationModel.findById(
    application._id,
  ).lean<HostelApplicationRecord | null>();

  return {
    application: serializeApplication(createdApplication),
    hostel: serializeHostel(createdHostel),
  };
}

export async function listPlatformHostels(query: PlatformHostelListQuery) {
  await connectToDatabase();

  const filter: Partial<Pick<HostelRecord, "status" | "verificationStatus">> & {
    isDeleted: false;
  } = {
    isDeleted: false,
  };

  if (query.status) {
    filter.status = query.status;
  }

  if (query.verificationStatus) {
    filter.verificationStatus = query.verificationStatus;
  }

  const { limit, skip } = paginationRange(query);

  const [hostels, total] = await Promise.all([
    HostelModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<HostelRecord[]>(),
    HostelModel.countDocuments(filter),
  ]);

  // The approval queue is about people as much as listings, so each row carries
  // who filed it and when — resolved in one query rather than per row.
  const owners = await UserModel.find({
    _id: { $in: hostels.map((hostel) => hostel.ownerId) },
  })
    .select("name email phone")
    .lean<
      Array<{ _id: Types.ObjectId; email?: string; name?: string; phone?: string }>
    >();

  const ownerById = new Map(
    owners.map((owner) => [
      owner._id.toString(),
      {
        email: owner.email ?? "",
        name: owner.name ?? "Unnamed owner",
        phone: owner.phone ?? "",
      },
    ]),
  );

  const applications = await HostelApplicationModel.find({
    hostelId: { $in: hostels.map((hostel) => hostel._id) },
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select("hostelId createdAt status")
    .lean<
      Array<{
        createdAt?: Date;
        hostelId: Types.ObjectId;
        status: string;
      }>
    >();

  const applicationByHostel = new Map<
    string,
    { status: string; submittedAt: string | null }
  >();
  for (const application of applications) {
    const key = application.hostelId.toString();
    if (!applicationByHostel.has(key)) {
      applicationByHostel.set(key, {
        status: application.status,
        submittedAt: application.createdAt?.toISOString() ?? null,
      });
    }
  }

  return {
    hostels: hostels.map((hostel) => {
      const application = applicationByHostel.get(hostel._id.toString());

      return {
        ...serializeHostel(hostel),
        applicationStatus: application?.status ?? "",
        owner: ownerById.get(hostel.ownerId.toString()) ?? null,
        submittedAt: application?.submittedAt ?? hostel.createdAt?.toISOString() ?? null,
      };
    }),
    pagination: paginationMeta(query, total),
  };
}

export async function getPlatformHostel(hostelId: string) {
  await connectToDatabase();

  const hostel = await findHostelByIdOrThrow(hostelId);
  const application = await HostelApplicationModel.findOne({
    hostelId: hostel._id,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean<HostelApplicationRecord | null>();
  const documents = await HostelDocumentModel.find({
    hostelId: hostel._id,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean<HostelDocumentRecord[]>();

  // Who actually filed this listing. The applicant is the hostel owner; the
  // submitter can differ when a staff member filed on their behalf, so both are
  // surfaced to the reviewer.
  const contactIds = [
    hostel.ownerId,
    ...(application ? [application.applicantId, application.submittedBy] : []),
  ];
  const contacts = await UserModel.find({ _id: { $in: contactIds } })
    .select("name email phone role createdAt")
    .lean<
      Array<{
        _id: Types.ObjectId;
        createdAt?: Date;
        email?: string;
        name?: string;
        phone?: string;
        role?: string;
      }>
    >();

  const contactById = new Map(
    contacts.map((contact) => [
      contact._id.toString(),
      {
        email: contact.email ?? "",
        id: contact._id.toString(),
        name: contact.name ?? "Unnamed user",
        phone: contact.phone ?? "",
        registeredAt: contact.createdAt?.toISOString() ?? null,
        role: contact.role ?? "PUBLIC",
      },
    ]),
  );

  return {
    application: serializeApplication(application),
    applicant: application
      ? (contactById.get(application.applicantId.toString()) ?? null)
      : null,
    documents: documents.map(serializeHostelDocument),
    hostel: serializeHostel(hostel),
    owner: contactById.get(hostel.ownerId.toString()) ?? null,
    submitter: application
      ? (contactById.get(application.submittedBy.toString()) ?? null)
      : null,
  };
}

async function updateHostelStatus(
  hostelId: string,
  principal: ApiPrincipal,
  status: HostelStatus,
  action: string,
  verificationStatus?: HostelRecord["verificationStatus"],
  metadata: Record<string, unknown> = {},
) {
  await connectToDatabase();

  const objectId = normalizeObjectId(hostelId);
  const update: {
    reviewedAt?: Date;
    reviewedBy?: string;
    status?: HostelStatus;
    updatedBy?: string;
    verificationStatus?: HostelRecord["verificationStatus"];
  } = {
    status,
    updatedBy: principal.userId,
  };

  if (verificationStatus) {
    update.verificationStatus = verificationStatus;
  }

  const hostel = await HostelModel.findOneAndUpdate(
    { _id: objectId, isDeleted: false },
    { $set: update },
    { new: true },
  ).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  await auditHostelAction(principal, objectId, action, metadata);

  return {
    hostel: serializeHostel(hostel),
  };
}

export async function approvePlatformHostel(hostelId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const result = await updateHostelStatus(
    hostelId,
    principal,
    "APPROVED",
    "HOSTEL_APPROVED",
    "VERIFIED",
  );

  const objectId = normalizeObjectId(hostelId);

  await HostelApplicationModel.updateMany(
    { hostelId: objectId, status: "PENDING" },
    {
      $set: {
        reviewedAt: new Date(),
        reviewedBy: principal.userId,
        status: "APPROVED",
      },
    },
  );
  await HostelVerificationModel.findOneAndUpdate(
    { hostelId: objectId },
    {
      $set: {
        status: "VERIFIED",
        updatedBy: principal.userId,
        verifiedAt: new Date(),
        verifiedBy: principal.userId,
      },
    },
    { upsert: true },
  );
  await HostelDocumentModel.updateMany(
    { hostelId: objectId, status: "PENDING" },
    {
      $set: {
        reviewedAt: new Date(),
        reviewedBy: principal.userId,
        status: "APPROVED",
        updatedBy: principal.userId,
      },
    },
  );

  // Account upgrade (ARCHITECTURE.md §3.2): PUBLIC owner -> HOSTEL_ADMIN,
  // then the approval email carries credentials only for accounts that never
  // had a password (new/Google-only owners get a temporary one).
  const ownerInfo = await resolveHostelOwner(objectId);
  // The hostel's shared cook login is issued at approval so the kitchen can be
  // handed its credentials in the same email as the admin's (PHASES.md §3.1),
  // rather than waiting for someone to find a toggle. Never fails the approval.
  const cookAccount = await provisionApprovalCookAccount(objectId, principal.userId);

  if (ownerInfo) {
    const upgrade = await registerOrUpgradeUserByEmail({
      email: ownerInfo.owner.email,
      hostelId: hostelId,
      hostelName: ownerInfo.hostelName,
      name: ownerInfo.owner.name,
      performedBy: principal.userId,
      role: Role.HOSTEL_ADMIN,
      sendEmailNotification: false,
    });

    await UserModel.updateOne(
      { _id: ownerInfo.owner.id },
      {
        $set: {
          emailVerified: true,
          status: "ACTIVE",
        },
      },
    );

    await sendEmail({
      to: ownerInfo.owner.email,
      ...hostelApprovedEmail({
        hostelName: ownerInfo.hostelName,
        loginUrl: appLoginUrl(),
        ...(upgrade.temporaryPassword
          ? {
              credentials: {
                email: ownerInfo.owner.email,
                temporaryPassword: upgrade.temporaryPassword,
              },
            }
          : {}),
        ...(cookAccount ? { cookCredentials: cookAccount } : {}),
      }),
    });
  }

  return result;
}

/**
 * Issues the hostel's shared cook login during approval. Returns `null` — and
 * logs — if provisioning fails, because a cook account is not worth blocking an
 * approval over; the hostel admin can still issue one from the Food page.
 */
async function provisionApprovalCookAccount(
  hostelId: Types.ObjectId,
  actorId: string,
): Promise<{ cookName: string; email: string; temporaryPassword: string } | null> {
  try {
    const hostel = await HostelModel.findOne({ _id: hostelId })
      .select("name slug")
      .lean<{ name?: string; slug?: string } | null>();

    if (!hostel) {
      return null;
    }

    const { cookName, credentials } = await provisionCookAccount({
      actorId,
      hostelId,
      hostelName: hostel.name ?? "Hostel",
      hostelSlug: hostel.slug ?? hostelId.toString(),
    });

    await AuditLogModel.create({
      action: "COOK_PORTAL_ENABLED",
      actorId,
      entityId: hostelId.toString(),
      entityType: "HostelSettings",
      hostelId,
      metadata: { cookName, issuedAt: "hostel_approval" },
    });

    return { cookName, ...credentials };
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        action: "approval_cook_provisioning_failed",
        message:
          error instanceof Error ? error.message : "Unknown cook provisioning error",
        hostelId: hostelId.toString(),
      }),
    );

    return null;
  }
}

export async function rejectPlatformHostel(
  hostelId: string,
  input: HostelRejectInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const result = await updateHostelStatus(
    hostelId,
    principal,
    "REJECTED",
    "HOSTEL_REJECTED",
    "REJECTED",
    { reason: input.reason },
  );
  const objectId = normalizeObjectId(hostelId);

  await HostelApplicationModel.updateMany(
    { hostelId: objectId, status: "PENDING" },
    {
      $set: {
        rejectionReason: input.reason,
        reviewedAt: new Date(),
        reviewedBy: principal.userId,
        status: "REJECTED",
      },
    },
  );
  await HostelVerificationModel.findOneAndUpdate(
    { hostelId: objectId },
    {
      $set: {
        notes: input.reason,
        status: "REJECTED",
        updatedBy: principal.userId,
        verifiedBy: principal.userId,
      },
    },
    { upsert: true },
  );

  const ownerInfo = await resolveHostelOwner(objectId);

  if (ownerInfo) {
    await sendEmail({
      to: ownerInfo.owner.email,
      ...hostelRejectedEmail({
        hostelName: ownerInfo.hostelName,
        reason: input.reason,
      }),
    });
  }

  return result;
}

export async function requestPlatformHostelDocuments(
  hostelId: string,
  input: HostelRequestDocumentsInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const objectId = normalizeObjectId(hostelId);

  // Keep the hostel in the review queue; the "needs more info" signal lives on
  // the application so the owner sees exactly which documents are outstanding.
  const hostel = await HostelModel.findOneAndUpdate(
    { _id: objectId, isDeleted: false },
    { $set: { updatedBy: principal.userId, verificationStatus: "PENDING" } },
    { new: true },
  ).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  const now = new Date();

  await HostelApplicationModel.updateMany(
    { hostelId: objectId, status: { $in: ["PENDING", "NEEDS_MORE_INFO"] } },
    {
      $set: {
        infoRequestNote: input.note ?? "",
        infoRequestedAt: now,
        infoRequestedBy: principal.userId,
        requestedDocuments: input.documents,
        reviewedBy: principal.userId,
        status: "NEEDS_MORE_INFO",
      },
    },
  );

  await auditHostelAction(principal, objectId, "HOSTEL_DOCUMENTS_REQUESTED", {
    documents: input.documents.map((doc) => doc.documentType),
  });

  const notification = await notifyHostelOwner(
    objectId,
    "hostel_documents_requested",
    ({ hostelName, owner }) =>
      hostelDocumentsRequestedEmail({
        documents: input.documents,
        hostelName,
        note: input.note,
        ownerName: owner.name,
        statusUrl: appHostelStatusUrl(),
      }),
  );

  return { hostel: serializeHostel(hostel), notification };
}

// Owner-facing: list the applications the signed-in user submitted, newest
// first, with the current status and any outstanding document requests.
export async function listOwnerHostelApplications(userId: string) {
  await connectToDatabase();

  const applicantId = normalizeObjectId(userId);

  // The public registration flow resolves the owner from the contact details
  // typed into the form (findOrCreatePublicHostelOwner), which can be a
  // different user record than the signed-in account. Match applications for
  // the signed-in user OR any owner record sharing their email/phone so the
  // status tab stays consistent after a refresh.
  const currentUser = await UserModel.findById(applicantId)
    .select("email phone")
    .lean<{ email?: string; phone?: string } | null>();

  const ownerIds = new Set<string>([applicantId.toString()]);
  const contactOr: Array<{ email?: string; phone?: string }> = [];
  if (currentUser?.email) contactOr.push({ email: currentUser.email.toLowerCase() });
  if (currentUser?.phone) contactOr.push({ phone: currentUser.phone });

  if (contactOr.length > 0) {
    const matches = await UserModel.find({
      $or: contactOr,
      isDeleted: { $ne: true },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();
    matches.forEach((match) => ownerIds.add(match._id.toString()));
  }

  const applications = await HostelApplicationModel.find({
    applicantId: { $in: Array.from(ownerIds).map((id) => new Types.ObjectId(id)) },
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean<(HostelApplicationRecord & { snapshot?: { name?: string } })[]>();

  const hostelIds = applications.map((application) => application.hostelId);
  const hostels = await HostelModel.find({ _id: { $in: hostelIds } })
    .select("name status verificationStatus")
    .lean<
      {
        _id: Types.ObjectId;
        name?: string;
        status?: string;
        verificationStatus?: string;
      }[]
    >();
  const hostelById = new Map(hostels.map((hostel) => [hostel._id.toString(), hostel]));

  return {
    applications: applications.map((application) => {
      const hostel = hostelById.get(application.hostelId.toString());
      return {
        ...serializeApplication(application),
        hostelName: hostel?.name ?? application.snapshot?.name ?? "Your hostel",
        hostelStatus: hostel?.status ?? "PENDING_APPROVAL",
        submittedAt: application.updatedAt?.toISOString() ?? "",
        verificationStatus: hostel?.verificationStatus ?? "PENDING",
      };
    }),
  };
}

// Owner-facing: attach freshly uploaded documents in response to a
// "documents needed" request and return the application to the review queue.
export async function resubmitOwnerHostelDocuments(
  userId: string,
  hostelId: string,
  input: HostelResubmitDocumentsInput,
) {
  await connectToDatabase();

  const applicantId = normalizeObjectId(userId);
  const objectId = normalizeObjectId(hostelId);

  const application = await HostelApplicationModel.findOne({
    applicantId,
    hostelId: objectId,
    isDeleted: false,
  }).sort({ createdAt: -1 });

  if (!application) {
    throw new HostelServiceError(
      "No application was found for this hostel.",
      "APPLICATION_NOT_FOUND",
      404,
    );
  }

  await HostelDocumentModel.insertMany(
    input.documents.map((document) => ({
      createdBy: applicantId,
      documentType: document.documentType,
      fileAssetId: document.fileAssetId,
      fileUrl: document.fileUrl,
      hostelId: objectId,
      ownerId: applicantId,
      status: "PENDING",
      updatedBy: applicantId,
    })),
  );

  application.set({
    infoRequestNote: "",
    requestedDocuments: [],
    status: "PENDING",
  });
  await application.save();

  await AuditLogModel.create({
    action: "PUBLIC_HOSTEL_DOCUMENTS_RESUBMITTED",
    actorId: applicantId,
    entityId: objectId.toString(),
    entityType: "Hostel",
    hostelId: objectId,
    metadata: { documents: input.documents.map((doc) => doc.documentType) },
  });

  return {
    application: serializeApplication(
      application.toObject() as unknown as HostelApplicationRecord,
    ),
  };
}

export async function publishPlatformHostel(hostelId: string, principal: ApiPrincipal) {
  await connectToDatabase();

  const current = await findHostelByIdOrThrow(hostelId);

  if (current.verificationStatus !== "VERIFIED") {
    throw new HostelServiceError(
      "Only verified hostels can be published.",
      "HOSTEL_NOT_VERIFIED",
      409,
    );
  }

  const result = await updateHostelStatus(
    hostelId,
    principal,
    "PUBLISHED",
    "HOSTEL_PUBLISHED",
  );

  const notification = await notifyHostelOwner(
    normalizeObjectId(hostelId),
    "hostel_published",
    ({ hostelName }) =>
      hostelPublishedEmail({
        hostelName,
        listingUrl: appHostelListingUrl(result.hostel.slug),
      }),
  );

  return { ...result, notification };
}

export async function unpublishPlatformHostel(
  hostelId: string,
  input: HostelUnpublishInput,
  principal: ApiPrincipal,
) {
  const result = await updateHostelStatus(
    hostelId,
    principal,
    "APPROVED",
    "HOSTEL_UNPUBLISHED",
    undefined,
    { reason: input.reason },
  );

  const notification = await notifyHostelOwner(
    normalizeObjectId(hostelId),
    "hostel_unpublished",
    ({ hostelName }) =>
      hostelUnpublishedEmail({
        hostelName,
        loginUrl: appLoginUrl(),
        reason: input.reason,
      }),
  );

  return { ...result, notification };
}

export async function listPublicHostels(query: PublicHostelListQuery) {
  await connectToDatabase();

  const filter: {
    $or?: Array<Record<string, RegExp>>;
    facilities?: string;
    "food.hasNonVeg"?: true;
    "food.hasVeg"?: true;
    "location.area"?: RegExp;
    "pricing.monthlyRentMax"?: { $gte: number };
    "pricing.monthlyRentMin"?: { $lte: number };
    roomTypes?: string;
    hostelType?: PublicHostelListQuery["type"];
    isDeleted: false;
    status: "PUBLISHED";
    verificationStatus: "VERIFIED";
  } = {
    isDeleted: false,
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
  };

  if (query.q) {
    // Escaped: a public search box reaches Mongo as a pattern, so an unescaped
    // "(" is a 500 and a crafted one is a CPU bill.
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [{ name: pattern }, { "location.area": pattern }];
  }

  if (query.area) {
    filter["location.area"] = new RegExp(escapeRegex(query.area), "i");
  }

  if (query.type) {
    filter.hostelType = query.type;
  }

  if (query.facility) {
    filter.facilities = query.facility;
  }

  if (query.food === "veg") {
    filter["food.hasVeg"] = true;
  }

  if (query.food === "non-veg") {
    filter["food.hasNonVeg"] = true;
  }

  if (query.roomType) {
    filter.roomTypes = query.roomType;
  }

  if (query.minPrice !== undefined) {
    filter["pricing.monthlyRentMax"] = { $gte: query.minPrice };
  }

  if (query.maxPrice !== undefined) {
    filter["pricing.monthlyRentMin"] = { $lte: query.maxPrice };
  }

  const hostels = await HostelModel.find(filter)
    .sort({ "pricing.monthlyRentMin": 1, createdAt: -1 })
    .limit(60)
    .lean<HostelRecord[]>();

  return {
    hostels: hostels.map(serializePublicHostel),
  };
}

/**
 * Slugs of every publicly-visible hostel, for sitemap.xml generation.
 * Same visibility gate as {@link getPublicHostelBySlug} (published + verified).
 */
export async function listPublishedHostelSlugs() {
  await connectToDatabase();

  const hostels = await HostelModel.find({
    isDeleted: false,
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
  })
    .select("slug updatedAt")
    .sort({ updatedAt: -1 })
    .limit(5000)
    .lean<{ slug: string; updatedAt?: Date }[]>();

  return hostels
    .filter((hostel) => Boolean(hostel.slug))
    .map((hostel) => ({ slug: hostel.slug, updatedAt: hostel.updatedAt }));
}

export async function getPublicHostelBySlug(slug: string) {
  await connectToDatabase();

  const hostel = await HostelModel.findOne({
    isDeleted: false,
    slug,
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
  }).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  const foodRoutine = await getFoodRoutine(hostel._id);

  return {
    hostel: {
      ...serializePublicHostel(hostel),
      foodRoutine,
    },
  };
}

export async function comparePublicHostels(query: PublicHostelCompareQuery) {
  await connectToDatabase();

  const hostelIds = normalizeObjectIds(query.ids);
  const hostels = await HostelModel.find({
    _id: { $in: hostelIds },
    isDeleted: false,
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
  }).lean<HostelRecord[]>();

  if (hostels.length !== hostelIds.length) {
    throw new HostelServiceError(
      "One or more hostels are not available for public comparison.",
      "PUBLIC_HOSTEL_COMPARE_NOT_FOUND",
      404,
    );
  }

  const ratings = await RatingReviewModel.aggregate<RatingSummaryRecord>([
    {
      $match: {
        hostelId: { $in: hostelIds },
        status: "VISIBLE",
      },
    },
    {
      $group: {
        _id: "$hostelId",
        averageRating: { $avg: "$overallRating" },
        cleanlinessRating: { $avg: "$cleanlinessRating" },
        foodRating: { $avg: "$foodRating" },
        safetyRating: { $avg: "$safetyRating" },
        total: { $sum: 1 },
      },
    },
  ]);
  const ratingByHostelId = new Map(
    ratings.map((rating) => [rating._id.toString(), rating]),
  );
  const byRequestedOrder = new Map(
    hostels.map((hostel) => [hostel._id.toString(), hostel]),
  );

  return {
    hostels: query.ids
      .map((id) => byRequestedOrder.get(id))
      .filter((hostel): hostel is HostelRecord => Boolean(hostel))
      .map((hostel) => {
        const rating = ratingByHostelId.get(hostel._id.toString());

        return {
          ...serializePublicHostel(hostel),
          comparison: {
            facilities: hostel.facilities ?? [],
            foodScore: rating?.foodRating ?? 0,
            locationText: [
              hostel.location.address,
              hostel.location.area,
              hostel.location.city,
            ]
              .filter(Boolean)
              .join(", "),
            monthlyFee: {
              currency: hostel.pricing?.currency ?? "NPR",
              max: hostel.pricing?.monthlyRentMax ?? 0,
              min: hostel.pricing?.monthlyRentMin ?? 0,
            },
            ratingSummary: {
              averageRating: rating?.averageRating ?? 0,
              cleanlinessRating: rating?.cleanlinessRating ?? 0,
              safetyRating: rating?.safetyRating ?? 0,
              total: rating?.total ?? 0,
            },
            roomTypes: hostel.roomTypes ?? [],
            vacancy: hostel.capacitySummary?.vacantBeds ?? 0,
            verificationStatus: hostel.verificationStatus,
          },
        };
      }),
  };
}

export async function createPublicHostelInquiry(
  hostelRef: string,
  input: PublicInquiryCreateInput,
) {
  await connectToDatabase();

  const hostelLookup = Types.ObjectId.isValid(hostelRef)
    ? { _id: normalizeObjectId(hostelRef) }
    : { slug: hostelRef };
  const hostel = await HostelModel.findOne({
    ...hostelLookup,
    isDeleted: false,
    status: "PUBLISHED",
    verificationStatus: "VERIFIED",
  }).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError("Hostel was not found.", "HOSTEL_NOT_FOUND", 404);
  }

  const inquiry = await InquiryModel.create({
    ...input,
    hostelId: hostel._id,
    source: "PUBLIC_WEBSITE",
    status: "NEW",
  });

  // EMAIL_SYSTEM.md §2.4. Wrapped: a notification failure must never fail an
  // inquiry the visitor has already submitted.
  await notifyHostelOfInquiry(hostel, {
    email: input.email,
    message: input.message,
    name: input.name,
    phone: input.phone,
    preferredVisitDate: input.preferredVisitDate,
  }).catch(() => {});

  return {
    hostel: serializePublicHostel(hostel),
    inquiry: serializeInquiry(inquiry),
  };
}
