import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { escapeRegex } from "@/lib/validators";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { ServiceProviderApplicationModel } from "@hostel/db/models/ServiceProviderApplication";
import { ServiceProviderDocumentModel } from "@hostel/db/models/ServiceProviderDocument";
import { HostelModel } from "@hostel/db/models/Hostel";
import { MaintenanceRequestModel } from "@hostel/db/models/MaintenanceRequest";
import { ServiceProviderModel } from "@hostel/db/models/ServiceProvider";
import { UserModel } from "@hostel/db/models/User";
import { appUrl, sendNotificationEmail } from "@/modules/residents/resident-notify";
import { serviceProviderApprovedEmail } from "@hostel/shared/email/templates/service-provider/provider-approved";
import { serviceProviderRegistrationReceivedEmail } from "@hostel/shared/email/templates/service-provider/registration-received";
import { serviceProviderRejectedEmail } from "@hostel/shared/email/templates/service-provider/provider-rejected";
import { loadSiteConfig } from "@/lib/site-config-server";
import { sendIdCardEmail } from "@/modules/users/id-card-delivery.service";
import { normalizeProviderCategories } from "@/modules/service-providers/service-provider.validation";
import { notifyPlatformOfServiceProviderApplication } from "@/modules/service-providers/service-provider-notify";
import type {
  hostelAdminServiceProviderListQuerySchema,
  platformServiceProviderListQuerySchema,
  publicServiceProviderListQuerySchema,
  serviceProviderRegisterSchema,
  serviceProviderRejectSchema,
} from "@/modules/service-providers/service-provider.validation";

type MaintenanceJobRecord = {
  _id: Types.ObjectId;
  category: string;
  createdAt?: Date;
  description?: string;
  hostelId: Types.ObjectId;
  location?: string;
  priority: string;
  scheduledFor?: Date;
  status: string;
  title: string;
};

type HostelContactRecord = {
  _id: Types.ObjectId;
  contact?: { phone?: string };
  location?: { area?: string; city?: string };
  name: string;
};

type ServiceProviderRegisterInput = z.infer<typeof serviceProviderRegisterSchema>;
type PlatformServiceProviderListQuery = z.infer<
  typeof platformServiceProviderListQuerySchema
>;
type HostelAdminServiceProviderListQuery = z.infer<
  typeof hostelAdminServiceProviderListQuerySchema
>;
type ServiceProviderRejectInput = z.infer<typeof serviceProviderRejectSchema>;
type PublicServiceProviderListQuery = z.infer<
  typeof publicServiceProviderListQuerySchema
>;

type ServiceProviderStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "HIDDEN"
  | "INACTIVE";

type ServiceProviderRecord = {
  _id: Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  area: string;
  availability?: string;
  categories?: string[];
  category: string;
  city?: string;
  createdAt?: Date;
  description?: string;
  email?: string;
  experience?: string;
  fullName: string;
  hiddenAt?: Date;
  hiddenBy?: Types.ObjectId;
  phone: string;
  photoAssetId?: Types.ObjectId;
  ratingSummary?: {
    averageRating?: number;
    totalReviews?: number;
  };
  rejectionReason?: string;
  status: ServiceProviderStatus;
  updatedAt?: Date;
  /** Account that submitted the public application — the upgrade target on approval. */
  userId?: Types.ObjectId;
};

type ServiceProviderApplicationRecord = {
  _id: Types.ObjectId;
  providerId: Types.ObjectId;
  rejectionReason?: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt?: Date;
};

type ServiceProviderDocumentRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  documentType: string;
  fileAssetId?: Types.ObjectId;
  fileUrl?: string;
  providerId: Types.ObjectId;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

export class ServiceProviderServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "SERVICE_PROVIDER_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new ServiceProviderServiceError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
}

/**
 * Matches a provider on any trade they work in, not just their headline one.
 * `categories` holds the full list on multi-trade records; older records have
 * only the `category` scalar, so both are checked. Since `category` is always
 * `categories[0]`, this never double-counts.
 */
function categoryMatchFilter(category: string) {
  return { $or: [{ categories: category }, { category }] };
}

