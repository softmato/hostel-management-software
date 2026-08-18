import { randomBytes } from "node:crypto";
import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { SessionModel } from "@hostel/db/models/Session";
import { TemporaryCredentialModel } from "@hostel/db/models/TemporaryCredential";
import { UserModel } from "@hostel/db/models/User";
import type { TemporaryCredentialCreateInput } from "@/modules/auth/temporary-credential.validation";

/**
 * Caps how many live credentials one account can hold. A hand-off is a one-off
 * errand, so a handful is generous; the cap is what stops a compromised session
 * from quietly seeding dozens of usernames as a persistence mechanism.
 */
export const MAX_ACTIVE_TEMPORARY_CREDENTIALS = 5;

export class TemporaryCredentialError extends Error {
  constructor(
    message: string,
    public errorCode = "TEMPORARY_CREDENTIAL_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

type CredentialRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  expiresAt: Date;
  label?: string;
  lastUsedAt?: Date | null;
  passwordHash?: string;
  revokedAt?: Date | null;
  useCount?: number;
  userId: Types.ObjectId;
  username: string;
};

/**
 * ~128 bits from a URL-safe alphabet. The owner never chooses this: a
 * self-chosen password on a credential that opens the whole account tends to be
 * the same weak one they use elsewhere, and this is the one moment it is
 * legible, so it may as well be strong.
 */
function generatePassword() {
  return randomBytes(16).toString("base64url");
}

function activeFilter() {
  return { expiresAt: { $gt: new Date() }, revokedAt: null };
}

/** The status the UI shows — a row is exactly one of these three. */
function credentialStatus(credential: {
  expiresAt: Date;
  revokedAt?: Date | null;
}): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (credential.revokedAt) {
    return "REVOKED";
  }

  return credential.expiresAt.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
}

function serializeCredential(credential: CredentialRecord) {
  return {
    createdAt: credential.createdAt?.toISOString() ?? null,
    expiresAt: credential.expiresAt.toISOString(),
    id: credential._id.toString(),
    label: credential.label ?? "",
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    status: credentialStatus(credential),
    useCount: credential.useCount ?? 0,
    /** Safe to show: it is half of the pair, and the owner has to read it out. */
    username: credential.username,
  };
}

export type SerializedTemporaryCredential = ReturnType<typeof serializeCredential>;

/**
 * Every credential the account has, newest first — live ones and the recently
 * dead, because "did the login I handed out ever get used?" is the question the
 * list mostly gets opened for.
 */
export async function listTemporaryCredentials(userId: string) {
  await connectToDatabase();

  const credentials = await TemporaryCredentialModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<CredentialRecord[]>();

  return {
    credentials: credentials.map(serializeCredential),
    limit: MAX_ACTIVE_TEMPORARY_CREDENTIALS,
  };
}

/**
 * Mints a credential and returns its password **once**. Only the bcrypt hash is
 * stored, so a password that is not written down now is gone — the recovery
 * path is to revoke and issue another, which is also why issuing is cheap.
 *
 * Callers must have already established that the actor is signed in with the
 * account's own password: a temporary session may not mint more temporary
 * credentials, or the expiry date would mean nothing.
 */
