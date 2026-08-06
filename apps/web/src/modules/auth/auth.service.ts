import { randomInt } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  hashToken,
  refreshTokenExpiresAt,
  signAccessToken,
  signPurposeToken,
  signRefreshToken,
  verifyAccessToken,
  verifyPurposeToken,
  verifyRefreshToken,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { Role } from "@/lib/roles";
import { landingPathForRole } from "@/lib/route-access";
import { sendEmail } from "@hostel/shared/email/sender";
import { verificationEmail } from "@hostel/shared/email/templates/auth/verification";
import { passwordResetEmail } from "@hostel/shared/email/templates/auth/password-reset";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  ResendVerificationInput,
  ResetPasswordInput,
  SignupInput,
  VerifyEmailInput,
} from "@hostel/shared/schemas/auth.schema";
import { OAuthAccountModel } from "@hostel/db/models/OAuthAccount";
import { OtpChallengeModel } from "@hostel/db/models/OtpChallenge";
import { SessionModel } from "@hostel/db/models/Session";
import { ServiceProviderModel } from "@hostel/db/models/ServiceProvider";
import { UserModel } from "@hostel/db/models/User";
import type {
  GoogleAuthInput,
  LoginInput,
  OtpRequestInput,
  OtpVerifyInput,
  RegisterInput,
} from "@/modules/auth/auth.validation";

export class AuthServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "AUTH_ERROR",
    public status = 401,
  ) {
    super(message);
  }
}

type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function publicUser(user: {
  _id: unknown;
  email?: string | null;
  emailVerified?: boolean | null;
  emailVerifiedAt?: Date | null;
  hostelIds?: unknown[];
  image?: string | null;
  mustChangePassword?: boolean | null;
  name: string;
  phone?: string | null;
  role: Role;
  status: string;
  userResidentId?: string | null;
}) {
  return {
    id: String(user._id),
    email: user.email ?? null,
    emailVerified: Boolean(user.emailVerified || user.emailVerifiedAt),
    hostelIds: (user.hostelIds ?? []).map((hostelId) => String(hostelId)),
    image: user.image ?? null,
    mustChangePassword: Boolean(user.mustChangePassword),
    name: user.name,
    phone: user.phone ?? null,
    role: user.role,
    redirectPath: landingPathForRole(user.role) ?? "/",
    status: user.status,
    // Only minted once a resident profile is saved, so the account menu can
    // offer "Create resident ID" vs "Show resident QR code" without a second call.
    userResidentId: user.userResidentId ?? null,
  };
}

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || undefined;
}

function normalizeOtpIdentifier(identifier: string) {
  return identifier.trim().toLowerCase();
}

function otpTtlMs() {
  return Number(process.env.OTP_TTL_MINUTES ?? 10) * 60 * 1000;
}

function otpRateLimitWindowMs() {
  return Number(process.env.OTP_RATE_LIMIT_WINDOW_MINUTES ?? 15) * 60 * 1000;
}

function otpRateLimitMax() {
  return Number(process.env.OTP_RATE_LIMIT_MAX ?? 5);
}

function otpResendCooldownMs() {
  return Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60) * 1000;
}

function hashOtpCode(identifier: string, code: string) {
  const secret =
    process.env.OTP_HASH_SECRET ??
    process.env.JWT_ACCESS_SECRET ??
    "development-otp-secret";

  return hashToken(`${identifier}:${code}:${secret}`);
}

function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

function otpDeliveryProvider() {
  return process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? "resend" : null;
}

function renderOtpEmail(code: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3faf8;padding:32px 16px;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dbeee8;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:28px 32px;background:#0f766e;color:#ffffff;">
          <h1 style="margin:0;font-size:22px;line-height:1.25;">HostelHub verification</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155;">Use this one-time code to verify your email and finish creating your HostelHub account.</p>
          <div style="margin:28px 0;text-align:center;">
            <span style="display:inline-block;border:1px dashed #14b8a6;border-radius:12px;background:#f0fdfa;padding:14px 24px;font-size:30px;font-weight:800;letter-spacing:8px;color:#0f766e;">${code}</span>
          </div>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">This code expires soon. If you did not request it, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendResendOtp(input: { code: string; identifier: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new AuthServiceError(
      "Resend OTP email is not configured.",
      "OTP_DELIVERY_NOT_CONFIGURED",
      503,
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      subject: "Your HostelHub verification code",
      html: renderOtpEmail(input.code),
      text: `Your HostelHub verification code is ${input.code}. It expires soon.`,
      to: [input.identifier],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new AuthServiceError("Could not send OTP email.", "OTP_DELIVERY_FAILED", 502);
  }
}