/** All trades a provider works in, tolerating pre-multi-trade records. */
function providerCategories(provider: ServiceProviderRecord) {
  return provider.categories?.length ? provider.categories : [provider.category];
}

/** `DOCTOR_CLINIC` → `Doctor clinic`, for email copy. */
function providerCategoryLabel(category: string) {
  const words = category.toLowerCase().split("_");

  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

function serializeProvider(provider: ServiceProviderRecord) {
  return {
    approvedAt: provider.approvedAt?.toISOString(),
    approvedBy: provider.approvedBy?.toString(),
    area: provider.area,
    availability: provider.availability ?? "",
    categories: providerCategories(provider),
    category: provider.category,
    city: provider.city ?? "Kathmandu",
    createdAt: provider.createdAt?.toISOString(),
    description: provider.description ?? "",
    email: provider.email ?? "",
    experience: provider.experience ?? "",
    fullName: provider.fullName,
    hiddenAt: provider.hiddenAt?.toISOString(),
    hiddenBy: provider.hiddenBy?.toString(),
    id: provider._id.toString(),
    phone: provider.phone,
    photoAssetId: provider.photoAssetId?.toString(),
    ratingSummary: provider.ratingSummary ?? {
      averageRating: 0,
      totalReviews: 0,
    },
    rejectionReason: provider.rejectionReason ?? "",
    status: provider.status,
    updatedAt: provider.updatedAt?.toISOString(),
  };
}

function serializeApplication(application: ServiceProviderApplicationRecord | null) {
  if (!application) {
    return null;
  }

  return {
    id: application._id.toString(),
    providerId: application.providerId.toString(),
    rejectionReason: application.rejectionReason ?? "",
    status: application.status,
    submittedAt: application.submittedAt?.toISOString(),
  };
}

function serializeDocument(document: ServiceProviderDocumentRecord) {
  return {
    // The review table shows when each file arrived — a licence uploaded weeks
    // after the application is worth a second look.
    createdAt: document.createdAt?.toISOString() ?? null,
    documentType: document.documentType,
    fileAssetId: document.fileAssetId?.toString() ?? null,
    fileUrl: document.fileUrl ?? "",
    id: document._id.toString(),
    providerId: document.providerId.toString(),
    status: document.status,
  };
}

async function auditProviderAction(
  principal: ApiPrincipal,
  provider: ServiceProviderRecord,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: provider._id.toString(),
    entityType: "ServiceProvider",
    metadata,
  });
}

async function findProviderOrThrow(providerId: string) {
  const provider = await ServiceProviderModel.findOne({
    _id: normalizeObjectId(providerId, "service provider id"),
    isDeleted: false,
  }).lean<ServiceProviderRecord | null>();

  if (!provider) {
    throw new ServiceProviderServiceError(
      "Service provider was not found.",
      "SERVICE_PROVIDER_NOT_FOUND",
      404,
    );
  }

  return provider;
}

