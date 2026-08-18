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

/**
 * Starts an email OTP challenge.
 *
 * **Email only, registration only.** This was typed with `"email" | "sms"` and
 * `"registration" | "password-reset"`, which is what the endpoint sounds like
 * it should take; `otpRequestSchema` in `apps/web` accepts
 * `z.enum(["email"])` and `z.enum(["registration"])` and rejects the rest with
 * a 400 — and each rejected call still spends one of the five attempts the
 * route allows per fifteen minutes. Password reset is a *link*, not an OTP:
 * see `forgotPassword` below.
 *
 * `devCode` is returned by the server outside production so the flow can be
 * completed on a device without waiting on mail delivery.
 */
export async function requestOtp(input: {
  channel: "email";
  identifier: string;
  purpose: "registration";
}) {
  const response = await publicApi.post<
    ApiEnvelope<{
      challengeId: string;
      delivery: unknown;
      devCode?: string;
      expiresAt: string;
    }>
  >("/auth/otp/request", input);

  return unwrap(response);
}

export async function verifyOtp(challengeId: string, code: string) {
  const response = await publicApi.post<
    ApiEnvelope<{ challengeId: string; verifiedAt: string }>
  >("/auth/otp/verify", { challengeId, code });

  return unwrap(response);
}

/**
 * Creates the account, once its OTP challenge has been verified.
 *
 * No `phone`: `registerSchema` takes email, name, `otpChallengeId` and
 * password, and Zod strips anything else — so a phone number collected here
 * would be silently dropped and the account would look, to its owner, as
 * though it had one. Phone lives on the resident profile, which activation
 * creates.
 *
 * The new account is `PUBLIC_USER`, so it lands in `(browse)`, not a
 * dashboard.
 */
export async function register(input: {
  email: string;
  name: string;
  otpChallengeId: string;
  password: string;
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

/**
 * Sends the reset link.
 *
 * **Always reports success.** `requestPasswordReset` looks the address up and
 * returns `{ requested: true }` whether or not an account exists — that is
 * deliberate on the server's side, because an endpoint that answers "no such
 * user" is an account-enumeration oracle. The screen must not claim to know
 * that mail was sent to a real inbox.
 */
export async function forgotPassword(email: string) {
  const response = await publicApi.post<ApiEnvelope<{ requested: boolean }>>(
    "/auth/forgot-password",
    { email },
  );

  return unwrap(response);
}

/**
 * Completes the reset with the token from the emailed link.
 *
 * Does **not** return a session: `resetPasswordWithToken` bumps `tokenVersion`
 * and revokes every session, which is the point — a password reset is what
 * somebody does when they think another person has their account. So the
 * screen sends them to login afterwards rather than signing them in.
 */
export async function resetPassword(input: { newPassword: string; token: string }) {
  const response = await publicApi.post<ApiEnvelope<{ reset: boolean }>>(
    "/auth/reset-password",
    input,
  );

  return unwrap(response);
}

/**
 * Sets a new password for the signed-in user.
 *
 * `currentPassword` is required **unless** the account is flagged
 * `mustChangePassword` — an admin-issued cook or warden login, which has no
 * password its owner knows to type. Either way the server revokes every
 * session and issues a fresh one, so the response has to go through
 * `startSession`; the token in memory is dead the moment this returns.
 */
export async function changePassword(input: {
  currentPassword?: string;
  newPassword: string;
}) {
  const response = await api.post<ApiEnvelope<LoginResult>>(
    "/auth/change-password",
    input,
  );

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
