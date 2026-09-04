import { randomBytes } from "node:crypto";
import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { Role } from "@/lib/roles";
import { landingPathForRole } from "@/lib/route-access";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { UserModel } from "@hostel/db/models/User";
import { sendEmail } from "@hostel/shared/email/sender";
import { accountUpgradedEmail } from "@hostel/shared/email/templates/auth/account-upgraded";
import { credentialsIssuedEmail } from "@hostel/shared/email/templates/auth/credentials-issued";

type UserRecord = {
  _id: Types.ObjectId;
  createdAt?: Date;
  demoDataLabel?: string;
  email?: string;
  hostelIds?: Types.ObjectId[];
  isDemoData?: boolean;
  lastLoginAt?: Date;
  name?: string;
  phone?: string;
  role?: string;
  status?: string;
};

function serializeUser(user: UserRecord) {
  return {
    createdAt: user.createdAt?.toISOString(),
    demoDataLabel: user.demoDataLabel ?? "",
    email: user.email,
    hostelIds: (user.hostelIds ?? []).map((hostelId) => hostelId.toString()),
    id: user._id.toString(),
    isDemoData: Boolean(user.isDemoData),
    lastLoginAt: user.lastLoginAt?.toISOString(),
    name: user.name ?? "Unnamed user",
    phone: user.phone,
    role: user.role ?? "PUBLIC",
    status: user.status ?? "ACTIVE",
  };
}

