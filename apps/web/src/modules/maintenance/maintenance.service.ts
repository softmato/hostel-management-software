import { Types } from "mongoose";
import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { assertHostelAccess } from "@/lib/tenant";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { MaintenanceCommentModel } from "@hostel/db/models/MaintenanceComment";
import { MaintenanceHistoryModel } from "@hostel/db/models/MaintenanceHistory";
import { MaintenanceRequestModel } from "@hostel/db/models/MaintenanceRequest";
import { ServiceProviderModel } from "@hostel/db/models/ServiceProvider";
import type {
  maintenanceCommentCreateSchema,
  maintenanceRequestCreateSchema,
  maintenanceRequestListQuerySchema,
  maintenanceStatusUpdateSchema,
} from "@/modules/maintenance/maintenance.validation";

type MaintenanceRequestCreateInput = z.infer<typeof maintenanceRequestCreateSchema>;
type MaintenanceRequestListQuery = z.infer<typeof maintenanceRequestListQuerySchema>;
type MaintenanceStatusUpdateInput = z.infer<typeof maintenanceStatusUpdateSchema>;
type MaintenanceCommentCreateInput = z.infer<typeof maintenanceCommentCreateSchema>;

type MaintenanceStatus =
  | "PENDING"
  | "CONTACTED"
  | "SCHEDULED"
  | "COMPLETED"
  | "CANCELLED";

type MaintenanceRequestRecord = {
  _id: Types.ObjectId;
  category: string;
  completedAt?: Date;
  costNote?: string;
  createdAt?: Date;
  description?: string;
  hostelId: Types.ObjectId;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  providerId?: Types.ObjectId;
  remarks?: string;
  requestedBy: Types.ObjectId;
  location?: string;
  scheduledFor?: Date;
  status: MaintenanceStatus;
  title: string;
  updatedAt?: Date;
};

type MaintenanceHistoryRecord = {
  _id: Types.ObjectId;
  action: string;
  actorId: Types.ObjectId;
  costNote?: string;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  nextStatus?: MaintenanceStatus;
  note?: string;
  previousStatus?: MaintenanceStatus;
  requestId: Types.ObjectId;
};

type MaintenanceCommentRecord = {
  _id: Types.ObjectId;
  authorId: Types.ObjectId;
  createdAt?: Date;
  hostelId: Types.ObjectId;
  message: string;
  requestId: Types.ObjectId;
  visibility: "INTERNAL" | "PROVIDER_NOTE";
};

type ServiceProviderRecord = {
  _id: Types.ObjectId;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "HIDDEN" | "INACTIVE";
};

export class MaintenanceServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "MAINTENANCE_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