async function dispatchOtpChallenge(input: {
  channel: OtpRequestInput["channel"];
  code: string;
  identifier: string;
}) {
  const provider = otpDeliveryProvider();

  if (!provider) {
    if (process.env.NODE_ENV !== "production") {
      return {
        channel: input.channel,
        provider: "development",
        status: "development",
      };
    }

    throw new AuthServiceError(
      "OTP delivery provider is not configured.",
      "OTP_DELIVERY_NOT_CONFIGURED",
      503,
    );
  }

  if (provider === "resend") {
    await sendResendOtp(input);
  }

  return {
    channel: input.channel,
    provider,
    status: "queued",
  };
}

export async function issueSessionForUser(
  user: {
    _id: unknown;
    email?: string | null;
    hostelIds?: unknown[];
    name: string;
    phone?: string | null;
    role: Role;
    status: string;
  },
  context?: RequestContext,
) {
  const safeUser = publicUser(user);

  const session = new SessionModel({
    expiresAt: refreshTokenExpiresAt(),
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
    userId: safeUser.id,
  });
  const sessionId = String(session._id);

  const tokenInput = {
    hostelIds: safeUser.hostelIds,
    role: safeUser.role,
    sessionId,
    userId: safeUser.id,
  };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(tokenInput),
    signRefreshToken(tokenInput),
  ]);

  session.refreshTokenHash = hashToken(refreshToken);
  await session.save();

  return {
    accessToken,
    refreshToken,
    user: safeUser,
  };
}

export async function requestOtpChallenge(
  input: OtpRequestInput,
  context?: RequestContext,
) {
  await connectToDatabase();

  const identifier = normalizeOtpIdentifier(input.identifier);
  const rateLimitStartedAt = new Date(Date.now() - otpRateLimitWindowMs());
  const recentRequestCount = await OtpChallengeModel.countDocuments({
    channel: input.channel,
    createdAt: { $gte: rateLimitStartedAt },
    identifier,
    purpose: input.purpose,
  });

  if (recentRequestCount >= otpRateLimitMax()) {
    throw new AuthServiceError(
      "Too many OTP requests. Please wait before trying again.",
      "OTP_RATE_LIMITED",
      429,
    );
  }

  const latestChallenge = await OtpChallengeModel.findOne({
    channel: input.channel,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
    identifier,
    purpose: input.purpose,
  }).sort({ createdAt: -1 });

  if (
    latestChallenge?.codeLastSentAt &&
    Date.now() - new Date(latestChallenge.codeLastSentAt).getTime() <
      otpResendCooldownMs()
  ) {
    throw new AuthServiceError(
      "Please wait before requesting another OTP.",
      "OTP_RESEND_COOLDOWN",
      429,
    );
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + otpTtlMs());
  const delivery = await dispatchOtpChallenge({
    channel: input.channel,
    code,
    identifier,
  });
  const challenge = await OtpChallengeModel.create({
    channel: input.channel,
    codeHash: hashOtpCode(identifier, code),
    codeLastSentAt: new Date(),
    expiresAt,
    identifier,
    ipAddress: context?.ipAddress,
    purpose: input.purpose,
    userAgent: context?.userAgent,
  });

  return {
    challengeId: String(challenge._id),
    delivery,
    expiresAt,
    ...(process.env.NODE_ENV === "production" ? {} : { devCode: code }),
  };
}

