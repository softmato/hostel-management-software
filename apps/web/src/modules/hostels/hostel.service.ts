import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { escapeRegex } from "@/lib/validators";
import { Role } from "@/lib/roles";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { CookAccountModel } from "@hostel/db/models/CookAccount";
import { HostelApplicationModel } from "@hostel/db/models/HostelApplication";
import { HostelMemberModel } from "@hostel/db/models/HostelMember";
import { HostelSubscriptionModel } from "@hostel/db/models/HostelSubscription";
import { HostelDocumentModel } from "@hostel/db/models/HostelDocument";
import { HostelModel } from "@hostel/db/models/Hostel";
import { HostelVerificationModel } from "@hostel/db/models/HostelVerification";
import { InquiryModel } from "@hostel/db/models/Inquiry";
import { RatingReviewModel } from "@hostel/db/models/RatingReview";
import { ResidentModel } from "@hostel/db/models/Resident";
import { SessionModel } from "@hostel/db/models/Session";
import { UserModel } from "@hostel/db/models/User";
import { provisionCookAccount } from "@/modules/food/cook.service";
import { geocodeAndCacheHostel } from "@/modules/hostels/hostel-geo.service";
import {
  EMPTY_ROUTINE,
  getFoodRoutine,
  getFoodRoutinesByHostelId,
  saveFoodRoutine,
} from "@/modules/food/food-routine.service";
import { registerOrUpgradeUserByEmail } from "@/modules/users/user.service";
import { sendEmail } from "@hostel/shared/email/sender";
import { hostelApprovedEmail } from "@hostel/shared/email/templates/hostel/hostel-approved";
import { hostelPublishedEmail } from "@hostel/shared/email/templates/hostel/hostel-published";
import { hostelUnpublishedEmail } from "@hostel/shared/email/templates/hostel/hostel-unpublished";
import { hostelDocumentsRequestedEmail } from "@hostel/shared/email/templates/hostel/documents-requested";
import { hostelRejectedEmail } from "@hostel/shared/email/templates/hostel/hostel-rejected";
import {
  notifyHostelOfInquiry,
  notifyPlatformOfPendingHostel,
} from "@/modules/hostels/hostel-notify";
import {
  getOrCreateSubscription,
  getSubscriptionState,
  graceDeadline,
  issueSubscriptionInvoice,
  selectPlan,
  startPlanPeriod,
} from "@/modules/billing/subscription.service";
import {
  recordFieldCollection,
} from "@/modules/billing/subscription-payment.service";
import { getOperationsConfig } from "@/modules/platform-config/operations-config";
import {
  onHostelVerified,
  onRegisteredByTeam,
  onRegistrationSubmitted,
} from "@/modules/hostels/hostel-registration.events";
import type {
  HostelRegistrationInput,
  TeamHostelRegistrationInput,
} from "@/modules/hostels/hostel-registration.validation";
import type {
  hostelArchiveSchema,
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
type HostelArchiveInput = z.infer<typeof hostelArchiveSchema>;

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
  archiveReason?: string;
  createdAt?: Date;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
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
  isDeleted?: boolean;
  isDemoData?: boolean;
  purgeScheduledAt?: Date;
  referencePrefix?: string;
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

/**
 * What a hostel's reviews add up to, on every public surface.
 *
 * **`total` is the field that says whether there is a rating at all.** The
 * averages are `0` for a hostel nobody has reviewed, and `0` is also a
 * legitimate thing to average to, so a screen that branches on `averageRating`
 * shows a brand-new hostel as one-star. Branch on `total === 0` and say "New".
 */
export type PublicRatingSummary = {
  averageRating: number;
  cleanlinessRating: number;
  foodRating: number;
  safetyRating: number;
  total: number;
};

const EMPTY_RATING_SUMMARY: PublicRatingSummary = {
  averageRating: 0,
  cleanlinessRating: 0,
  foodRating: 0,
  safetyRating: 0,
  total: 0,
};

/**
 * Review averages for a set of hostels, in one aggregation.
 *
 * One round trip for the whole page, not one per card: the listing returns up
 * to 60 hostels, and a per-hostel lookup there is 60 sequential queries behind
 * the slowest screen in the product.
 *
 * **Only `VISIBLE` reviews count.** A review a moderator hid is hidden because
 * it should not be read — and an average that still includes it publishes its
 * verdict as a number, which is the same leak with the words removed.
 *
 * Values are returned **unrounded**. Rounding is presentation, the clients
 * already format money and dates, and rounding here would silently change what
 * `comparePublicHostels` has always returned.
 */
async function ratingSummariesFor(hostelIds: Types.ObjectId[]) {
  const summaries = new Map<string, PublicRatingSummary>();

  if (hostelIds.length === 0) {
    return summaries;
  }

  const rows = await RatingReviewModel.aggregate<RatingSummaryRecord>([
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

  for (const row of rows) {
    summaries.set(row._id.toString(), {
      // `$avg` returns null when every input is null — a review that rated the
      // hostel overall but left the sub-scores blank. Null in a number field is
      // how a card renders "NaN ★".
      averageRating: row.averageRating ?? 0,
      cleanlinessRating: row.cleanlinessRating ?? 0,
      foodRating: row.foodRating ?? 0,
      safetyRating: row.safetyRating ?? 0,
      total: row.total ?? 0,
    });
  }

  return summaries;
}

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
    // Archive state travels with every hostel the superadmin reads, so the
    // Archived queue can render the reason and the countdown without a second
    // endpoint. Empty on a live hostel, which is every hostel any other portal
    // is allowed to see.
    archivedAt: hostel.deletedAt?.toISOString() ?? null,
    archiveReason: hostel.archiveReason ?? "",
    capacitySummary: hostel.capacitySummary ?? {},
    contact: hostel.contact ?? {},
    createdAt: hostel.createdAt?.toISOString(),
    demoDataLabel: hostel.demoDataLabel ?? "",
    description: hostel.description ?? "",
    facilities: hostel.facilities ?? [],
    food: hostel.food ?? {},
    hostelType: hostel.hostelType ?? "CO_LIVING",
    id: hostel._id.toString(),
    isArchived: Boolean(hostel.isDeleted),
    isDemoData: Boolean(hostel.isDemoData),
    purgeScheduledAt: hostel.purgeScheduledAt?.toISOString() ?? null,
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

/**
 * `includeArchived` exists for exactly one caller: the platform's own review
 * screen, which has to be able to open an archived hostel to read why it was
 * archived and decide whether to restore it. Every other caller is a portal or
 * a public page, and to those an archived hostel does not exist.
 */
export async function findHostelByIdOrThrow(
  hostelId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  const hostel = await HostelModel.findOne({
    _id: normalizeObjectId(hostelId),
    ...(includeArchived ? {} : { isDeleted: false }),
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

/**
 * Put the hostel on the map the moment it goes live.
 *
 * Until this existed, `geocodeAndCacheHostel` ran from exactly two places — the
 * hostel admin's own profile save, and the nightly sweep — so a hostel published
 * today had no `lat`/`lng` and no `nearbyPlaces` until somebody signed in and
 * saved a form they had no reason to open. Its public page said "the exact
 * location appears once the hostel admin saves an address", which reads to a
 * visitor as an unfinished listing.
 *
 * Best-effort on purpose: Nominatim and Overpass are third-party and free, and a
 * hostel must publish whether or not they answer. A pin somebody placed is
 * MANUAL and is left exactly where they put it — only the nearby cache is
 * filled in around it.
 */
async function placeOnMap(hostelId: Types.ObjectId | string) {
  return geocodeAndCacheHostel(String(hostelId)).catch(() => null);
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

/**
 * The hostel document both desks write.
 *
 * Only the lifecycle differs between them — a public registration lands
 * `PENDING_APPROVAL`/`PENDING` and waits to be read; a team registration lands
 * `PUBLISHED`/`VERIFIED` because it already has been. Every other field is the
 * same shape from the same schema, so it is built once here rather than kept in
 * step by hand in two places.
 */
function hostelDocumentFrom(
  input: HostelRegistrationInput,
  lifecycle: {
    ownerId: Types.ObjectId | string;
    slug: string;
    status: string;
    verificationStatus: string;
  },
) {
  return {
    /*
     * `totalCapacity` is the owner's own count of beds across the building, and
     * it is only used when the per-room figures do not add up to one — the room
     * configurations are the more specific answer and win where they exist.
     */
    capacitySummary: {
      ...input.capacitySummary,
      ...(input.totalCapacity && !input.capacitySummary?.totalBeds
        ? { totalBeds: input.totalCapacity }
        : {}),
    },
    contact: { ...input.contact, alternatePhone: input.alternatePhone },
    createdBy: lifecycle.ownerId,
    description: input.description,
    facilities: input.facilities,
    food: input.food,
    hostelType: input.hostelType,
    location: {
      ...input.location,
      landmark: input.landmark,
      mapLink: input.mapLink,
    },
    name: input.name,
    ownerId: lifecycle.ownerId,
    photos: input.photos,
    pricing: input.pricing,
    roomConfigurations: input.roomConfigurations,
    roomTypes: input.roomTypes,
    rules: input.rules,
    slug: lifecycle.slug,
    status: lifecycle.status,
    totalFloors: input.totalFloors,
    updatedBy: lifecycle.ownerId,
    verificationStatus: lifecycle.verificationStatus,
    yearEstablished: input.yearEstablished,
  };
}

export async function registerPublicHostelApplication(
  input: HostelRegistrationInput,
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

  const hostel = await HostelModel.create(
    hostelDocumentFrom(input, {
      ownerId,
      slug,
      status: "PENDING_APPROVAL",
      verificationStatus: "PENDING",
    }),
  );

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
      selectedPlan: input.plan?.planId ?? null,
    },
    source: "PUBLIC",
    status: "PENDING",
    submittedBy: ownerId,
  });

  /*
   * The subscription row exists from the moment the hostel does, holding no
   * plan yet.
   *
   * Created here rather than lazily when a plan is first chosen, so that every
   * surface which reads billing state — the progress page, the due banner, the
   * platform roster — reads a row rather than having to treat "no row" as a
   * fourth kind of empty.
   */
  await getOrCreateSubscription(hostel._id, { source: "PUBLIC" });

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
      selectedPlan: input.plan?.planId ?? null,
      submittedFrom: "public-registration",
    },
  });

  await onRegistrationSubmitted({
    hostelName: input.name,
    ownerEmail: applicant.email,
    ownerName: input.applicant.name,
  });

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

/**
 * A field agent registers a hostel, and it goes live on the spot.
 *
 * ## Why this one does not queue
 *
 * The public queue exists so a human can read the documents and decide whether
 * the place is real. On this path a human already has: one of ours, standing in
 * the building, with the papers in their hand. Running it through the queue
 * again would ask a superadmin to re-perform a check that has been done better,
 * and would leave an owner who has already paid staring at a listing that is
 * not up.
 *
 * So the hostel is created `PUBLISHED`/`VERIFIED`, the application is written
 * `APPROVED` for the record, and the documents land `APPROVED` too.
 *
 * ## Money does not gate publication here — it becomes a due
 *
 * The agent may collect the full price, part of it, or nothing at all. The
 * listing goes up regardless; whatever is short becomes an outstanding balance
 * with a deadline, shown to the owner as a banner in their portal. That is the
 * inversion the public path never makes, and `PAST_DUE` records it.
 *
 * ## The agent is not the owner
 *
 * `findOrCreatePublicHostelOwner` resolves the owner from the details the agent
 * typed *about the owner* — never from the agent's own account. An agent files
 * many hostels; if their account were the owner they would end up owning every
 * one of them, and the real owner could never sign in to their own dashboard.
 */
/**
 * `Study Sanjal Hostel`, `Study Sanjal`, `study-sanjal hostel.` → one key.
 *
 * Case, punctuation, spacing and the generic words a hostel name is padded
 * with are dropped, because those are exactly the ways the same building gets
 * typed twice by two agents — or by one agent on two visits.
 */
export function hostelNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
    .replace(/\b(hostel|hostels|pg|boys|girls|home|house|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The two ways a field agent files a hostel that should not be filed.
 *
 * The case that made this necessary: one owner, three TEAM registrations in a
 * day — "Study Sanjal Hostel", then "Study Sanjal", then a test entry — two of
 * which had to be archived. Each one went live on submit, raised its own plan
 * invoice and put a hostel on the owner's account, and the leftovers are what
 * turned a one-hostel owner's app into the nameless multi-hostel dashboard.
 * The public desk has a reviewer between submit and publish to catch this; the
 * team desk publishes instantly, so the check has to happen before the write.
 *
 * **The building is already listed** — same name once normalised, same area,
 * still live. Refused with no override: it is on the platform, and a second
 * listing would split its residents, its reviews and its plan across two
 * records. If it is genuinely a different building with the same name, the
 * agent gives it a distinguishing name, which the public would need anyway.
 *
 * **The owner already has a live hostel** — matched by phone or email, the same
 * way `findOrCreatePublicHostelOwner` is about to resolve them. Refused *unless*
 * the agent confirms it is a second building, because real owners do run two.
 * The refusal names the hostel they already have, so the agent can see which.
 */
/**
 * The live hostel an email is already tied to, by name — or null.
 *
 * "Tied to" three ways, because each is somebody who can already act for a
 * hostel with that address: the account that **owns** it, an account that
 * **staffs** it (`hostelIds` — a warden or a cook signs in with their own
 * email), and the hostel's own **contact** address printed on its listing.
 * Only live hostels count — an address on an archived one is free again, which
 * is the point of archiving it.
 *
 * Compared lower-cased, the way accounts store it; nobody types an email the
 * same way twice.
 */
export async function findHostelUsingEmail(email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();

  if (!address) {
    return null;
  }

  await connectToDatabase();

  const user = await UserModel.findOne({
    email: address,
    isDeleted: { $ne: true },
  })
    .select("_id hostelIds")
    .lean<{ _id: Types.ObjectId; hostelIds?: Types.ObjectId[] } | null>();

  const hostel = await HostelModel.findOne({
    isDeleted: { $ne: true },
    $or: [
      { "contact.email": new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ...(user
        ? [{ ownerId: user._id }, { _id: { $in: user.hostelIds ?? [] } }]
        : []),
    ],
  })
    .select("name")
    .lean<{ name?: string } | null>();

  return hostel ? (hostel.name ?? "another hostel") : null;
}

export async function assertTeamRegistrationIsNew(input: TeamHostelRegistrationInput) {
  const key = hostelNameKey(input.name);
  const areaPattern = new RegExp(
    `^${input.location.area.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  const neighbours = await HostelModel.find({
    isDeleted: { $ne: true },
    "location.area": areaPattern,
  })
    .select("name slug")
    .lean<Array<{ name?: string; slug?: string }>>();

  const sameBuilding = key
    ? neighbours.find((hostel) => hostelNameKey(hostel.name ?? "") === key)
    : undefined;

  if (sameBuilding) {
    throw new HostelServiceError(
      `"${sameBuilding.name}" in ${input.location.area} is already on HostelHub. If this is a different building, give it a name that tells them apart.`,
      "HOSTEL_ALREADY_LISTED",
      409,
    );
  }

  /*
   * The email is a hard stop, ahead of the second-building question.
   *
   * An email already tied to a live hostel belongs to somebody who can already
   * sign in to one. Filing another hostel under it would either hand this
   * building to that person's account or — when the agent typed the wrong
   * address — to a stranger's. There is no tick for this: the agent asks the
   * owner for their own address, or files with no email at all.
   */
  if (input.applicant.email) {
    const usedBy = await findHostelUsingEmail(input.applicant.email);

    if (usedBy) {
      throw new HostelServiceError(
        `${input.applicant.email} is already used by "${usedBy}". Use a different email for this owner.`,
        "OWNER_EMAIL_IN_USE",
        409,
      );
    }
  }

  if (input.confirmSecondHostel) {
    return;
  }

  const contacts: Array<Record<string, string>> = [{ phone: input.applicant.phone }];

  if (input.applicant.email) {
    contacts.push({ email: input.applicant.email.toLowerCase() });
  }

  const owner = await UserModel.findOne({
    $or: contacts,
    isDeleted: { $ne: true },
  })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();

  if (!owner) {
    return;
  }

  const existing = await HostelModel.findOne({
    isDeleted: { $ne: true },
    ownerId: owner._id,
  })
    .select("name location.area")
    .lean<{ location?: { area?: string }; name?: string } | null>();

  if (existing) {
    throw new HostelServiceError(
      `This owner already has "${existing.name}"${existing.location?.area ? ` in ${existing.location.area}` : ""} on HostelHub. Confirm this is a second, separate building to register it.`,
      "OWNER_ALREADY_HAS_HOSTEL",
      409,
    );
  }
}

export async function registerTeamHostelApplication(
  input: TeamHostelRegistrationInput,
  agent: { name?: string; userId: string },
) {
  await connectToDatabase();

  // Before any write: this path publishes on submit, so a duplicate caught
  // after `HostelModel.create` is already a live listing with an invoice.
  await assertTeamRegistrationIsNew(input);

  const ownerId = await findOrCreatePublicHostelOwner(input.applicant);
  const slug = await uniqueSlug(input.name, input.location.area);

  const hostel = await HostelModel.create(
    hostelDocumentFrom(input, {
      ownerId,
      slug,
      status: "PUBLISHED",
      verificationStatus: "VERIFIED",
    }),
  );

  const application = await HostelApplicationModel.create({
    applicantId: ownerId,
    hostelId: hostel._id,
    notes: input.notes,
    reviewedAt: new Date(),
    reviewedBy: agent.userId,
    snapshot: {
      applicant: input.applicant,
      capacitySummary: input.capacitySummary,
      contact: input.contact,
      documents: input.documents,
      location: input.location,
      name: input.name,
      pricing: input.pricing,
      roomConfigurations: input.roomConfigurations,
      selectedPlan: input.plan.planId,
    },
    source: "TEAM",
    status: "APPROVED",
    submittedBy: ownerId,
    submittedByAgentId: agent.userId,
  });

  await HostelVerificationModel.create({
    createdBy: agent.userId,
    hostelId: hostel._id,
    status: "VERIFIED",
    updatedBy: agent.userId,
    verifiedAt: new Date(),
    verifiedBy: agent.userId,
  });

  if (input.documents.length > 0) {
    await HostelDocumentModel.insertMany(
      input.documents.map((document) => ({
        createdBy: agent.userId,
        documentType: document.documentType,
        fileAssetId: document.fileAssetId,
        fileUrl: document.fileUrl,
        hostelId: hostel._id,
        ownerId,
        reviewedAt: new Date(),
        reviewedBy: agent.userId,
        status: "APPROVED",
        updatedBy: agent.userId,
      })),
    );
  }

  /*
   * The kitchen's week, if the agent collected it.
   *
   * Written through `saveFoodRoutine` rather than straight to the model so this
   * path gets the same audit row and the same cache invalidation the hostel's
   * own screen does — a routine that appeared without either would be a row
   * nobody could explain the origin of.
   */
  if (input.foodRoutine) {
    await saveFoodRoutine(
      input.foodRoutine,
      { hostelIds: [hostel._id.toString()], role: Role.PLATFORM_AGENT, userId: agent.userId },
      hostel._id,
    );
  }

  await getOrCreateSubscription(hostel._id, {
    agentId: agent.userId,
    source: "TEAM",
  });
  await selectPlan(hostel._id.toString(), input.plan, agent.userId);

  /*
   * `requireVerified` is passed explicitly rather than relying on the hostel
   * having been written VERIFIED a few statements ago. The guard exists to stop
   * money being demanded from an unchecked hostel, and on this path the check is
   * the agent's presence — saying so is clearer than depending on write order.
   */
  const invoice = await issueSubscriptionInvoice(hostel._id.toString(), agent.userId, {
    agentId: agent.userId,
    requireVerified: false,
    source: "TEAM",
  });

  /*
   * The hostel is live from this moment — published before paid is the whole
   * point of a team registration — so its plan starts today, on the period the
   * invoice was raised for. It used to start only once the balance cleared, so
   * a team hostel spent its trial with no plan running at all and every screen
   * counted down the payment window in its place.
   */
  await startPlanPeriod(invoice, invoice.issuedAt ?? new Date());

  if (input.payment.amount > 0) {
    /*
     * Both methods settle here, for the amount the agent typed.
     *
     * Nepali wallets have no auto-debit, so nobody can charge an owner on their
     * behalf — what happens in the room is that the agent shows a QR, the owner
     * scans it, and the agent reads the amount off the confirmation. That is a
     * staff assertion rather than a gateway settlement, and it is the honest
     * shape of the transaction while the gateway is mocked: a checkout link
     * whose webhook will never fire would leave a paid owner looking at an
     * unpaid invoice.
     *
     * `recordFieldCollection` writes `isMocked` on the QR rows so this can be
     * unwound the day a real merchant account exists.
     */
    await recordFieldCollection(
      invoice._id.toString(),
      {
        amount: input.payment.amount,
        method: input.payment.method,
        reference: input.payment.reference,
      },
      agent.userId,
    );
  } else {
    /*
     * Nothing collected today. The whole price is still owed, so the due is set
     * here rather than waiting for a settlement that is not coming — otherwise a
     * hostel filed with no payment would sit in `AWAITING_PAYMENT` with no
     * deadline and never raise a banner.
     *
     * The deadline is the invoice's own — the end of the Nepal day `grace` days
     * after today, the day the hostel was added — so this path and a later part
     * payment agree on it to the millisecond.
     */
    const dueBy =
      invoice.dueAt ??
      graceDeadline(
        invoice.issuedAt ?? new Date(),
        (await getOperationsConfig()).subscriptionDueGraceDays,
      );

    await HostelSubscriptionModel.updateOne(
      { hostelId: hostel._id },
      { $set: { dueBy, status: "PAST_DUE" } },
    );
  }

  /*
   * The owner has to be able to sign in — to see the due and to pay it — so the
   * account upgrade a public registration gets at approval happens here, at
   * submission, because this *is* the approval.
   *
   * The credentials email is sent as well as being returned to the agent, not
   * instead of. It used to be suppressed on the grounds that the agent is
   * standing there and can read the password out, which is true on the day and
   * useless a week later: an owner who wrote it on the back of a receipt and
   * lost it had nothing to go back to, because nothing was ever sent. Reading it
   * out gets them in now; the email is what gets them in on the second visit.
   */
  const upgrade = input.applicant.email
    ? await registerOrUpgradeUserByEmail({
        email: input.applicant.email,
        hostelId: hostel._id.toString(),
        hostelName: input.name,
        name: input.applicant.name,
        performedBy: agent.userId,
        role: Role.HOSTEL_ADMIN,
        sendEmailNotification: true,
      }).catch(() => null)
    : null;

  const state = await getSubscriptionState(hostel._id.toString());

  await AuditLogModel.create({
    action: "TEAM_HOSTEL_REGISTERED",
    actorId: agent.userId,
    entityId: hostel._id.toString(),
    entityType: "Hostel",
    hostelId: hostel._id,
    metadata: {
      amountCollected: input.payment.amount,
      method: input.payment.method,
      outstanding: state?.outstanding ?? 0,
      planId: input.plan.planId,
      submittedFrom: "team-registration",
    },
  });

  await onRegisteredByTeam({
    agentName: agent.name,
    amountPaid: input.payment.amount,
    dueBy: state?.subscription.dueBy ? new Date(state.subscription.dueBy) : null,
    hostelName: input.name,
    hostelSlug: slug,
    outstanding: state?.outstanding ?? 0,
    ownerEmail: input.applicant.email,
    ownerName: input.applicant.name,
    planName: state?.subscription.planName ?? "",
  });

  // This hostel is published as of a few statements ago, so its map has to
  // exist now — not after the next sweep.
  await placeOnMap(hostel._id);

  const createdHostel = await findHostelByIdOrThrow(hostel._id.toString());
  const createdApplication = await HostelApplicationModel.findById(
    application._id,
  ).lean<HostelApplicationRecord | null>();

  return {
    application: serializeApplication(createdApplication),
    billing: state,
    hostel: serializeHostel(createdHostel),
    temporaryPassword: upgrade?.temporaryPassword ?? null,
  };
}

export async function listPlatformHostels(query: PlatformHostelListQuery) {
  await connectToDatabase();

  const filter: Partial<Pick<HostelRecord, "status" | "verificationStatus">> & {
    isDeleted: boolean;
  } = {
    isDeleted: query.archived === "only",
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

  const hostel = await findHostelByIdOrThrow(hostelId, { includeArchived: true });
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

  /*
   * Approval is the moment a person has looked at this hostel's address and
   * accepted it, and it is the last step before the listing can go live — so it
   * is where the pin and the nearby cache are filled in. An owner-registered
   * hostel publishes with the same map a team-registered one has.
   */
  await placeOnMap(objectId);

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

    // Approval re-issues any ID card this owner already holds as an owner card
    // — the conversion the registration form warned them about.
    /*
     * Imported at the call site, not at module scope. `sendIdCardEmail` reaches
     * `platform-id-card.server` and through it `@napi-rs/canvas`, a ~26 MB
     * prebuilt binary that `serverExternalPackages` copies out of node_modules
     * into the bundle of every function that can reach it. A static import here
     * put that binary into 82 functions — every route that touches
     * `hostel.service` — for one call that issues a card. A dynamic import
     * keeps it in the handful that actually render one.
     */
    const { sendIdCardEmail } = await import(
      "@/modules/users/id-card-delivery.service"
    );

    await sendIdCardEmail(ownerInfo.owner.id.toString(), "HOSTEL_OWNER");

    /*
     * Approval is *verification*, not publication.
     *
     * The listing does not go live here — it goes live when the plan is paid
     * for. So the owner is told the wait is over and pointed at the button that
     * has just become live on their progress page, and the message names the
     * plan if they already chose one during the wait.
     */
    const subscription = await HostelSubscriptionModel.findOne({
      hostelId: objectId,
    })
      .select("planName")
      .lean<{ planName?: string | null } | null>();

    await onHostelVerified({
      hostelName: ownerInfo.hostelName,
      ownerEmail: ownerInfo.owner.email,
      ownerName: ownerInfo.owner.name,
      selectedPlanName: subscription?.planName ?? null,
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

/**
 * How long an archived hostel stays recoverable before the purge cron erases
 * it. The same 60 days an account deletion request gets (PRIVACY_POLICY.md
 * §8.3) — a hostel is a larger loss than an account, never a smaller one.
 */
export const HOSTEL_ARCHIVE_GRACE_DAYS = 60;

/**
 * Every user whose reason to hold a session is this hostel: its owner, its
 * staff, its cooks and its residents.
 *
 * A user who still has a live link to some *other* hostel is left alone. A
 * warden covering two buildings does not deserve to be signed out of the
 * second because the first was archived — and their access to the archived one
 * is already dead the moment `isDeleted` is set, because every hostel-scoped
 * read filters on it.
 */
async function revokeSessionsForArchivedHostel(hostelId: Types.ObjectId) {
  const [hostel, members, residents, cooks] = await Promise.all([
    HostelModel.findById(hostelId).select("ownerId").lean<{
      ownerId: Types.ObjectId;
    } | null>(),
    HostelMemberModel.find({ hostelId, isDeleted: { $ne: true } })
      .select("userId")
      .lean<{ userId: Types.ObjectId }[]>(),
    ResidentModel.find({ hostelId, isDeleted: { $ne: true }, userId: { $ne: null } })
      .select("userId")
      .lean<{ userId: Types.ObjectId }[]>(),
    CookAccountModel.find({ hostelId, userId: { $ne: null } })
      .select("userId")
      .lean<{ userId: Types.ObjectId }[]>(),
  ]);

  const candidates = new Map<string, Types.ObjectId>();

  for (const id of [
    ...(hostel?.ownerId ? [hostel.ownerId] : []),
    ...members.map((member) => member.userId),
    ...residents.map((resident) => resident.userId),
    ...cooks.map((cook) => cook.userId),
  ]) {
    if (id) {
      candidates.set(id.toString(), id);
    }
  }

  if (candidates.size === 0) {
    return 0;
  }

  const candidateIds = [...candidates.values()];

  // Which of them still belong somewhere that is not archived. Two queries
  // rather than one per user.
  const [liveHostelIds, otherMembers, otherResidents] = await Promise.all([
    HostelModel.find({ _id: { $ne: hostelId }, isDeleted: { $ne: true } })
      .select("_id ownerId")
      .lean<{ _id: Types.ObjectId; ownerId?: Types.ObjectId }[]>(),
    HostelMemberModel.find({
      hostelId: { $ne: hostelId },
      isDeleted: { $ne: true },
      userId: { $in: candidateIds },
    })
      .select("hostelId userId")
      .lean<{ hostelId: Types.ObjectId; userId: Types.ObjectId }[]>(),
    ResidentModel.find({
      hostelId: { $ne: hostelId },
      isDeleted: { $ne: true },
      userId: { $in: candidateIds },
    })
      .select("hostelId userId")
      .lean<{ hostelId: Types.ObjectId; userId: Types.ObjectId }[]>(),
  ]);

  const liveHostels = new Set(liveHostelIds.map((row) => row._id.toString()));
  const stillAttached = new Set<string>();

  for (const row of liveHostelIds) {
    if (row.ownerId) {
      stillAttached.add(row.ownerId.toString());
    }
  }

  for (const row of [...otherMembers, ...otherResidents]) {
    if (liveHostels.has(row.hostelId.toString())) {
      stillAttached.add(row.userId.toString());
    }
  }

  const toRevoke = candidateIds.filter((id) => !stillAttached.has(id.toString()));

  if (toRevoke.length === 0) {
    return 0;
  }

  const result = await SessionModel.updateMany(
    { revokedAt: null, userId: { $in: toRevoke } },
    { $set: { refreshTokenHash: null, revokedAt: new Date() } },
  );

  return result.modifiedCount ?? 0;
}

/**
 * Archive a hostel: off the public site, out of its own portal, recoverable
 * for 60 days, then erased by the `hostel-purge` cron.
 *
 * Nothing is deleted here. `isDeleted` is the switch every read in the app
 * already respects — roughly forty service files filter on it — so setting it
 * is what makes the hostel disappear from search, the map, the listing pages
 * and its own admin portal in one write. `subscription-access.ts` refuses an
 * archived hostel outright, which is what locks its staff out.
 */
export async function archivePlatformHostel(
  hostelId: string,
  input: HostelArchiveInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const objectId = normalizeObjectId(hostelId);
  const now = new Date();
  const purgeScheduledAt = new Date(
    now.getTime() + HOSTEL_ARCHIVE_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );

  // Filtered on `isDeleted: false` rather than checked after the fact, so a
  // second archive cannot quietly push the purge date out by another 60 days.
  const hostel = await HostelModel.findOneAndUpdate(
    { _id: objectId, isDeleted: false },
    {
      $set: {
        archiveReason: input.reason,
        deletedAt: now,
        deletedBy: principal.userId,
        isDeleted: true,
        purgeScheduledAt,
        updatedBy: principal.userId,
      },
    },
    { new: true },
  ).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError(
      "Hostel was not found, or is already archived.",
      "HOSTEL_NOT_FOUND",
      404,
    );
  }

  const sessionsRevoked = await revokeSessionsForArchivedHostel(objectId);

  /*
   * Off every account that listed it.
   *
   * Revoking sessions stops today's tokens; this stops tomorrow's. Left in
   * `User.hostelIds`, an archived hostel is minted into every future token for
   * that owner, and a one-hostel owner who once had a duplicate registration
   * removed is then treated as a multi-hostel account on every screen — which
   * is exactly how an owner ended up with a nameless dashboard and the deleted
   * hostel's invoices on their billing page. Restore puts it back.
   */
  await UserModel.updateMany(
    { hostelIds: objectId },
    { $pull: { hostelIds: objectId } },
  );

  await auditHostelAction(principal, objectId, "HOSTEL_ARCHIVED", {
    purgeScheduledAt: purgeScheduledAt.toISOString(),
    reason: input.reason,
    sessionsRevoked,
  });

  return { hostel: serializeHostel(hostel), sessionsRevoked };
}

/**
 * Undo an archive, while it is still an archive and not yet a purge.
 *
 * Refused once the purge date has passed: the cron may already be part-way
 * through erasing this hostel's collections, and a "restored" hostel missing
 * half its residents is worse than an honest refusal.
 *
 * `slug` and `referencePrefix` are unique platform-wide, and an archived
 * hostel keeps holding both — so the only way they can be taken while it is
 * away is by a document written outside the app. Checked anyway, because a
 * duplicate-key error surfacing from a restore button is not an answer anyone
 * can act on.
 */
export async function restorePlatformHostel(
  hostelId: string,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const objectId = normalizeObjectId(hostelId);
  const existing = await HostelModel.findOne({
    _id: objectId,
    isDeleted: true,
  }).lean<HostelRecord | null>();

  if (!existing) {
    throw new HostelServiceError(
      "Hostel was not found, or is not archived.",
      "HOSTEL_NOT_FOUND",
      404,
    );
  }

  if (existing.purgeScheduledAt && existing.purgeScheduledAt.getTime() <= Date.now()) {
    throw new HostelServiceError(
      "This hostel's 60-day grace period has run out and it is queued for erasure. It can no longer be restored.",
      "HOSTEL_PURGE_DUE",
      409,
    );
  }

  const clash = await HostelModel.findOne({
    _id: { $ne: objectId },
    isDeleted: { $ne: true },
    $or: [
      { slug: existing.slug },
      ...(existing.referencePrefix
        ? [{ referencePrefix: existing.referencePrefix }]
        : []),
    ],
  })
    .select("_id name slug referencePrefix")
    .lean<{ name?: string; slug?: string } | null>();

  if (clash) {
    throw new HostelServiceError(
      `Its address or reference code is now held by "${clash.name ?? clash.slug}". Rename that hostel before restoring this one.`,
      "HOSTEL_SLUG_TAKEN",
      409,
    );
  }

  const hostel = await HostelModel.findOneAndUpdate(
    { _id: objectId, isDeleted: true },
    {
      $set: { isDeleted: false, updatedBy: principal.userId },
      $unset: {
        archiveReason: "",
        deletedAt: "",
        deletedBy: "",
        purgeScheduledAt: "",
      },
    },
    { new: true },
  ).lean<HostelRecord | null>();

  if (!hostel) {
    throw new HostelServiceError(
      "Hostel was not found, or is not archived.",
      "HOSTEL_NOT_FOUND",
      404,
    );
  }

  /*
   * Back onto the accounts that archive took it off.
   *
   * The owner, and every warden or cook whose membership row is still active —
   * the rows themselves survive an archive, only the `User.hostelIds` entry was
   * pulled. Without this a restored hostel is live on the public site and
   * unreachable by the people who run it, because their next token would not
   * carry it.
   */
  const { HostelMemberModel } = await import("@hostel/db/models/HostelMember");
  const members = await HostelMemberModel.find({
    hostelId: objectId,
    isDeleted: { $ne: true },
    status: "ACTIVE",
  })
    .select("userId")
    .lean<Array<{ userId?: Types.ObjectId | null }>>();

  const staffIds = [
    ...(hostel.ownerId ? [hostel.ownerId] : []),
    ...members.map((member) => member.userId).filter(Boolean),
  ];

  if (staffIds.length > 0) {
    await UserModel.updateMany(
      { _id: { $in: staffIds } },
      { $addToSet: { hostelIds: objectId } },
    );
  }

  await auditHostelAction(principal, objectId, "HOSTEL_RESTORED", {
    archivedAt: existing.deletedAt?.toISOString() ?? null,
  });

  return { hostel: serializeHostel(hostel) };
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

  const ratings = await ratingSummariesFor(hostels.map((hostel) => hostel._id));

  return {
    hostels: hostels.map((hostel) => ({
      ...serializePublicHostel(hostel),
      // On the card, not only on the detail page: a rating is how somebody
      // decides which of twelve results to open, so withholding it until they
      // have opened one is withholding it from the decision it is for.
      ratingSummary: ratings.get(hostel._id.toString()) ?? EMPTY_RATING_SUMMARY,
    })),
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

  const [foodRoutine, ratings] = await Promise.all([
    getFoodRoutine(hostel._id),
    ratingSummariesFor([hostel._id]),
  ]);

  return {
    hostel: {
      ...serializePublicHostel(hostel),
      foodRoutine,
      ratingSummary: ratings.get(hostel._id.toString()) ?? EMPTY_RATING_SUMMARY,
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

  const [ratingByHostelId, routineByHostelId] = await Promise.all([
    ratingSummariesFor(hostelIds),
    // The compare screen draws the same weekly routine the detail page does,
    // so the comparison has to carry it — one query for every hostel, not one
    // per column.
    getFoodRoutinesByHostelId(hostelIds),
  ]);
  const byRequestedOrder = new Map(
    hostels.map((hostel) => [hostel._id.toString(), hostel]),
  );

  return {
    hostels: query.ids
      .map((id) => byRequestedOrder.get(id))
      .filter((hostel): hostel is HostelRecord => Boolean(hostel))
      .map((hostel) => {
        const rating =
          ratingByHostelId.get(hostel._id.toString()) ?? EMPTY_RATING_SUMMARY;

        return {
          ...serializePublicHostel(hostel),
          foodRoutine: routineByHostelId.get(hostel._id.toString()) ?? EMPTY_ROUTINE,
          // Also at the top level, so a card rendered from a compare result and
          // one rendered from the listing read the same field.
          ratingSummary: rating,
          comparison: {
            facilities: hostel.facilities ?? [],
            foodScore: rating.foodRating,
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
            // Kept here as well as at the top level: the compare screen reads
            // `comparison.*` for every row it draws, and removing this one
            // would be a breaking change to a shipped endpoint for no gain.
            ratingSummary: {
              averageRating: rating.averageRating,
              cleanlinessRating: rating.cleanlinessRating,
              safetyRating: rating.safetyRating,
              total: rating.total,
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