function normalizeObjectId(value: string, label = "id") {
  if (!Types.ObjectId.isValid(value)) {
    throw new MaintenanceServiceError(`Invalid ${label}.`, "INVALID_OBJECT_ID", 422);
  }

  return new Types.ObjectId(value);
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

  throw new MaintenanceServiceError(
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

function serializeHistory(history: MaintenanceHistoryRecord) {
  return {
    action: history.action,
    actorId: history.actorId.toString(),
    costNote: history.costNote ?? "",
    createdAt: history.createdAt?.toISOString(),
    hostelId: history.hostelId.toString(),
    id: history._id.toString(),
    nextStatus: history.nextStatus,
    note: history.note ?? "",
    previousStatus: history.previousStatus,
    requestId: history.requestId.toString(),
  };
}

function serializeComment(comment: MaintenanceCommentRecord) {
  return {
    authorId: comment.authorId.toString(),
    createdAt: comment.createdAt?.toISOString(),
    hostelId: comment.hostelId.toString(),
    id: comment._id.toString(),
    message: comment.message,
    requestId: comment.requestId.toString(),
    visibility: comment.visibility,
  };
}

function serializeMaintenanceRequest(
  request: MaintenanceRequestRecord,
  options: {
    comments?: MaintenanceCommentRecord[];
    history?: MaintenanceHistoryRecord[];
  } = {},
) {
  return {
    category: request.category,
    comments: (options.comments ?? []).map(serializeComment),
    completedAt: request.completedAt?.toISOString(),
    costNote: request.costNote ?? "",
    createdAt: request.createdAt?.toISOString(),
    description: request.description ?? "",
    history: (options.history ?? []).map(serializeHistory),
    hostelId: request.hostelId.toString(),
    id: request._id.toString(),
    priority: request.priority,
    providerId: request.providerId?.toString(),
    remarks: request.remarks ?? "",
    requestedBy: request.requestedBy.toString(),
    location: request.location ?? "",
    scheduledFor: request.scheduledFor?.toISOString(),
    status: request.status,
    title: request.title,
    updatedAt: request.updatedAt?.toISOString(),
  };
}

async function auditMaintenanceAction(
  principal: ApiPrincipal,
  request: MaintenanceRequestRecord,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await AuditLogModel.create({
    action,
    actorId: principal.userId,
    entityId: request._id.toString(),
    entityType: "MaintenanceRequest",
    hostelId: request.hostelId,
    metadata,
  });

  // Creation, status change and comment all pass through here, so one publish
  // keeps the admin queue and the resident's request view in step.
  //
  // The assigned service provider is not covered: they are not a member of the
  // hostel, so they are not on its channel, and `request.providerId` is a
  // ServiceProvider id rather than the User id the personal channel is keyed
  // on. Their job list refreshes by polling until that lookup is worth adding.
  await publishResourceChange({
    hostelIds: [request.hostelId.toString()],
    topics: [REALTIME_TOPIC.MAINTENANCE],
  });
}

async function assertProviderApproved(providerId?: string) {
  if (!providerId) {
    return undefined;
  }

  const provider = await ServiceProviderModel.findOne({
    _id: normalizeObjectId(providerId, "service provider id"),
    isDeleted: false,
    status: "APPROVED",
  }).lean<ServiceProviderRecord | null>();

  if (!provider) {
    throw new MaintenanceServiceError(
      "Approved service provider was not found.",
      "SERVICE_PROVIDER_NOT_FOUND",
      404,
    );
  }

  return provider._id;
}

async function addHistory(
  request: MaintenanceRequestRecord,
  principal: ApiPrincipal,
  input: {
    action: string;
    costNote?: string;
    nextStatus?: MaintenanceStatus;
    note?: string;
    previousStatus?: MaintenanceStatus;
  },
) {
  return MaintenanceHistoryModel.create({
    actorId: principal.userId,
    hostelId: request.hostelId,
    requestId: request._id,
    ...input,
  }) as Promise<MaintenanceHistoryRecord>;
}

async function findScopedMaintenanceRequest(
  requestId: string,
  principal: ApiPrincipal,
  requestedHostelId?: string,
) {
  const request = await MaintenanceRequestModel.findOne({
    _id: normalizeObjectId(requestId, "maintenance request id"),
    isDeleted: false,
    ...scopedHostelFilter(principal, requestedHostelId),
  }).lean<MaintenanceRequestRecord | null>();

  if (!request) {
    throw new MaintenanceServiceError(
      "Maintenance request was not found.",
      "MAINTENANCE_REQUEST_NOT_FOUND",
      404,
    );
  }

  return request;
}

async function requestChildren(requests: MaintenanceRequestRecord[]) {
  const requestIds = requests.map((request) => request._id);

  if (requestIds.length === 0) {
    return {
      commentsByRequestId: new Map<string, MaintenanceCommentRecord[]>(),
      historyByRequestId: new Map<string, MaintenanceHistoryRecord[]>(),
    };
  }

  const [comments, histories] = await Promise.all([
    MaintenanceCommentModel.find({ requestId: { $in: requestIds } })
      .sort({ createdAt: -1 })
      .lean<MaintenanceCommentRecord[]>(),
    MaintenanceHistoryModel.find({ requestId: { $in: requestIds } })
      .sort({ createdAt: -1 })
      .lean<MaintenanceHistoryRecord[]>(),
  ]);
  const commentsByRequestId = new Map<string, MaintenanceCommentRecord[]>();
  const historyByRequestId = new Map<string, MaintenanceHistoryRecord[]>();

  for (const comment of comments) {
    const key = comment.requestId.toString();
    const grouped = commentsByRequestId.get(key) ?? [];

    grouped.push(comment);
    commentsByRequestId.set(key, grouped);
  }

  for (const history of histories) {
    const key = history.requestId.toString();
    const grouped = historyByRequestId.get(key) ?? [];

    grouped.push(history);
    historyByRequestId.set(key, grouped);
  }

  return {
    commentsByRequestId,
    historyByRequestId,
  };
}

export async function createMaintenanceRequest(
  input: MaintenanceRequestCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const hostelId = resolveAdminHostelId(principal, input.hostelId);
  const providerId = await assertProviderApproved(input.providerId);
  const request = (await MaintenanceRequestModel.create({
    category: input.category,
    costNote: input.costNote,
    createdBy: principal.userId,
    description: input.description,
    hostelId,
    location: input.location,
    priority: input.priority,
    providerId,
    remarks: input.remarks,
    requestedBy: principal.userId,
    scheduledFor: input.scheduledFor,
    status: "PENDING",
    title: input.title,
    updatedBy: principal.userId,
  })) as MaintenanceRequestRecord;
  const history = await addHistory(request, principal, {
    action: "MAINTENANCE_REQUEST_CREATED",
    nextStatus: "PENDING",
    note: "Maintenance request created.",
  });

  await auditMaintenanceAction(principal, request, "MAINTENANCE_REQUEST_CREATED", {
    category: request.category,
    providerId: request.providerId?.toString(),
  });

  return {
    request: serializeMaintenanceRequest(request, { history: [history] }),
  };
}

export async function listMaintenanceRequests(
  query: MaintenanceRequestListQuery,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const filter: Record<string, unknown> = {
    isDeleted: false,
    ...scopedHostelFilter(principal, query.hostelId),
  };

  if (query.category) {
    filter.category = query.category;
  }

  if (query.providerId) {
    filter.providerId = normalizeObjectId(query.providerId, "service provider id");
  }

  if (query.status) {
    filter.status = query.status;
  }

  const requests = await MaintenanceRequestModel.find(filter)
    .sort({ status: 1, createdAt: -1 })
    .limit(150)
    .lean<MaintenanceRequestRecord[]>();
  const { commentsByRequestId, historyByRequestId } = await requestChildren(requests);

  return {
    requests: requests.map((request) =>
      serializeMaintenanceRequest(request, {
        comments: commentsByRequestId.get(request._id.toString()),
        history: historyByRequestId.get(request._id.toString()),
      }),
    ),
    summary: {
      cancelled: requests.filter((request) => request.status === "CANCELLED").length,
      completed: requests.filter((request) => request.status === "COMPLETED").length,
      open: requests.filter((request) =>
        ["PENDING", "CONTACTED", "SCHEDULED"].includes(request.status),
      ).length,
      total: requests.length,
    },
  };
}

export async function updateMaintenanceRequestStatus(
  requestId: string,
  input: MaintenanceStatusUpdateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const request = await findScopedMaintenanceRequest(
    requestId,
    principal,
    input.hostelId,
  );
  const set: Record<string, unknown> = {
    status: input.status,
    updatedBy: principal.userId,
  };
  const unset: Record<string, ""> = {};

  if (input.costNote) {
    set.costNote = input.costNote;
  }

  if (input.scheduledFor) {
    set.scheduledFor = input.scheduledFor;
  }

  if (input.status === "COMPLETED") {
    set.completedAt = new Date();
  } else {
    unset.completedAt = "";
  }

  const update: Record<string, unknown> = { $set: set };

  if (Object.keys(unset).length > 0) {
    update.$unset = unset;
  }

  const updatedRequest = await MaintenanceRequestModel.findOneAndUpdate(
    { _id: request._id, isDeleted: false },
    update,
    { new: true },
  ).lean<MaintenanceRequestRecord | null>();

  if (!updatedRequest) {
    throw new MaintenanceServiceError(
      "Maintenance request was not found.",
      "MAINTENANCE_REQUEST_NOT_FOUND",
      404,
    );
  }

  const history = await addHistory(updatedRequest, principal, {
    action: "MAINTENANCE_STATUS_UPDATED",
    costNote: input.costNote,
    nextStatus: updatedRequest.status,
    note: input.note,
    previousStatus: request.status,
  });

  await auditMaintenanceAction(principal, updatedRequest, "MAINTENANCE_STATUS_UPDATED", {
    nextStatus: updatedRequest.status,
    previousStatus: request.status,
  });

  return {
    request: serializeMaintenanceRequest(updatedRequest, { history: [history] }),
  };
}

export async function addMaintenanceComment(
  requestId: string,
  input: MaintenanceCommentCreateInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const request = await findScopedMaintenanceRequest(
    requestId,
    principal,
    input.hostelId,
  );
  const comment = (await MaintenanceCommentModel.create({
    authorId: principal.userId,
    hostelId: request.hostelId,
    message: input.message,
    requestId: request._id,
    visibility: input.visibility,
  })) as MaintenanceCommentRecord;

  await addHistory(request, principal, {
    action: "MAINTENANCE_COMMENT_ADDED",
    note: input.message,
  });
  await auditMaintenanceAction(principal, request, "MAINTENANCE_COMMENT_ADDED");

  return {
    comment: serializeComment(comment),
    request: serializeMaintenanceRequest(request),
  };
}