async function providerBundle(provider: ServiceProviderRecord) {
  const [application, documents] = await Promise.all([
    ServiceProviderApplicationModel.findOne({
      providerId: provider._id,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .lean<ServiceProviderApplicationRecord | null>(),
    ServiceProviderDocumentModel.find({
      providerId: provider._id,
      isDeleted: false,
    }).lean<ServiceProviderDocumentRecord[]>(),
  ]);

  return {
    application: serializeApplication(application),
    documents: documents.map(serializeDocument),
    provider: serializeProvider(provider),
  };
}

/**
 * Statuses that mean "this account already has an application in play". A
 * REJECTED provider may apply again; the others may not.
 */
const ACTIVE_APPLICATION_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "HIDDEN",
  "INACTIVE",
] as const;

/**
 * Finds an account's application by the `userId` link *or* by its verified email.
 *
 * The email fallback matters for records created before the `userId` link
 * existed: without it they would be invisible to the very person who applied —
 * they would see "become a service provider" while the platform portal showed
 * their application sitting in Pending. New applications always carry a
 * `userId`, since the register route requires a session.
 *
 * The email comes from the account record, not from anything the caller sent, so
 * this cannot be used to read someone else's application.
 */
async function findOwnProvider(userId: string, filter: Record<string, unknown> = {}) {
  const objectId = normalizeObjectId(userId, "user id");
  const account = await UserModel.findById(objectId).select("email").lean<{
    email?: string;
  } | null>();
  const email = account?.email?.trim().toLowerCase();

  return ServiceProviderModel.findOne({
    ...filter,
    isDeleted: false,
    $or: [{ userId: objectId }, ...(email ? [{ email }] : [])],
  })
    .sort({ createdAt: -1 })
    .lean<ServiceProviderRecord | null>();
}

/**
 * The signed-in account's own application, or `null` if it has never applied.
 * Drives the status panel on the public registration landing page, so a returning
 * applicant sees "under review" instead of a form they would only duplicate.
 */
export async function getOwnServiceProviderApplication(userId: string) {
  await connectToDatabase();

  const provider = await findOwnProvider(userId);

  if (!provider) {
    return { provider: null };
  }

  // Matched by email on a record that predates the account link — adopt it now,
  // so approval has a concrete account to upgrade instead of just an address.
  if (!provider.userId) {
    await ServiceProviderModel.updateOne(
      { _id: provider._id, userId: { $exists: false } },
      { $set: { userId: normalizeObjectId(userId, "user id") } },
    );
  }

  const documentCount = await ServiceProviderDocumentModel.countDocuments({
    isDeleted: false,
    providerId: provider._id,
  });

  // Everything here is what this account itself submitted, so it is safe to hand
  // back — it is what the "view submitted details" panel shows. Nothing derived
  // from moderation beyond the status and the rejection reason is included.
  return {
    provider: {
      area: provider.area,
      availability: provider.availability ?? "",
      categories: providerCategories(provider),
      category: provider.category,
      city: provider.city ?? "Kathmandu",
      description: provider.description ?? "",
      documentCount,
      email: provider.email ?? "",
      experience: provider.experience ?? "",
      fullName: provider.fullName,
      id: provider._id.toString(),
      phone: provider.phone,
      rejectionReason: provider.rejectionReason ?? "",
      status: provider.status,
      submittedAt: provider.createdAt?.toISOString(),
    },
  };
}

export async function registerPublicServiceProvider(
  input: ServiceProviderRegisterInput,
  options: { userId: string },
) {
  await connectToDatabase();

  // The Google gate means a repeat submission is nearly always a double-click or
  // a re-opened tab, not a second business — one account, one live application.
  // Matches on the email too, for the same reason the status lookup does —
  // otherwise someone whose earlier application predates the `userId` link
  // could file a second one against the same address.
  const existing = await findOwnProvider(options.userId, {
    status: { $in: ACTIVE_APPLICATION_STATUSES },
  });

  if (existing) {
    throw new ServiceProviderServiceError(
      existing.status === "PENDING_APPROVAL"
        ? "You already have an application under review."
        : "This account is already registered as a service provider.",
      "SERVICE_PROVIDER_ALREADY_REGISTERED",
      409,
    );
  }

  const { categories, category } = normalizeProviderCategories(input);
  const provider = (await ServiceProviderModel.create({
    area: input.area,
    availability: input.availability,
    categories,
    category,
    city: input.city,
    description: input.description,
    email: input.email,
    experience: input.experience,
    fullName: input.fullName,
    phone: input.phone,
    photoAssetId: input.photoAssetId,
    status: "PENDING_APPROVAL",
    userId: options.userId,
  })) as ServiceProviderRecord;
  const application = await ServiceProviderApplicationModel.create({
    providerId: provider._id,
    snapshot: {
      area: input.area,
      categories,
      category,
      city: input.city,
      fullName: input.fullName,
      phone: input.phone,
    },
    status: "PENDING",
  });

  if (input.documents.length > 0) {
    await ServiceProviderDocumentModel.insertMany(
      input.documents.map((document) => ({
        documentType: document.documentType,
        fileAssetId: document.fileAssetId,
        fileUrl: document.fileUrl,
        providerId: provider._id,
        status: "PENDING",
      })),
    );
  }

  const documents = await ServiceProviderDocumentModel.find({
    providerId: provider._id,
    isDeleted: false,
  }).lean<ServiceProviderDocumentRecord[]>();

  // EMAIL_SYSTEM.md §6.1. Optional address, wrapped send — the listing is
  // already persisted and must not fail on a mail problem.
  if (provider.email) {
    await sendNotificationEmail({
      action: "service_provider_registration_received",
      to: provider.email,
      ...serviceProviderRegistrationReceivedEmail({
        category: providerCategoryLabel(provider.category),
        fullName: provider.fullName,
      }),
    });
  }

  // The applicant has been acknowledged; now tell the people who review.
  await notifyPlatformOfServiceProviderApplication({
    _id: provider._id,
    category: provider.category,
    city: provider.city,
    fullName: provider.fullName,
  });

  return {
    application: serializeApplication(application),
    documents: documents.map(serializeDocument),
    provider: serializeProvider(provider),
  };
}

export async function listPlatformServiceProviders(
  query: PlatformServiceProviderListQuery,
) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    isDeleted: false,
  };

  if (query.area) {
    filter.area = new RegExp(query.area, "i");
  }

  if (query.category) {
    Object.assign(filter, categoryMatchFilter(query.category));
  }

  if (query.status) {
    filter.status = query.status;
  }

  const { limit, skip } = paginationRange(query);

  const [providers, total] = await Promise.all([
    ServiceProviderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ServiceProviderRecord[]>(),
    ServiceProviderModel.countDocuments(filter),
  ]);

  return {
    pagination: paginationMeta(query, total),
    providers: providers.map(serializeProvider),
  };
}