export async function createTemporaryCredential(
  userId: string,
  input: TemporaryCredentialCreateInput,
) {
  await connectToDatabase();

  const activeCount = await TemporaryCredentialModel.countDocuments({
    ...activeFilter(),
    userId,
  });

  if (activeCount >= MAX_ACTIVE_TEMPORARY_CREDENTIALS) {
    throw new TemporaryCredentialError(
      `You can have ${MAX_ACTIVE_TEMPORARY_CREDENTIALS} active temporary logins at a time. Revoke one first.`,
      "TEMPORARY_CREDENTIAL_LIMIT",
      409,
    );
  }

  // Usernames are unique platform-wide, so a clash is usually with a stranger's
  // credential rather than one of the caller's own — the message says "taken",
  // never whose.
  const taken = await TemporaryCredentialModel.exists({ username: input.username });

  if (taken) {
    throw new TemporaryCredentialError(
      "That username is already taken. Try another.",
      "TEMPORARY_CREDENTIAL_USERNAME_TAKEN",
      409,
    );
  }

  const password = generatePassword();
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

  let credential;

  try {
    credential = await TemporaryCredentialModel.create({
      createdBy: userId,
      expiresAt,
      label: input.label,
      passwordHash: await hashPassword(password),
      userId,
      username: input.username,
    });
  } catch (error) {
    // Two requests racing for the same username: the unique index is the real
    // arbiter, the `exists` check above is only there for a nicer message.
    if ((error as { code?: number }).code === 11000) {
      throw new TemporaryCredentialError(
        "That username is already taken. Try another.",
        "TEMPORARY_CREDENTIAL_USERNAME_TAKEN",
        409,
      );
    }

    throw error;
  }

  await AuditLogModel.create({
    action: "TEMPORARY_CREDENTIAL_CREATED",
    actorId: userId,
    entityId: credential._id.toString(),
    entityType: "TemporaryCredential",
    metadata: { expiresAt, username: input.username },
  });

  return {
    credential: serializeCredential(credential.toObject() as CredentialRecord),
    /** The only moment the password exists in the clear. */
    password,
  };
}

/**
 * Revokes a credential and, in the same breath, every session it opened. The
 * owner's own sessions are untouched — that separation is the whole point of
 * issuing a second credential instead of sharing the password.
 *
 * Scoped by `userId`, so someone else's credential id answers 404 exactly as a
 * non-existent one does.
 */
export async function revokeTemporaryCredential(userId: string, credentialId: string) {
  await connectToDatabase();

  if (!Types.ObjectId.isValid(credentialId)) {
    throw new TemporaryCredentialError(
      "Temporary login was not found.",
      "TEMPORARY_CREDENTIAL_NOT_FOUND",
      404,
    );
  }

  const credential = await TemporaryCredentialModel.findOneAndUpdate(
    { _id: credentialId, revokedAt: null, userId },
    { $set: { revokedAt: new Date() } },
    { new: true },
  ).lean<CredentialRecord | null>();

  if (!credential) {
    throw new TemporaryCredentialError(
      "Temporary login was not found.",
      "TEMPORARY_CREDENTIAL_NOT_FOUND",
      404,
    );
  }

  await SessionModel.updateMany(
    { revokedAt: null, temporaryCredentialId: credential._id },
    { $set: { revokedAt: new Date() } },
  );

  await AuditLogModel.create({
    action: "TEMPORARY_CREDENTIAL_REVOKED",
    actorId: userId,
    entityId: credential._id.toString(),
    entityType: "TemporaryCredential",
    metadata: { username: credential.username },
  });

  return { credential: serializeCredential(credential) };
}

/**
 * Resolves a temporary username + password to the account it opens.
 *
 * Every failure — unknown username, expired, revoked, wrong password, owner
 * suspended — returns `null` rather than a reason, so the login route cannot be
 * used to work out which temporary usernames exist.
 */
export async function authenticateTemporaryCredential(
  username: string,
  password: string,
) {
  await connectToDatabase();

  const credential = await TemporaryCredentialModel.findOne({
    ...activeFilter(),
    username,
  }).select("+passwordHash");

  if (!credential?.passwordHash) {
    return null;
  }

  if (!(await verifyPassword(password, credential.passwordHash))) {
    return null;
  }

  const owner = await UserModel.findOne({
    _id: credential.userId,
    isDeleted: { $ne: true },
    status: "ACTIVE",
  });

  if (!owner) {
    return null;
  }

  credential.lastUsedAt = new Date();
  credential.useCount = (credential.useCount ?? 0) + 1;
  await credential.save();

  return { credentialId: String(credential._id), owner };
}

/**
 * True while a credential still opens sessions. Checked on every token refresh
 * *and* on every API call made with a temporary access token, so a revoke takes
 * effect at once rather than whenever the current access token happens to
 * expire.
 */
export async function isTemporaryCredentialActive(credentialId: string) {
  if (!Types.ObjectId.isValid(credentialId)) {
    return false;
  }

  await connectToDatabase();

  return Boolean(
    await TemporaryCredentialModel.exists({ ...activeFilter(), _id: credentialId }),
  );
}
