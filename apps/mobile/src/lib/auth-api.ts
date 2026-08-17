/**
 * Auth endpoints, typed.
 *
 * `login`/`register`/`refresh` go through `publicApi` (no interceptors) so a
 * bad password reads as a bad password rather than kicking off a refresh cycle.
 */

import { api, publicApi } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type { Role } from "@/constants/roles";

/** Exactly `publicUser()` + `isServiceProvider` from apps/web's auth.service.ts. */
export type ApiUser = {
  email: string | null;
  emailVerified: boolean;
  hostelIds: string[];
  id: string;
  image: string | null;
  /** Provisioned accounts (cook, warden) must set their own password first. */
  mustChangePassword: boolean;
  /** Present on /auth/me only. No SERVICE_PROVIDER role exists — this is the flag. */
  isServiceProvider?: boolean;
  name: string;
  phone: string | null;
  redirectPath: string;
  role: Role;
  status: string;
  userResidentId: string | null;
};

export type LoginResult = {
  accessToken: string;
  /** Only returned because we send the mobile client header. */
  refreshToken: string;
  user: ApiUser;
};

export async function login(identifier: string, password: string) {
  const response = await publicApi.post<ApiEnvelope<LoginResult>>("/auth/login", {
    identifier,
    password,
  });

  return unwrap(response);
}

export async function requestOtp(input: {
  channel: "email" | "sms";
  identifier: string;
  purpose: "registration" | "password-reset";
}) {
  const response = await publicApi.post<
    ApiEnvelope<{ challengeId: string; devCode?: string; expiresAt: string }>
  >("/auth/otp/request", input);

  return unwrap(response);
}

export async function verifyOtp(challengeId: string, code: string) {
  const response = await publicApi.post<
    ApiEnvelope<{ challengeId: string; verifiedAt: string }>
  >("/auth/otp/verify", { challengeId, code });

  return unwrap(response);
}

export async function register(input: {
  email: string;
  name: string;
  otpChallengeId: string;
  password: string;
  phone?: string;
}) {
  const response = await publicApi.post<ApiEnvelope<LoginResult>>("/auth/register", input);

  return unwrap(response);
}

export async function signInWithGoogle(idToken: string) {
  const response = await publicApi.post<ApiEnvelope<LoginResult>>("/auth/google", {
    idToken,
  });

  return unwrap(response);
}

export async function forgotPassword(email: string) {
  const response = await publicApi.post<ApiEnvelope<null>>("/auth/forgot-password", {
    email,
  });

  return unwrap(response);
}

export async function fetchMe() {
  const response = await api.get<ApiEnvelope<{ user: ApiUser }>>("/auth/me");

  return unwrap(response).user;
}

/**
 * Whether a RESIDENT account has redeemed its QR code yet.
 *
 * `/auth/me` cannot answer this — activation lives on the resident profile, not
 * the user record — so the boot gate trusts its cached copy and this refreshes
 * it in the background.
 */
export async function fetchActivationStatus() {
  const response = await api.get<
    ApiEnvelope<{ isActivated: boolean; resident: unknown | null }>
  >("/resident/activation-status");

  return unwrap(response).isActivated;
}

/**
 * Redeem a QR activation code.
 *
 * ## This is an authenticated call
 *
 * The route runs `requireApiPrincipal` before anything else
 * (`api/v1/resident/activate/route.ts`), so it goes through `api`, not
 * `publicApi`. Activation *links an existing account* to a resident profile —
 * it promotes the signed-in user to `RESIDENT`, adds the hostel to their
 * `hostelIds`, and marks the code used. There is no way to redeem a code
 * without first having an account.
 *
 * ## It returns a whole new session
 *
 * `activateResident` ends with `issueSessionForUser(user)`, so the response
 * carries fresh `accessToken`/`refreshToken` plus the *updated* user — the one
 * whose role is now `RESIDENT`. The old access token still names the old role,
 * so the tokens have to be written and the account replaced (`startSession`),
 * not just re-fetched. Logging in again afterwards would be a second session
 * for no reason.
 */
export type ActivationResult = LoginResult & {
  activation: {
    expiresAt: string;
    hostelId: string;
    id: string;
    residentId: string;
    status: string;
    usedAt?: string;
  };
  /** `serializeResidentSummary` — same shape as `ResidentSummary` in resident-api. */
  resident: { fullName: string; hostelId: string; id: string; roomType: string };
};

export async function activateResident(input: {
  code: string;
  /** Feeds the admin's device-fingerprint record on the `QRActivation` row. */
  deviceInfo: Record<string, unknown>;
  sessionInfo: Record<string, unknown>;
}) {
  const response = await api.post<ApiEnvelope<ActivationResult>>(
    "/resident/activate",
    input,
  );

  return unwrap(response);
}

export async function logout(refreshToken: string) {
  await publicApi.post("/auth/logout", { refreshToken }).catch(() => {
    // A failed revoke must not trap the user in a session they asked to leave.
    // The local tokens are cleared regardless; the server session expires on
    // its own TTL.
  });
}