async function updateProviderStatus(
  providerId: string,
  principal: ApiPrincipal,
  status: ServiceProviderStatus,
  action: string,
  input: ServiceProviderRejectInput | undefined = undefined,
) {
  await connectToDatabase();

  const existingProvider = await findProviderOrThrow(providerId);
  const set: Record<string, unknown> = {
    status,
    updatedBy: principal.userId,
  };
  const unset: Record<string, ""> = {};
  const now = new Date();

  if (status === "APPROVED") {
    set.approvedAt = now;
    set.approvedBy = principal.userId;
    unset.rejectionReason = "";
    unset.hiddenAt = "";
    unset.hiddenBy = "";
  } else if (status === "REJECTED") {
    set.rejectionReason = input?.reason ?? "Rejected by platform.";
    unset.approvedAt = "";
    unset.approvedBy = "";
  } else if (status === "HIDDEN") {
    set.hiddenAt = now;
    set.hiddenBy = principal.userId;
  }

  const update: Record<string, unknown> = { $set: set };

  if (Object.keys(unset).length > 0) {
    update.$unset = unset;
  }

  const provider = await ServiceProviderModel.findOneAndUpdate(
    { _id: existingProvider._id, isDeleted: false },
    update,
    { new: true },
  ).lean<ServiceProviderRecord | null>();

  if (!provider) {
    throw new ServiceProviderServiceError(
      "Service provider was not found.",
      "SERVICE_PROVIDER_NOT_FOUND",
      404,
    );
  }

  if (status === "APPROVED" || status === "REJECTED") {
    await ServiceProviderApplicationModel.updateMany(
      { providerId: existingProvider._id, status: "PENDING" },
      {
        $set: {
          rejectionReason: status === "REJECTED" ? input?.reason : undefined,
          reviewedAt: now,
          reviewedBy: principal.userId,
          status: status === "APPROVED" ? "APPROVED" : "REJECTED",
          updatedBy: principal.userId,
        },
      },
    );
  }

  await auditProviderAction(principal, provider, action, {
    previousStatus: existingProvider.status,
    status,
  });

  // EMAIL_SYSTEM.md §6.2 / §6.3. HIDDEN is deliberately silent — hiding is a
  // moderation action, not a decision the provider is owed an email about.
  if (provider.email && (status === "APPROVED" || status === "REJECTED")) {
    const { identity: siteIdentity } = await loadSiteConfig();
    const email =
      status === "APPROVED"
        ? serviceProviderApprovedEmail({
            category: providerCategoryLabel(provider.category),
            fullName: provider.fullName,
            jobsUrl: appUrl("/jobs"),
            siteName: siteIdentity.siteName,
          })
        : serviceProviderRejectedEmail({
            fullName: provider.fullName,
            reason: input?.reason,
          });

    await sendNotificationEmail({
      action: `service_provider_${status.toLowerCase()}`,
      html: email.html,
      subject: email.subject,
      to: provider.email,
    });
  }

  // Approval re-issues any ID card this account already holds as a provider
  // card — the conversion the registration form warned them about. Records that
  // predate the `userId` link have no account to re-issue against.
  if (status === "APPROVED" && provider.userId) {
    await sendIdCardEmail(provider.userId.toString(), "SERVICE_PROVIDER");
  }

  return providerBundle(provider);
}

