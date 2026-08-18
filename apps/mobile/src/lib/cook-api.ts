/**
 * The cook portal: announce a meal, and — as of the M7 server work — actually
 * see what that meal is.
 *
 * ## What changed on the server
 *
 * Until M7 the cook had exactly one endpoint, `POST /cook/food-ready`. The menu
 * and head count they needed sat under `hostel-admin/food/*` behind
 * `requireHostelCapability("manageFood")`, which resolves to HOSTEL_ADMIN or
 * WARDEN — so the person cooking the meal could announce it and not look it up.
 * That was server gap #3. `GET /cook/today`, `GET /cook/residents` and
 * `POST /cook/food-photos` close it, gated on the same role list the announce
 * route already used.
 *
 * ## One account per hostel, and what follows from that
 *
 * `provisionCookAccount` creates a single shared kitchen login per hostel, with
 * a password the admin can also use until it is replaced. Two consequences the
 * screens depend on:
 *
 *  - **Attribution is by device, not by user.** `deviceInfo` on the announce
 *    call is the only record of *which* phone in the kitchen sent it, which is
 *    why `lib/device-info.ts` is attached to every announcement.
 *  - **`GET /cook/residents` is the thinnest list in the product** — name and
 *    room type, nothing contactable — because a shared, static credential is
 *    the one most likely to leak.
 */

import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { FoodRoutine, MealType, RoutineMeal } from "@/lib/resident-api";

/* -------------------------------------------------------------------------- */
/* Today                                                                      */
/* -------------------------------------------------------------------------- */

export type FoodReadyAnnouncement = {
  announcedAt: string;
  id: string;
  mealType: string;
  message: string;
  /** How many residents the fan-out actually reached. */
  notifiedCount: number;
};

export type CookToday = {
  /** Today's announcements only — what the four buttons should already show. */
  announced: FoodReadyAnnouncement[];
  /** `YYYY-MM-DD`, from the server's clock rather than the phone's. */
  date: string;
  hostel: { id: string; name: string };
  /** Today's weekday entries off the routine, in meal order. */
  meals: RoutineMeal[];
  /** Active residents. The same count the announcement fan-out notifies. */
  residentCount: number;
  /** The whole week, so the Menu tab needs no second request. */
  routine: FoodRoutine;
};

export async function getCookToday() {
  const response = await api.get<ApiEnvelope<{ today: CookToday }>>("/cook/today");

  return unwrap(response).today;
}

/* -------------------------------------------------------------------------- */
/* Residents                                                                  */
/* -------------------------------------------------------------------------- */

/** Deliberately three fields. See the header — there is nothing to contact. */
export type CookResident = { fullName: string; id: string; roomType: string };

export async function listCookResidents() {
  const response =
    await api.get<ApiEnvelope<{ residents: CookResident[] }>>("/cook/residents");

  return unwrap(response).residents;
}

/* -------------------------------------------------------------------------- */
/* Announce                                                                   */
/* -------------------------------------------------------------------------- */

export type FoodReadyResult = { announcement: FoodReadyAnnouncement };

/**
 * `POST /cook/food-ready`.
 *
 * ## `notifiedCount` is the field that matters
 *
 * A `201` means the announcement was *recorded*. `announcement.notifiedCount` is
 * how many residents it actually reached — and it can be zero for a hostel whose
 * residents have no accounts. A screen that reports success without reading it
 * tells a cook the hostel has been called to dinner when nobody was told.
 *
 * ## The cooldown is a real, expected failure
 *
 * `getOperationsConfig().foodReadyCooldownMinutes` caps how often the same meal
 * can be announced, and a second tap inside that window returns **429** with a
 * message naming the wait in minutes. That is not an error to swallow or retry:
 * it exists because the credential is shared and static, so it is the one guard
 * against a leaked login pushing a notification to every resident repeatedly.
 * Show the server's message.
 *
 * ## `deviceInfo`
 *
 * The only attribution there is. One login serves the whole kitchen, so the
 * device fingerprint is what distinguishes two cooks, and it is registered on
 * the first announcement rather than at sign-in — there is no cook-side
 * registration endpoint, and the announcement is the only event worth tracing.
 */
export async function announceFoodReady(input: {
  deviceInfo?: Record<string, unknown>;
  mealType: MealType;
  /** Omitted → the server builds one from today's menu for that meal. */
  message?: string;
  useMenuDescription?: boolean;
}) {
  const response = await api.post<ApiEnvelope<FoodReadyResult>>("/cook/food-ready", {
    deviceInfo: input.deviceInfo ?? {},
    mealType: input.mealType,
    ...(input.message ? { message: input.message } : {}),
    useMenuDescription: input.useMenuDescription ?? true,
  });

  return unwrap(response).announcement;
}

/** `GET /cook/food-ready` — the last 50 announcements for this hostel. */
export async function listFoodReadyLogs() {
  const response =
    await api.get<ApiEnvelope<{ logs: FoodReadyAnnouncement[] }>>("/cook/food-ready");

  return unwrap(response).logs;
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `POST /cook/food-photos` — the same `foodPhotoUploadSchema` and the same feed
 * the resident and admin routes write to. The asset itself goes through the
 * shared `/files` pipeline first (`lib/uploads.ts`); this only attaches it.
 */
export async function uploadCookFoodPhoto(input: {
  caption?: string;
  date: string;
  mealType: MealType;
  photoAssetId: string;
}) {
  const response = await api.post<ApiEnvelope<{ photo: { id: string } }>>(
    "/cook/food-photos",
    input,
  );

  return unwrap(response).photo;
}
