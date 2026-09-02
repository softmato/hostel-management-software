/**
 * The service provider surface: assigned jobs, and the provider's own record.
 *
 * ## Assigned-only, and that is the server's shape
 *
 * `GET /public/service-providers/me/jobs` returns maintenance requests where
 * `providerId` is this provider — work a hostel admin handed them by name.
 * There is no broadcast board and no claim: PHASES.md §6.1's superseded note
 * records that decision, and nothing in `apps/web` implements one. So this app
 * must not draw an "available jobs" tab; a feed that is always empty because
 * the concept does not exist reads as a broken app rather than as a product
 * boundary.
 *
 * ## There is no SERVICE_PROVIDER role
 *
 * A provider is a `PUBLIC` account with an APPROVED `ServiceProvider` record
 * behind it, which is why `constants/roles.ts` routes on the provider flag from
 * `/auth/me` rather than on `role`. Both endpoints below are gated on being
 * signed in and scoped to the caller's own record — an account that never
 * applied gets `{ provider: null }` and an empty job list, which is the truthful
 * answer rather than a 403.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/* -------------------------------------------------------------------------- */
/* The provider's own record                                                  */
/* -------------------------------------------------------------------------- */

export type ProviderApplication = {
  area: string;
  availability: string;
  categories: string[];
  category: string;
  city: string;
  description: string;
  documentCount: number;
  email: string;
  experience: string;
  fullName: string;
  id: string;
  phone: string;
  /** Only ever set on REJECTED, and written for the applicant to read. */
  rejectionReason: string;
  status: "APPROVED" | "HIDDEN" | "INACTIVE" | "PENDING_APPROVAL" | "REJECTED";
  submittedAt?: string;
};

/**
 * `GET /public/service-providers/me`.
 *
 * `null` is the normal case for most accounts — it means "never applied", not
 * an error. Any signed-in role may call it: it reads the caller's own `userId`,
 * so there is nothing to gate beyond having a session.
 */
export async function getOwnProvider() {
  const response = await api.get<ApiEnvelope<{ provider: ProviderApplication | null }>>(
    "/public/service-providers/me",
  );

  return unwrap(response).provider;
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A maintenance request assigned to this provider.
 *
 * The hostel's name, area and phone ride along because a job with no way to
 * reach the site is not actionable. **Nothing about residents is included** —
 * a maintenance job is about a place, not the people living in it — so there is
 * no name to show and none should be invented from the description.
 */
export type ProviderJob = {
  category: string;
  createdAt: string | null;
  description: string;
  hostelArea: string;
  hostelCity: string;
  hostelName: string;
  hostelPhone: string;
  id: string;
  /** Free text — "Room 204", "2nd floor bathroom". There are no room records. */
  location: string;
  priority: "HIGH" | "LOW" | "MEDIUM" | "URGENT";
  scheduledFor: string | null;
  status: "CANCELLED" | "COMPLETED" | "CONTACTED" | "PENDING" | "SCHEDULED";
  title: string;
  /**
   * The hostel describing the problem out loud, when they recorded one.
   *
   * A **PRIVATE** asset, and the only one in the product a provider can read:
   * the server's `files/{assetId}/url` widens access for `MAINTENANCE_NOTE`
   * assets to the one provider the job is assigned to, and to nobody else.
   * `<VoiceNotePlayer>` handles the token and the presigned redirect.
   */
  voiceNoteAssetId: string | null;
};

export async function listProviderJobs() {
  const response = await api.get<ApiEnvelope<{ jobs: ProviderJob[] }>>(
    "/public/service-providers/me/jobs",
  );

  return unwrap(response).jobs;
}

/** The two moves a provider may make. See `serviceProviderJobStatusSchema`. */
export type ProviderJobStatus = "COMPLETED" | "CONTACTED";

/**
 * `PATCH /public/service-providers/me/jobs/{id}`.
 *
 * Narrower than the hostel's own status route on purpose: `CANCELLED` is the
 * hostel's decision, `SCHEDULED` carries a date the provider has no field for,
 * and `PENDING` would let a provider un-finish work after being signed off.
 *
 * A closed job returns 409 (`MAINTENANCE_REQUEST_CLOSED`), and so does a write
 * that lost a race against another tap — the update is pinned server-side to
 * the status it read. Both are worth showing verbatim; the messages say what to
 * do next.
 */
export async function updateProviderJobStatus(
  jobId: string,
  input: { note?: string; status: ProviderJobStatus },
) {
  const response = await api.patch<
    ApiEnvelope<{ job: { completedAt: string | null; id: string; status: string } }>
  >(`/public/service-providers/me/jobs/${jobId}`, input);

  return unwrap(response).job;
}
