/**
 * Complaints — `GET/POST /resident/complaints`, `PATCH .../[id]/confirm-resolution`.
 *
 * Typed off `apps/web/src/modules/complaints/complaint.service.ts`
 * (`serializeComplaint` / `serializeUpdate` / `serializeAttachment`) and
 * `complaint.validation.ts`, not off the route names — the rule `finance-api.ts`
 * paid for.
 *
 * ## There is no detail endpoint, and none is needed
 *
 * `listResidentComplaints` runs `complaintChildren()` and returns every
 * complaint with its `attachments` and its **entire** `updates` thread inline.
 * The detail screen therefore reads the same list and finds its row, rather than
 * a `/complaints/[id]` route that does not exist.
 *
 * ## Two things the server does not let a resident do
 *
 * 1. **Page.** The route calls `listResidentComplaints(principal)` with no
 *    second argument, so the service's default `{ page: 1, pageSize:
 *    MAX_PAGE_SIZE }` always applies: the newest 100, and no way to ask for
 *    more. `pagination` still comes back, so it is typed — but nothing sends a
 *    `page`, because the route would ignore it. Somebody with more than 100
 *    complaints cannot reach the oldest, which is a server change (parse the
 *    query in the route), not something a client can work around.
 * 2. **Reply.** `complaintReplySchema` exists but its only route is the admin
 *    one, so the thread is read-only here. No reply box is drawn.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { ResidentSummary } from "@/lib/resident-api";

export const COMPLAINT_CATEGORIES = [
  "FOOD",
  "ROOM",
  "MAINTENANCE",
  "SAFETY",
  "PAYMENT",
  "STAFF",
  "NOISE",
  "OTHER",
] as const;

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "RESOLVED",
  "REJECTED",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** `ComplaintUpdate`'s enum. `ADMIN_REPLY` and `STATUS_CHANGE` are staff-only. */
export type ComplaintUpdateType =
  | "ADMIN_REPLY"
  | "CREATED"
  | "RESIDENT_CONFIRMATION"
  | "STATUS_CHANGE";

export type ComplaintUpdate = {
  actorId: string;
  /** The `Role` enum value, shouted. `humanizeEnum` is not enough — see `lib/complaints.ts`. */
  actorRole: string;
  complaintId: string;
  createdAt?: string;
  hostelId: string;
  id: string;
  /** `""` when the actor left none — a status change usually has no words. */
  message: string;
  nextStatus?: ComplaintStatus;
  previousStatus?: ComplaintStatus;
  type: ComplaintUpdateType;
};

/**
 * A file on a complaint. Note what is *not* here: no URL, no MIME type, no
 * name — only `fileAssetId`, which has to be resolved through the authorising
 * read route. See `privateAssetSource` in `lib/uploads.ts`.
 */
export type ComplaintAttachment = {
  complaintId: string;
  fileAssetId: string;
  hostelId: string;
  id: string;
  uploadedAt: string;
  uploadedBy: string;
};

export type Complaint = {
  /**
   * The latest staff response, duplicated. `updateComplaintStatus` writes this
   * **and** appends a `STATUS_CHANGE` update carrying the same message, so
   * rendering both shows the newest reply twice. The thread wins; this field is
   * typed for completeness and deliberately not drawn.
   */
  adminResponse: string;
  attachments: ComplaintAttachment[];
  category: ComplaintCategory;
  /** Set by the resident's own confirmation, and cleared by any later status change. */
  confirmedAt?: string;
  createdAt?: string;
  description: string;
  hostelId: string;
  id: string;
  isAnonymous: boolean;
  /** Computed server-side at serialize time: still open and past `slaDueAt`. */
  isOverdue: boolean;
  rejectedAt?: string;
  residentId: string | null;
  resolvedAt?: string;
  slaBreachedAt?: string;
  slaDueAt: string;
  status: ComplaintStatus;
  title: string;
  updatedAt?: string;
  /** Oldest first — the server sorts `createdAt: 1`. */
  updates: ComplaintUpdate[];
};

export type ComplaintList = {
  complaints: Complaint[];
  /** Always page 1 of 100. The route accepts no query — see the file header. */
  pagination: {
    hasMore: boolean;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  resident: ResidentSummary;
};

export async function getResidentComplaints() {
  const response = await api.get<ApiEnvelope<ComplaintList>>("/resident/complaints");

  return unwrap(response);
}

/**
 * `attachmentAssetIds` are ids from `uploadAsset()`, capped at 5 by
 * `complaintCreateSchema`. An asset whose `complete` step never ran is a
 * reservation the hostel cannot open, so let the upload pipeline finish before
 * submitting.
 */
export async function createResidentComplaint(input: {
  attachmentAssetIds?: string[];
  category: ComplaintCategory;
  description: string;
  isAnonymous?: boolean;
  title: string;
}) {
  const response = await api.post<
    ApiEnvelope<{ complaint: Complaint; resident: ResidentSummary }>
  >("/resident/complaints", input);

  return unwrap(response).complaint;
}

/**
 * Confirms a fix. **409 `COMPLAINT_NOT_RESOLVED`** unless the complaint is
 * `RESOLVED`, so only offer this on one that is — see `canConfirmResolution`.
 */
export async function confirmComplaintResolution(
  complaintId: string,
  input: { note?: string } = {},
) {
  const response = await api.patch<ApiEnvelope<{ complaint: Complaint }>>(
    `/resident/complaints/${complaintId}/confirm-resolution`,
    input,
  );

  return unwrap(response).complaint;
}
