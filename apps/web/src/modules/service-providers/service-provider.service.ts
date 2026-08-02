import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { paginationMeta, paginationRange } from "@/lib/pagination";
import { escapeRegex } from "@/lib/validators";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { ServiceProviderApplicationModel } from "@hostel/db/models/ServiceProviderApplication";
import { ServiceProviderDocumentModel } from "@hostel/db/models/ServiceProviderDocument";
import { ServiceProviderModel } from "@hostel/db/models/ServiceProvider";
import { appUrl, sendNotificationEmail } from "@/modules/residents/resident-notify";
import { serviceProviderApprovedEmail } from "@hostel/shared/email/templates/service-provider/provider-approved";
import { serviceProviderRegistrationReceivedEmail } from "@hostel/shared/email/templates/service-provider/registration-received";
import { serviceProviderRejectedEmail } from "@hostel/shared/email/templates/service-provider/provider-rejected";
import type {
  hostelAdminServiceProviderListQuerySchema,
  platformServiceProviderListQuerySchema,
  publicServiceProviderListQuerySchema,
  serviceProviderRegisterSchema,
  serviceProviderRejectSchema,
} from "@/modules/service-providers/service-provider.validation";

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

/** `DOCTOR_CLINIC` → `Doctor clinic`, for email copy. */
function providerCategoryLabel(category: string) {
  const words = category.toLowerCase().split("_");

  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

function serializeProvider(provider: ServiceProviderRecord) {
  return {
    approvedAt: provider.approvedAt?.toISOString(),
    approvedBy: provider.approvedBy?.toString(),
    area: provider.area,
    availability: provider.availability ?? "",
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
    documentType: document.documentType,
    fileAssetId: document.fileAssetId?.toString(),
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

export async function registerPublicServiceProvider(input: ServiceProviderRegisterInput) {
  await connectToDatabase();

  const provider = (await ServiceProviderModel.create({
    area: input.area,
    availability: input.availability,
    category: input.category,
    city: input.city,
    description: input.description,
    email: input.email,
    experience: input.experience,
    fullName: input.fullName,
    phone: input.phone,
    photoAssetId: input.photoAssetId,
    status: "PENDING_APPROVAL",
  })) as ServiceProviderRecord;
  const application = await ServiceProviderApplicationModel.create({
    providerId: provider._id,
    snapshot: {
      area: input.area,
      category: input.category,
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
    filter.category = query.category;
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
    const email =
      status === "APPROVED"
        ? serviceProviderApprovedEmail({
            category: providerCategoryLabel(provider.category),
            directoryUrl: appUrl("/service-providers"),
            fullName: provider.fullName,
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

  return providerBundle(provider);
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

  if (query.category) {
    filter.category = query.category;
  }

  if (query.q) {
    const pattern = new RegExp(escapeRegex(query.q), "i");
    filter.$or = [
      { fullName: pattern },
      { phone: pattern },
      { area: pattern },
      { description: pattern },
    ];
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

  const [providers, counts] = await Promise.all([
    ServiceProviderModel.find({
      ...scopeFilter,
      ...(query.category ? { category: query.category } : {}),
    })
      .sort({ category: 1, area: 1, fullName: 1 })
      .limit(120)
      .lean<ServiceProviderRecord[]>(),
    ServiceProviderModel.aggregate<{ _id: string; count: number }>([
      { $match: scopeFilter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
  ]);

  const countsByCategory = counts.reduce<Record<string, number>>((totals, entry) => {
    totals[entry._id] = entry.count;
    return totals;
  }, {});

  return {
    countsByCategory,
    providers: providers.map(serializePublicProvider),
    total: counts.reduce((sum, entry) => sum + entry.count, 0),
  };
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
