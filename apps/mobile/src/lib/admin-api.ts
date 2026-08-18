/**
 * Hostel admin, deliberately reduced.
 *
 * This is **not** a port of the web portal. The web has 80-odd `hostel-admin/*`
 * routes covering fee schedules, billing runs, statement reconciliation, warden
 * management, room configuration and a dozen report views — none of which
 * anyone does on a phone between two other things. What is left here is the
 * short list an admin actually reaches for while away from their desk:
 *
 *  - what the hostel looks like right now (occupancy, dues, today's activity),
 *  - the four things that arrive unprompted and need a person: an inquiry, a
 *    payment claim, a complaint, an SOS,
 *  - the one decision each of those wants, and nothing else.
 *
 * Everything beyond that opens the web portal in a browser. That is a design
 * decision, not a gap — see `WEB_PORTAL_PATHS` at the bottom.
 *
 * ## Capabilities, and why a 403 here is not a bug
 *
 * A WARDEN's routes run through `requireHostelCapability`, which narrows the
 * principal's hostels to those where the flag is granted and 403s with
 * `CAPABILITY_DENIED` when none are. A HOSTEL_ADMIN holds every capability
 * implicitly. So each read below can legitimately fail for a warden while its
 * neighbour succeeds, and the alert inbox therefore loads its four sources
 * **independently and tolerantly** — one denied source must not blank the
 * other three. `settledList` is that rule.
 *
 * Shapes mirror the serializers in `apps/web/src/modules/*`, read from the
 * services rather than guessed from route names.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

/** `getHostelAdminDashboardReport`'s `report`. */
export type AdminReport = {
  complaints: number;
  foodFeedback: number;
  maintenanceRequests: number;
  /** This month's billed total — not "everything ever issued". */
  monthlyDues: number;
  nightStatusSummary: Record<string, number>;
  paidAmount: number;
  pendingPaymentProofs: number;
  publicViewsLast30Days: number;
  residents: number;
  totalPublicViews: number;
  uniquePublicVisitors: number;
  vacantBeds: number;
};

export async function getAdminReport() {
  const response =
    await api.get<ApiEnvelope<{ report: AdminReport }>>("/hostel-admin/reports/dashboard");

  return unwrap(response).report;
}

/** The subset of `serializeHostel` this app reads. */
export type AdminHostel = {
  capacitySummary: { totalBeds?: number; totalRooms?: number; vacantBeds?: number };
  contact: { email?: string; phone?: string };
  id: string;
  location: { address?: string; area?: string; city?: string };
  name: string;
  /** The tenant segment in `/{slug}/admin` — needed to open the web portal. */
  slug: string;
  status: string;
  verificationStatus: string;
};