export async function verifyOtpChallenge(input: OtpVerifyInput) {
  await connectToDatabase();

  const challenge = await OtpChallengeModel.findOne({
    _id: input.challengeId,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).select("+codeHash");

  if (!challenge) {
    throw new AuthServiceError(
      "OTP challenge is invalid or expired.",
      "OTP_INVALID",
      400,
    );
  }

  if (challenge.attempts >= 5) {
    throw new AuthServiceError(
      "Too many OTP verification attempts.",
      "OTP_ATTEMPT_LIMIT",
      429,
    );
  }

  if (challenge.codeHash !== hashOtpCode(challenge.identifier, input.code)) {
    challenge.attempts += 1;
    await challenge.save();

    throw new AuthServiceError("OTP code is incorrect.", "OTP_INCORRECT", 400);
  }

  challenge.verifiedAt = new Date();
  await challenge.save();

  return {
    challengeId: String(challenge._id),
    channel: challenge.channel,
    identifier: challenge.identifier,
    verifiedAt: challenge.verifiedAt,
  };
}

async function findVerifiedRegistrationChallenge(input: RegisterInput) {
  const email = normalizeEmail(input.email);
  const challenge = await OtpChallengeModel.findOne({
    _id: input.otpChallengeId,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
    purpose: "registration",
    verifiedAt: { $ne: null },
  });

  if (!challenge) {
    throw new AuthServiceError(
      "A verified registration OTP is required.",
      "REGISTRATION_OTP_REQUIRED",
      400,
    );
  }

  const challengeMatchesEmail =
    challenge.channel === "email" && email === challenge.identifier;

  if (!challengeMatchesEmail) {
    throw new AuthServiceError(
      "Verified OTP does not match this registration.",
      "REGISTRATION_OTP_MISMATCH",
      400,
    );
  }

  return challenge;
}

export async function registerPublicAccount(
  input: RegisterInput,
  context?: RequestContext,
) {
  await connectToDatabase();

  const email = normalizeEmail(input.email);
  if (!email) {
    throw new AuthServiceError("Email is required.", "EMAIL_REQUIRED", 400);
  }

  const existingUser = await UserModel.findOne({
    email,
    isDeleted: { $ne: true },
  });

  if (existingUser) {
    throw new AuthServiceError(
      "An account already exists for this email.",
      "ACCOUNT_ALREADY_EXISTS",
      409,
    );
  }

  const challenge = await findVerifiedRegistrationChallenge({
    ...input,
    email,
  });
  const now = new Date();
  const user = await UserModel.create({
    email,
    emailVerifiedAt: challenge.channel === "email" ? now : undefined,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    role: Role.PUBLIC,
    status: "ACTIVE",
  });

  challenge.consumedAt = now;
  await challenge.save();

  return issueSessionForUser(user, context);
}

async function verifyGoogleIdToken(input: GoogleAuthInput) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;

  if (!googleClientId) {
    throw new AuthServiceError(
      "Google auth is not configured.",
      "GOOGLE_AUTH_NOT_CONFIGURED",
      503,
    );
  }

  try {
    const { payload } = await jwtVerify(input.idToken, GOOGLE_JWKS, {
      audience: googleClientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const subject = typeof payload.sub === "string" ? payload.sub : null;
    const email =
      typeof payload.email === "string" ? normalizeEmail(payload.email) : null;
    const emailVerified = payload.email_verified === true;

    if (!subject || !email || !emailVerified) {
      throw new AuthServiceError(
        "Google account email must be verified.",
        "GOOGLE_EMAIL_UNVERIFIED",
        401,
      );
    }

    const picture =
      typeof payload.picture === "string" && payload.picture.trim().length > 0
        ? payload.picture.trim()
        : null;

    return {
      email,
      name:
        typeof payload.name === "string" && payload.name.trim().length > 0
          ? payload.name.trim()
          : email,
      picture,
      providerAccountId: subject,
    };
  } catch (error) {
    if (error instanceof AuthServiceError) {
      throw error;
    }

    throw new AuthServiceError(
      "Google sign-in token is invalid.",
      "GOOGLE_TOKEN_INVALID",
      401,
    );
  }
}

export async function authenticateWithGoogle(
  input: GoogleAuthInput,
  context?: RequestContext,
) {
  const googleAccount = await verifyGoogleIdToken(input);

  await connectToDatabase();

  const linkedAccount = await OAuthAccountModel.findOne({
    isDeleted: { $ne: true },
    provider: "google",
    providerAccountId: googleAccount.providerAccountId,
  });
  const linkedUser = linkedAccount
    ? await UserModel.findOne({
        _id: linkedAccount.userId,
        isDeleted: { $ne: true },
      })
    : null;

  // The linked user still exists but has been suspended/archived — a real denial.
  if (linkedUser && linkedUser.get("status") !== "ACTIVE") {
    throw new AuthServiceError(
      "Linked Google account no longer has access.",
      "USER_INACTIVE",
      401,
    );
  }

  // The linked user row is gone entirely (hard-deleted). The link is stale, not a
  // denial: fall through to email match / fresh signup and repoint it below.
  const orphanedLink = Boolean(linkedAccount) && !linkedUser;
  let user = linkedUser;

  if (!user) {
    user = await UserModel.findOne({
      email: googleAccount.email,
      isDeleted: { $ne: true },
      status: "ACTIVE",
    });
  }

  if (!user) {
    user = await UserModel.create({
      authProvider: "GOOGLE",
      email: googleAccount.email,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      googleId: googleAccount.providerAccountId,
      image: googleAccount.picture,
      name: googleAccount.name,
      role: Role.PUBLIC,
      status: "ACTIVE",
    });
  } else {
    let changed = false;

    if (googleAccount.picture && !user.get("image")) {
      user.set("image", googleAccount.picture);
      changed = true;
    }

    if (!user.get("googleId")) {
      user.set("googleId", googleAccount.providerAccountId);
      changed = true;
    }

    if (!user.get("emailVerified") && !user.get("emailVerifiedAt")) {
      user.set("emailVerified", true);
      user.set("emailVerifiedAt", new Date());
      changed = true;
    }

    if (changed) {
      await user.save();
    }
  }

  if (orphanedLink && linkedAccount) {
    // Reuse the stale row rather than creating a second one — {provider,
    // providerAccountId} is uniquely indexed.
    linkedAccount.set("email", googleAccount.email);
    linkedAccount.set("userId", user._id);
    linkedAccount.set("linkedAt", new Date());
    await linkedAccount.save();
  } else if (!linkedAccount) {
    await OAuthAccountModel.create({
      email: googleAccount.email,
      provider: "google",
      providerAccountId: googleAccount.providerAccountId,
      userId: user._id,
    });
  }

  return issueSessionForUser(user, context);
}

export async function login(input: LoginInput, context?: RequestContext) {
  await connectToDatabase();

  const identifier = input.identifier.trim().toLowerCase();
  // INVITED covers admin-issued accounts (wardens, cooks, upgraded admins)
  // logging in for the first time with their emailed temporary password.
  const user = await UserModel.findOne({
    email: identifier,
    isDeleted: { $ne: true },
    status: { $in: ["ACTIVE", "INVITED"] },
  }).select("+passwordHash");

  if (!user?.passwordHash) {
    throw new AuthServiceError("Invalid credentials.", "INVALID_CREDENTIALS");
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw new AuthServiceError("Invalid credentials.", "INVALID_CREDENTIALS");
  }

  if (!user.emailVerified && !user.emailVerifiedAt) {
    throw new AuthServiceError(
      "Email is not verified. Check your inbox for the verification link.",
      "EMAIL_NOT_VERIFIED",
      403,
    );
  }

  user.lastLoginAt = new Date();
  if (user.status === "INVITED") {
    user.status = "ACTIVE";
  }
  await user.save();

  return issueSessionForUser(user, context);
}

export async function refreshAccessToken(refreshToken: string) {
  await connectToDatabase();

  const payload = await verifyRefreshToken(refreshToken);
  const refreshTokenHash = hashToken(refreshToken);
  const session = await SessionModel.findOne({
    _id: payload.sessionId,
    expiresAt: { $gt: new Date() },
    refreshTokenHash,
    revokedAt: null,
  });

  if (!session) {
    throw new AuthServiceError("Refresh session is invalid.", "INVALID_SESSION");
  }

  const user = await UserModel.findOne({
    _id: payload.sub,
    isDeleted: { $ne: true },
    status: "ACTIVE",
  });

  if (!user) {
    throw new AuthServiceError("User no longer has access.", "USER_INACTIVE");
  }

  session.lastSeenAt = new Date();
  const safeUser = publicUser(user);
  const tokenInput = {
    hostelIds: safeUser.hostelIds,
    role: safeUser.role,
    sessionId: String(session._id),
    userId: safeUser.id,
  };
  const [accessToken, nextRefreshToken] = await Promise.all([
    signAccessToken(tokenInput),
    signRefreshToken(tokenInput),
  ]);

  session.refreshTokenHash = hashToken(nextRefreshToken);
  await session.save();

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    user: safeUser,
  };
}

export async function getCurrentUser(accessToken: string) {
  await connectToDatabase();

  const payload = await verifyAccessToken(accessToken);
  const user = await UserModel.findOne({
    _id: payload.sub,
    isDeleted: { $ne: true },
    status: "ACTIVE",
  });

  if (!user) {
    throw new AuthServiceError("User no longer has access.", "USER_INACTIVE");
  }

  /*
   * There is no SERVICE_PROVIDER role — a provider is a PUBLIC account with an
   * approved provider record — so the header cannot tell from the role alone
   * which navigation to draw. Resolving it here rather than in a second client
   * request means the answer arrives with the session, in one round trip, and
   * the nav never renders the wrong set first.
   *
   * Only asked for PUBLIC accounts: no other role can hold a provider listing,
   * and this runs on every /me call.
   */
  const isServiceProvider =
    user.role === Role.PUBLIC &&
    Boolean(
      await ServiceProviderModel.exists({
        isDeleted: false,
        status: "APPROVED",
        userId: user._id,
      }),
    );

  return { ...publicUser(user), isServiceProvider };
}

export async function logout(refreshToken: string) {
  await connectToDatabase();

  await SessionModel.updateOne(
    { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

// --- Phase 1 email-verification + password flows (ARCHITECTURE.md §3.1) ---

const VERIFY_EMAIL_TTL_HOURS = 24;
const PASSWORD_RESET_TTL_MINUTES = 60;

function appBaseUrl() {
  return (
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  );
}

async function revokeAllSessions(userId: unknown) {
  await SessionModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * Returns an account to the plain public role it had before a hostel took it
 * on — used when a resident profile is deleted. The account itself is
 * untouched: still ACTIVE, still signed in, still holding its history. It
 * simply stops being a resident, so `/resident` is no longer its to open and
 * it lands on the public site instead.
 *
 * Sessions are deliberately *not* revoked and `tokenVersion` is deliberately
 * *not* bumped — either would sign the person out, which is the opposite of
 * the intent. `refreshAccessToken` re-reads the role from here, so the next
 * refresh hands the browser a PUBLIC token; until then the access token in
 * hand still claims RESIDENT, for at most ACCESS_TOKEN_TTL (15 min default).
 */
export async function demoteToPublicAccount(userId: unknown) {
  await connectToDatabase();

  await UserModel.updateOne(
    { _id: userId, isDeleted: { $ne: true }, role: Role.RESIDENT },
    { $set: { role: Role.PUBLIC } },
  );
}

async function dispatchVerificationEmail(user: { _id: unknown; email?: string | null }) {
  if (!user.email) {
    return;
  }

  const token = await signPurposeToken({
    userId: String(user._id),
    purpose: "verify-email",
    ttlSeconds: VERIFY_EMAIL_TTL_HOURS * 60 * 60,
  });
  const verifyUrl = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to: user.email,
    ...verificationEmail({ verifyUrl, expiresInHours: VERIFY_EMAIL_TTL_HOURS }),
  });
}

/**
 * Docs-standard signup (API.md §2): creates a PUBLIC account with
 * emailVerified=false and sends a verification link. No session is issued —
 * the user logs in after verifying.
 */
export async function signupWithEmailVerification(input: SignupInput) {
  await connectToDatabase();

  const email = normalizeEmail(input.email);

  if (!email) {
    throw new AuthServiceError("Email is required.", "EMAIL_REQUIRED", 400);
  }

  const existingUser = await UserModel.findOne({ email, isDeleted: { $ne: true } });

  if (existingUser) {
    throw new AuthServiceError(
      "An account already exists for this email.",
      "ACCOUNT_ALREADY_EXISTS",
      409,
    );
  }

  const user = await UserModel.create({
    authProvider: "LOCAL",
    email,
    emailVerified: false,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    role: Role.PUBLIC,
    status: "ACTIVE",
  });

  await dispatchVerificationEmail(user);

  return { email, userId: String(user._id) };
}

export async function verifyEmailWithToken(input: VerifyEmailInput) {
  await connectToDatabase();

  let payload;

  try {
    payload = await verifyPurposeToken(input.token, "verify-email");
  } catch {
    throw new AuthServiceError(
      "Verification link is invalid or expired.",
      "VERIFICATION_TOKEN_INVALID",
      400,
    );
  }

  const user = await UserModel.findOne({ _id: payload.sub, isDeleted: { $ne: true } });

  if (!user) {
    throw new AuthServiceError("Account no longer exists.", "USER_INACTIVE", 401);
  }

  if (!user.emailVerified) {
    user.emailVerified = true;
    user.emailVerifiedAt ??= new Date();
    await user.save();
  }

  return { verified: true };
}

/** Always returns success — never reveals whether the email exists. */
export async function resendVerificationEmail(input: ResendVerificationInput) {
  await connectToDatabase();

  const email = normalizeEmail(input.email);
  const user = email
    ? await UserModel.findOne({ email, isDeleted: { $ne: true } })
    : null;

  if (user && !user.emailVerified && !user.emailVerifiedAt) {
    await dispatchVerificationEmail(user);
  }

  return { requested: true };
}

/** Always returns success — never reveals whether the email exists. */
export async function requestPasswordReset(input: ForgotPasswordInput) {
  await connectToDatabase();

  const email = normalizeEmail(input.email);
  const user = email
    ? await UserModel.findOne({ email, isDeleted: { $ne: true }, status: "ACTIVE" })
    : null;

  if (user?.email) {
    const token = await signPurposeToken({
      userId: String(user._id),
      purpose: "password-reset",
      ttlSeconds: PASSWORD_RESET_TTL_MINUTES * 60,
      tokenVersion: user.tokenVersion ?? 0,
    });
    const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: user.email,
      ...passwordResetEmail({ resetUrl, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES }),
    });
  }

  return { requested: true };
}

export async function resetPasswordWithToken(input: ResetPasswordInput) {
  await connectToDatabase();

  let payload;

  try {
    payload = await verifyPurposeToken(input.token, "password-reset");
  } catch {
    throw new AuthServiceError(
      "Reset link is invalid or expired.",
      "RESET_TOKEN_INVALID",
      400,
    );
  }

  const user = await UserModel.findOne({
    _id: payload.sub,
    isDeleted: { $ne: true },
  }).select("+passwordHash");

  if (!user) {
    throw new AuthServiceError("Account no longer exists.", "USER_INACTIVE", 401);
  }

  if ((user.tokenVersion ?? 0) !== (payload.tokenVersion ?? 0)) {
    throw new AuthServiceError(
      "Reset link is no longer valid.",
      "RESET_TOKEN_STALE",
      400,
    );
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  await revokeAllSessions(user._id);

  return { reset: true };
}

/**
 * Change password for the authenticated user. `currentPassword` is required
 * unless the account is flagged `mustChangePassword` (admin-issued temp
 * password, API.md §2). Revokes every session and issues a fresh one so the
 * caller stays logged in.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  context?: RequestContext,
) {
  await connectToDatabase();

  const user = await UserModel.findOne({
    _id: userId,
    isDeleted: { $ne: true },
    status: "ACTIVE",
  }).select("+passwordHash");

  if (!user) {
    throw new AuthServiceError("User no longer has access.", "USER_INACTIVE", 401);
  }

  if (!user.mustChangePassword) {
    if (!input.currentPassword) {
      throw new AuthServiceError(
        "Current password is required.",
        "CURRENT_PASSWORD_REQUIRED",
        400,
      );
    }

    const currentMatches =
      user.passwordHash &&
      (await verifyPassword(input.currentPassword, user.passwordHash));

    if (!currentMatches) {
      throw new AuthServiceError(
        "Current password is incorrect.",
        "INVALID_CREDENTIALS",
        401,
      );
    }
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();
  await revokeAllSessions(user._id);

  return issueSessionForUser(user, context);
}