export async function listPlatformUsers() {
  await connectToDatabase();

  const users = await UserModel.find({ isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(250)
    .lean<UserRecord[]>();

  return {
    users: users.map(serializeUser),
  };
}

// --- Account upgrade mechanism (ARCHITECTURE.md §3.2) ---

export class UserServiceError extends Error {
  constructor(
    message: string,
    public errorCode = "USER_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

const ADMIN_ISSUABLE_ROLES = [
  Role.HOSTEL_ADMIN,
  Role.WARDEN,
  Role.RESIDENT,
  Role.GUARDIAN,
] as const;

export type AdminIssuableRole = (typeof ADMIN_ISSUABLE_ROLES)[number];

/**
 * Roles whose upgrade must not take effect on a bare email match alone
 * (ARCHITECTURE.md §3.2 security safeguard). Raising a PUBLIC account to one of
 * these requires the recipient to prove mailbox control — see the PUBLIC branch
 * in {@link registerOrUpgradeUserByEmail}.
 */
const HIGH_PRIVILEGE_ROLES = new Set<string>([Role.HOSTEL_ADMIN, Role.SUPERADMIN]);

const ROLE_LABELS: Record<string, string> = {
  [Role.HOSTEL_ADMIN]: "Hostel Admin",
  [Role.WARDEN]: "Warden",
  [Role.RESIDENT]: "Resident",
  [Role.GUARDIAN]: "Guardian",
};

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

function loginUrl() {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/login`;
}

export type RegisterOrUpgradeInput = {
  email: string;
  name?: string;
  phone?: string;
  role: AdminIssuableRole;
  hostelId?: string;
  hostelName?: string;
  performedBy?: string;
  sendEmailNotification?: boolean;
  /**
   * The exact account to upgrade, when the caller has already resolved one.
   *
   * An email is not an identity. Nothing stops two rows sharing an address — an
   * `INVITED` warden who never signed in and the `PUBLIC` account the same
   * person actually uses is the pairing that happens in practice — and
   * `findOne({ email })` then returns whichever Mongo reaches first. Resident
   * intake had *already* resolved the right account from the card it scanned,
   * threw that away, matched the warden row instead, and refused the upgrade
   * with `EMAIL_ALREADY_HAS_ROLE`: the resident was registered, mailed their
   * welcome, and left signed in as a public user with no portal.
   *
   * So a caller holding an id says so, and the email is used only for what it
   * is actually good for — addressing the mail. A pinned account that no longer
   * exists is an error rather than a licence to create a third row on the same
   * address.
   */
  userId?: string;
  /**
   * Whether a Google-only account may be given a temporary email/password
   * fallback on upgrade. Defaults to true. Resident linking passes false: a
   * resident never receives credentials, so minting a password they are never
   * told about would only strand them behind `mustChangePassword`. Ignored for
   * high-privilege roles, whose mailbox-proof rotation is not optional.
   */
  issueTemporaryPassword?: boolean;
};

/**
 * The single entry point for admin-issued accounts. Never creates a duplicate
 * User for an email:
 * - no user            -> create with temp password + mustChangePassword
 * - PUBLIC user        -> upgrade role in place, keep credentials/Google link
 * - same role already  -> no-op (idempotent, e.g. approving a second hostel)
 * - other role         -> 409 EMAIL_ALREADY_HAS_ROLE
 */
export async function registerOrUpgradeUserByEmail(input: RegisterOrUpgradeInput) {
  await connectToDatabase();

  if (!ADMIN_ISSUABLE_ROLES.includes(input.role)) {
    throw new UserServiceError("This role cannot be issued.", "ROLE_NOT_ISSUABLE", 400);
  }

  const requestedEmail = input.email.trim().toLowerCase();

  if (!requestedEmail && !input.userId) {
    throw new UserServiceError("Email is required.", "EMAIL_REQUIRED", 400);
  }

  const roleLabel = ROLE_LABELS[input.role] ?? input.role;
  const notify = input.sendEmailNotification ?? true;
  const existing = await UserModel.findOne(
    input.userId
      ? { _id: input.userId, isDeleted: { $ne: true } }
      : { email: requestedEmail, isDeleted: { $ne: true } },
  ).select("+passwordHash");

  // A pinned account that has since been deleted must not fall through to the
  // create branch below: that would mint a *second* row on an address that
  // already has one, which is the shape of the bug `userId` exists to end.
  if (input.userId && !existing) {
    throw new UserServiceError(
      "That account no longer exists.",
      "USER_NOT_FOUND",
      404,
    );
  }

  // The address the account actually signs in with wins over the one the caller
  // typed — they differ exactly when this matters, and every mail below goes to
  // a real mailbox rather than to a profile field.
  const email = existing?.email?.trim().toLowerCase() || requestedEmail;

  let user = existing;
  let created = false;
  let upgraded = false;
  let temporaryPassword: string | null = null;

  if (!existing) {
    temporaryPassword = generateTemporaryPassword();
    user = await UserModel.create({
      authProvider: "LOCAL",
      email,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
      name: input.name?.trim() || email,
      passwordHash: await hashPassword(temporaryPassword),
      phone: input.phone?.trim() || undefined,
      role: input.role,
      status: "INVITED",
      ...(input.hostelId ? { hostelIds: [input.hostelId] } : {}),
    });
    created = true;
  } else if (existing.role === input.role) {
    if (input.hostelId) {
      await UserModel.updateOne(
        { _id: existing._id },
        { $addToSet: { hostelIds: input.hostelId } },
      );
    }
  } else if (existing.role === Role.PUBLIC) {
    existing.role = input.role;

    if (
      input.hostelId &&
      !existing.hostelIds?.some((id: unknown) => String(id) === input.hostelId)
    ) {
      existing.hostelIds = [...(existing.hostelIds ?? []), input.hostelId as never];
    }

    // ARCHITECTURE.md §3.2 safeguard: a PUBLIC account may only be raised to a
    // high-privilege role (HOSTEL_ADMIN / SUPERADMIN) once the recipient proves
    // control of the mailbox. We enforce that by rotating to a fresh temporary
    // password and forcing a reset on next login, so the elevated role cannot be
    // exercised with a pre-existing password the admin never verified. Google-only
    // accounts also get a temp password so email/password login works as a
    // fallback. Lower-trust roles (RESIDENT / WARDEN / GUARDIAN) keep their
    // existing credentials — the registering admin vetted them out-of-band.
    const requiresMailboxProof = HIGH_PRIVILEGE_ROLES.has(input.role);
    const mayIssueTempPassword = input.issueTemporaryPassword ?? true;

    if (requiresMailboxProof || (!existing.passwordHash && mayIssueTempPassword)) {
      temporaryPassword = generateTemporaryPassword();
      existing.passwordHash = await hashPassword(temporaryPassword);
      existing.mustChangePassword = true;
    }

    await existing.save();
    upgraded = true;
  } else {
    throw new UserServiceError(
      "This email already belongs to an account with a different role.",
      "EMAIL_ALREADY_HAS_ROLE",
      409,
    );
  }

  if (!user) {
    throw new UserServiceError("Could not resolve user account.", "USER_ERROR", 500);
  }

  if ((created || upgraded) && input.performedBy) {
    await AuditLogModel.create({
      action: created ? "USER_ACCOUNT_ISSUED" : "USER_ROLE_UPGRADED",
      actorId: input.performedBy,
      entityId: String(user._id),
      entityType: "User",
      ...(input.hostelId ? { hostelId: input.hostelId } : {}),
      metadata: {
        email,
        role: input.role,
        ...(upgraded ? { previousRole: Role.PUBLIC } : {}),
      },
    });
  }

  if (notify && (created || upgraded)) {
    if (temporaryPassword) {
      await sendEmail({
        to: email,
        ...credentialsIssuedEmail({
          email,
          loginUrl: loginUrl(),
          roleLabel,
          temporaryPassword,
        }),
      });
    } else {
      await sendEmail({
        to: email,
        ...accountUpgradedEmail({
          dashboardUrl:
            `${process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}` +
            (landingPathForRole(input.role) ?? "/"),
          hostelName: input.hostelName,
          roleLabel,
        }),
      });
    }
  }

  return {
    created,
    temporaryPassword,
    upgraded,
    user: {
      email: user.email ?? email,
      id: String(user._id),
      role: String(user.role),
    },
  };
}