export async function getAdminHostel() {
  const response =
    await api.get<ApiEnvelope<{ hostel: AdminHostel }>>("/hostel-admin/profile");

  return unwrap(response).hostel;
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

export type AdminInquiry = {
  createdAt?: string;
  email: string;
  id: string;
  message: string;
  name: string;
  phone: string;
  preferredRoomType: string;
  source: string;
  status: string;
};

export type AdminClaim = {
  /** Every server-side check, green or not — the same rule `Approve all` uses. */
  allGreen: boolean;
  amount: number;
  checks: { label: string; ok: boolean }[];
  confirmation: string;
  eventId: string;
  evidenceAssetId: string | null;
  evidenceMimeType: string | null;
  invoiceId: string | null;
  method: string;
  occurredAt: string;
  period: string | null;
  referenceNote: string | null;
  rejectionReason: string | null;
  residentId: string;
  residentName: string;
  status: string;
  transactionCode: string | null;
};

export type AdminComplaint = {
  adminResponse: string;
  category: string;
  createdAt?: string;
  description: string;
  id: string;
  isAnonymous: boolean;
  /** Past its SLA and still open. The reason a row is worth surfacing. */
  isOverdue: boolean;
  /** Null when the complaint is anonymous — the server withholds it. */
  residentId: string | null;
  slaDueAt: string;
  status: string;
  title: string;
};

export type AdminSosAlert = {
  acknowledgedAt?: string;
  createdAt?: string;
  guardianAlertEnabled: boolean;
  id: string;
  message: string;
  residentId: string;
  resolvedAt?: string;
  status: "ACKNOWLEDGED" | "ACTIVE" | "FALSE_ALARM" | "RESOLVED";
};

export type AdminResident = {
  email: string;
  firstName: string;
  id: string;
  lastName: string;
  monthlyFee: number;
  moveInDate: string;
  phone: string;
  residentType: string;
  roomType: string;
  status: string;
};

async function listInquiries() {
  const response = await api.get<ApiEnvelope<{ inquiries: AdminInquiry[] }>>(
    "/hostel-admin/inquiries",
    { params: { pageSize: 20, status: "NEW" } },
  );

  return unwrap(response).inquiries;
}

async function listClaims() {
  const response = await api.get<ApiEnvelope<{ events: AdminClaim[] }>>(
    "/hostel-admin/finance/events",
    { params: { status: "PENDING" } },
  );

  return unwrap(response).events;
}

async function listComplaints() {
  const response = await api.get<ApiEnvelope<{ complaints: AdminComplaint[] }>>(
    "/hostel-admin/complaints",
    { params: { pageSize: 20, sla: "overdue" } },
  );

  return unwrap(response).complaints;
}

async function listSosAlerts() {
  const response = await api.get<ApiEnvelope<{ alerts: AdminSosAlert[] }>>(
    "/hostel-admin/sos-alerts",
    { params: { pageSize: 20, status: "ACTIVE" } },
  );

  return unwrap(response).alerts;
}

export async function listAdminResidents(query: { q?: string } = {}) {
  const response = await api.get<ApiEnvelope<{ residents: AdminResident[] }>>(
    "/hostel-admin/residents",
    { params: { pageSize: 50, ...(query.q ? { q: query.q } : {}) } },
  );

  return unwrap(response).residents;
}

export type AdminAlerts = {
  claims: AdminClaim[];
  complaints: AdminComplaint[];
  /** Which sources the caller's capabilities refused. Rendered, not swallowed. */
  denied: string[];
  inquiries: AdminInquiry[];
  sos: AdminSosAlert[];
};

/**
 * Runs one source and reports a refusal instead of failing the batch.
 *
 * A warden granted `viewComplaints` but not `viewPayments` gets a 403 from the
 * claims queue and a 200 from everything else. `Promise.all` would turn that
 * into an empty error screen; a bare `.catch(() => [])` would turn it into
 * "no payment claims", which is worse — it is the guardian mistake again, an
 * empty list standing in for a denial. So the source's name is collected and
 * the inbox says which parts it could not read.
 */
async function settledList<T>(
  name: string,
  load: () => Promise<T[]>,
  denied: string[],
): Promise<T[]> {
  try {
    return await load();
  } catch {
    denied.push(name);
    return [];
  }
}

/** The four things that arrive unprompted, in one pull. */
export async function getAdminAlerts(): Promise<AdminAlerts> {
  const denied: string[] = [];

  const [sos, claims, complaints, inquiries] = await Promise.all([
    settledList("SOS alerts", listSosAlerts, denied),
    settledList("payment claims", listClaims, denied),
    settledList("complaints", listComplaints, denied),
    settledList("inquiries", listInquiries, denied),
  ]);

  return { claims, complaints, denied, inquiries, sos };
}

/* -------------------------------------------------------------------------- */
/* The three decisions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `POST /hostel-admin/finance/events/{id}/approve`.
 *
 * Settling is pinned server-side to the claim still being `PENDING`, so a
 * double tap loses the race rather than crediting the invoice twice — the
 * client does not need its own lock, only a disabled button while in flight.
 */
export async function approveClaim(eventId: string) {
  await api.post(`/hostel-admin/finance/events/${eventId}/approve`, {});
}

/**
 * `POST /hostel-admin/finance/events/{id}/reject`.
 *
 * The reason is required (3–500 chars) **and shown to the resident**, which is
 * why the mobile sheet asks for it rather than sending a canned string: a
 * rejection a resident cannot act on sends them to the hostel office to ask why.
 */
export async function rejectClaim(eventId: string, rejectionReason: string) {
  await api.post(`/hostel-admin/finance/events/${eventId}/reject`, { rejectionReason });
}

/** `POST /hostel-admin/complaints/{id}/reply` — 2–2000 chars. */
export async function replyToComplaint(complaintId: string, message: string) {
  await api.post(`/hostel-admin/complaints/${complaintId}/reply`, { message });
}

/**
 * `PATCH /hostel-admin/sos-alerts/{id}/status`.
 *
 * Mobile offers `ACKNOWLEDGED` only. Resolving an alert and marking one a false
 * alarm are judgements about whether someone is safe; they belong to whoever
 * has actually checked, at a desk, with the roster in front of them. What a
 * phone is good for is the thing that has to happen in seconds — telling the
 * resident, and the rest of the staff, that a human has seen it.
 */
export async function acknowledgeSos(alertId: string) {
  await api.patch(`/hostel-admin/sos-alerts/${alertId}/status`, {
    status: "ACKNOWLEDGED",
  });
}

/*
 * Where the reduced surface hands over to the full portal: `lib/web-portal.ts`.
 * Kept out of this file because it is pure string work and this one imports the
 * axios client, which reaches React Native and cannot be loaded by Vitest.
 */