/**
 * The jobs a hostel has assigned to the signed-in provider.
 *
 * The provider's only web surface: they have no portal and no hostel scope, so
 * this reads through their own approved provider record and returns nothing at
 * all for anyone else — an unapproved or non-provider account gets an empty
 * list rather than an error, because "no jobs" is exactly what they have.
 *
 * Hostel name, area and phone ride along because a job with no way to reach the
 * hostel is not actionable. Nothing about residents is included: a maintenance
 * job is about a place, not the people living in it.
 */
export async function listOwnServiceProviderJobs(userId: string) {
  await connectToDatabase();

  const provider = await findOwnProvider(userId, { status: "APPROVED" });

  if (!provider) {
    return { jobs: [] };
  }

  const requests = await MaintenanceRequestModel.find({
    isDeleted: false,
    providerId: provider._id,
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<MaintenanceJobRecord[]>();

  const hostels = await HostelModel.find({
    _id: { $in: requests.map((request) => request.hostelId) },
  })
    .select("contact location name")
    .lean<HostelContactRecord[]>();

  const hostelById = new Map(hostels.map((hostel) => [hostel._id.toString(), hostel]));

  return {
    jobs: requests.map((request) => {
      const hostel = hostelById.get(request.hostelId.toString());

      return {
        category: request.category,
        createdAt: request.createdAt?.toISOString() ?? null,
        description: request.description ?? "",
        hostelArea: hostel?.location?.area ?? "",
        hostelCity: hostel?.location?.city ?? "",
        hostelName: hostel?.name ?? "A hostel",
        hostelPhone: hostel?.contact?.phone ?? "",
        id: request._id.toString(),
        location: request.location ?? "",
        priority: request.priority,
        scheduledFor: request.scheduledFor?.toISOString() ?? null,
        status: request.status,
        title: request.title,
      };
    }),
  };
}

export function approveServiceProvider(providerId: string, principal: ApiPrincipal) {
  return updateProviderStatus(
    providerId,
    principal,
    "APPROVED",
    "SERVICE_PROVIDER_APPROVED",
  );
}

export function rejectServiceProvider(
  providerId: string,
  input: ServiceProviderRejectInput,
  principal: ApiPrincipal,
) {
  return updateProviderStatus(
    providerId,
    principal,
    "REJECTED",
    "SERVICE_PROVIDER_REJECTED",
    input,
  );
}

export function hideServiceProvider(providerId: string, principal: ApiPrincipal) {
  return updateProviderStatus(providerId, principal, "HIDDEN", "SERVICE_PROVIDER_HIDDEN");
}

export async function listApprovedServiceProvidersForHostel(
  query: HostelAdminServiceProviderListQuery,
) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    isDeleted: false,
    status: "APPROVED",
  };

  if (query.area) {
    filter.area = new RegExp(escapeRegex(query.area), "i");
  }

  // Both clauses below want `$or`, so they are combined under `$and` rather than
  // assigned to `filter.$or` in turn — the second would silently drop the first.
  const conditions: Record<string, unknown>[] = [];

  if (query.category) {
    conditions.push(categoryMatchFilter(query.category));
  }

  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    conditions.push({
      $or: [
        { fullName: pattern },
        { phone: pattern },
        { area: pattern },
        { description: pattern },
      ],
    });
  }

  if (conditions.length > 0) {
    filter.$and = conditions;
  }

  const { limit, skip } = paginationRange(query);

  const [providers, total] = await Promise.all([
    ServiceProviderModel.find(filter)
      .sort({ category: 1, area: 1, fullName: 1 })
      .skip(skip)
      .limit(limit)
      .lean<ServiceProviderRecord[]>(),
    ServiceProviderModel.countDocuments(filter),
  ]);

  return {
    pagination: paginationMeta(query, total),
    providers: providers.map(serializeProvider),
  };
}

