/**
 * `GET`/`DELETE /resident/attendance`, `POST /resident/consent`,
 * `POST /resident/location/ping`.
 *
 * Split from `attendance.ts` so the types and the wording there stay importable
 * by the node-only test runner — `lib/api` pulls in `react-native`, whose Flow
 * source vitest cannot parse.
 *
 * ## The ping takes a coordinate and this module keeps none
 *
 * `sendLocationPing` is the one function in the app that handles a lat/lng bound
 * for the network. It takes the pair, posts it, and returns the **zone** the
 * server derived. Nothing is stored, cached or dispatched to Redux on the way
 * through — `redux-persist` writes Redux to disk, and a coordinate on disk is a
 * location history. `lib/location.ts` holds the same line for the same reason,
 * and `apps/web` has a test on the server half of it.
 *
 * ## Three refusals that are not errors
 *
 * `recordLocationPing` throws in three cases a caller must expect rather than
 * report:
 *
 * - **403 `LOCATION_CONSENT_REQUIRED`** — the resident has not consented, or has
 *   withdrawn it. Correct and final; do not retry, do not prompt again here.
 * - **409 `ATTENDANCE_DISABLED`** — the hostel has the feature switched off
 *   (`enabled` defaults to `false`). Nothing the resident can do.
 * - A hostel with **no pin** does not throw at all — it records `UNKNOWN`, which
 *   is the honest answer rather than a guessed `INSIDE`.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { AttendanceZone, ResidentAttendance } from "@/lib/attendance";

/** `GET /resident/attendance` — the last 60 days, newest first, zones only. */
export async function getResidentAttendance() {
  const response =
    await api.get<ApiEnvelope<ResidentAttendance>>("/resident/attendance");

  return unwrap(response);
}

/**
 * `POST /resident/consent`.
 *
 * `hasLocationConsent` reads the **most recent** entry rather than any entry, so
 * consent is genuinely revocable and this is the call that revokes it. The
 * server keeps the whole `ConsentLog` trail; withdrawing does not erase the
 * history the pings already produced — `deleteLocationHistory` is that, and it
 * is a separate decision the screen presents separately.
 */
export async function setLocationConsent(granted: boolean) {
  const response = await api.post<
    ApiEnvelope<{ consentType: string; granted: boolean }>
  >("/resident/consent", { consentType: "LOCATION_TRACKING", granted });

  return unwrap(response);
}

/**
 * `DELETE /resident/attendance` — the resident erasing their own history.
 *
 * Irreversible, and it takes the hostel's copy with it: these are the same rows
 * the warden's attendance board reads. The screen says so before calling this.
 */
export async function deleteLocationHistory() {
  const response = await api.delete<ApiEnvelope<{ deleted: number }>>(
    "/resident/attendance",
  );

  return unwrap(response);
}

/**
 * `POST /resident/location/ping` — one reading, one zone back.
 *
 * The coordinate goes in and does not come back: the response carries the day,
 * the source and the derived zone. See this file's header for why nothing here
 * retains the pair.
 */
export async function sendLocationPing(input: {
  lat: number;
  lng: number;
  recordedAt?: string;
}) {
  const response = await api.post<
    ApiEnvelope<{ attendance: { day: string; source: string; zone: AttendanceZone } }>
  >("/resident/location/ping", input);

  return unwrap(response).attendance;
}
