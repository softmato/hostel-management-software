/**
 * SOS and emergency contacts — the resident's cut of `apps/web`'s safety module.
 *
 * Shapes mirror `serializeSOS` and `serializeEmergencyContact` in
 * `apps/web/src/modules/safety/safety.service.ts`, read from the service rather
 * than guessed from the route names (see `finance-api.ts`'s header for what
 * guessing cost the last time).
 *
 * **Night status lives in `resident-api.ts`, not here**, even though the server
 * keeps it in this same module. The resident dashboard already embeds the
 * `serializeNightStatus` shape, so its type was defined there first; a second
 * declaration here is how the two drift apart the next time the serializer
 * changes. The split follows what the *client* reads, not the server's folders.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { ResidentSummary } from "@/lib/resident-api";

/* -------------------------------------------------------------------------- */
/* SOS                                                                        */
/* -------------------------------------------------------------------------- */

export type SosAlert = {
  acknowledgedAt?: string;
  createdAt?: string;
  guardianAlertEnabled: boolean;
  hostelId: string;
  id: string;
  message: string;
  residentId: string;
  resolvedAt?: string;
  status: "ACKNOWLEDGED" | "ACTIVE" | "FALSE_ALARM" | "RESOLVED";
};

/**
 * How many people the fan-out actually reached.
 *
 * The single most important field in the response and the reason this endpoint
 * is worth awaiting: `fanOutSOSAlert` swallows its own failures, so a `201`
 * means the alert was *recorded*, not that anyone heard it. A screen that
 * reports success without reading these two numbers tells a resident in trouble
 * that help is coming when it may not be.
 */
export type SosFanout = { guardians: number; staff: number };

export type SosResult = {
  alert: SosAlert;
  notified: SosFanout;
  resident: ResidentSummary;
};

/**
 * `POST /resident/sos` (`sosCreateSchema`).
 *
 * There is no resident-facing cancel: only staff can move an alert to
 * `FALSE_ALARM`, via `PATCH /hostel-admin/sos/{id}`. That is why the countdown
 * in `components/sos-fab.tsx` runs *before* this call rather than after — once
 * it is sent, the resident cannot take it back.
 */
export async function triggerSos(input: {
  guardianAlertEnabled: boolean;
  message?: string;
}) {
  const response = await api.post<ApiEnvelope<SosResult>>("/resident/sos", input);

  return unwrap(response);
}

/* -------------------------------------------------------------------------- */
/* Emergency contacts                                                         */
/* -------------------------------------------------------------------------- */

export type EmergencyContact = {
  id: string;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
};

/**
 * `GET /resident/emergency-contacts` — **read only, and that is the server's
 * shape, not an omission here.**
 *
 * The one `EmergencyContactModel.create` in the repo is inside admin resident
 * creation (`resident.service.ts:789`); there is no resident-facing POST, PATCH
 * or DELETE. So the contacts a resident sees are whoever the hostel recorded at
 * move-in, and the app must not draw an Add button for a route that does not
 * exist.
 *
 * Already sorted `isPrimary` first, then oldest — no client-side re-sort.
 */
export async function getEmergencyContacts() {
  const response = await api.get<
    ApiEnvelope<{ contacts: EmergencyContact[]; resident: ResidentSummary }>
  >("/resident/emergency-contacts");

  return unwrap(response);
}