/**
 * Public directory listing. Deliberately **not** {@link serializeProvider}: the
 * phone number is the provider's private contact detail and stays behind the
 * hostel-admin endpoint (PHASES.md §5.1 — "Contact info visible only to hostel
 * admins"). The public sees a verified profile and nothing to cold-call.
 */
function serializePublicProvider(provider: ServiceProviderRecord) {
  return {
    area: provider.area,
    availability: provider.availability ?? "",
    categories: providerCategories(provider),
    category: provider.category,
    city: provider.city ?? "Kathmandu",
    description: provider.description ?? "",
    experience: provider.experience ?? "",
    fullName: provider.fullName,
    id: provider._id.toString(),
    photoAssetId: provider.photoAssetId?.toString(),
    ratingSummary: provider.ratingSummary ?? { averageRating: 0, totalReviews: 0 },
    verified: true,
  };
}

export async function listPublicServiceProviders(query: PublicServiceProviderListQuery) {
  await connectToDatabase();

  // Location narrows what is *countable*; category only narrows what is listed.
  // Keeping them apart means the category chips still show how many providers
  // sit behind each one while a category is selected.
  const scopeFilter: Record<string, unknown> = {
    isDeleted: false,
    // HIDDEN and INACTIVE providers are approved but must not surface here.
    status: "APPROVED",
  };

  if (query.area) {
    scopeFilter.area = new RegExp(escapeRegex(query.area), "i");
  }

  if (query.city) {
    scopeFilter.city = new RegExp(escapeRegex(query.city), "i");
  }

  const [providers, counts, total] = await Promise.all([
    ServiceProviderModel.find({
      ...scopeFilter,
      ...(query.category ? categoryMatchFilter(query.category) : {}),
    })
      .sort({ category: 1, area: 1, fullName: 1 })
      .limit(120)
      .lean<ServiceProviderRecord[]>(),
    // A multi-trade provider counts once under each trade they work in, so the
    // list is unwound before grouping. `$ifNull` covers pre-multi-trade records,
    // which carry only the scalar.
    ServiceProviderModel.aggregate<{ _id: string; count: number }>([
      { $match: scopeFilter },
      {
        $project: {
          category: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$categories", []] } }, 0] },
              "$categories",
              ["$category"],
            ],
          },
        },
      },
      { $unwind: "$category" },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    // Counted separately: summing the per-category counts would count a
    // two-trade provider twice, and this drives the "registered providers" stat.
    ServiceProviderModel.countDocuments(scopeFilter),
  ]);

  const countsByCategory = counts.reduce<Record<string, number>>((totals, entry) => {
    totals[entry._id] = entry.count;
    return totals;
  }, {});

  return {
    countsByCategory,
    providers: providers.map(serializePublicProvider),
    total,
  };
}

/**
 * Full application for the platform review panel — every field the applicant
 * submitted plus their uploaded documents. Unlike the hostel-facing read this
 * one is status-agnostic: the whole point is reviewing a provider who is *not*
 * approved yet.
 */
export async function getPlatformServiceProvider(providerId: string) {
  await connectToDatabase();

  return providerBundle(await findProviderOrThrow(providerId));
}

export async function getApprovedServiceProviderForHostel(providerId: string) {
  await connectToDatabase();

  const provider = await ServiceProviderModel.findOne({
    _id: normalizeObjectId(providerId, "service provider id"),
    isDeleted: false,
    status: "APPROVED",
  }).lean<ServiceProviderRecord | null>();

  if (!provider) {
    throw new ServiceProviderServiceError(
      "Service provider was not found.",
      "SERVICE_PROVIDER_NOT_FOUND",
      404,
    );
  }

  return providerBundle(provider);
}
