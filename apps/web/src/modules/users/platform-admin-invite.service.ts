import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { Role } from "@/lib/roles";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { CookAccountModel } from "@hostel/db/models/CookAccount";
import { GuardianAccessModel } from "@hostel/db/models/GuardianAccess";
import { PlatformAdminInviteModel } from "@hostel/db/models/PlatformAdminInvite";
import { UserModel } from "@hostel/db/models/User";
import { platformAdminInvitationEmail } from "@hostel/shared/email/templates/platform/admin-invitation";
import { sendEmail } from "@hostel/shared/email/sender";

/**
 * Invitation-based platform admin access.
 *
 * The sibling of `platform-admin.service.ts`, which mints the account up front
 * with a temporary password. This path does the opposite: nothing exists until
 * the recipient opens the emailed link, and opening it is the proof of mailbox
 * control that lets a platform role be granted at all. See
 * `PlatformAdminInvite` for why the token is stored hashed.
 */

export const INVITATION_EXPIRY_DAYS = 7;

export class PlatformAdminInviteError extends Error {
  constructor(
    message: string,
    public errorCode = "PLATFORM_ADMIN_INVITE_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Every role an invitation can grant — the two platform grades plus the field
 * agent. `PLATFORM_ADMIN_ROLES` stays narrower and keeps guarding the roster,
 * so an agent never counts as a platform admin anywhere that matters.
 */
export const INVITABLE_ROLES = [
  Role.SUPERADMIN,
  Role.PLATFORM_MODERATOR,
  Role.PLATFORM_AGENT,
] as const;

export type PlatformAdminInviteRole = (typeof INVITABLE_ROLES)[number];

const ROLE_LABELS: Record<string, string> = {
  [Role.PLATFORM_AGENT]: "Team Member",
  [Role.PLATFORM_MODERATOR]: "Platform Moderator",
  [Role.SUPERADMIN]: "Superadmin",
};

/** How an existing account's role reads back to the person doing the inviting. */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  [Role.COOK]: "a cook account",
  [Role.GUARDIAN]: "a guardian account",
  [Role.HOSTEL_ADMIN]: "a hostel admin account",
  [Role.PLATFORM_MODERATOR]: "a platform moderator",
  [Role.PLATFORM_AGENT]: "a team member account",
  [Role.RESIDENT]: "a resident account",
  [Role.SUPERADMIN]: "a superadmin",
  [Role.WARDEN]: "a warden account",
};

type InviteRecord = {
  _id: Types.ObjectId;
  acceptedAt?: Date;
  createdAt?: Date;
  email: string;
  expiresAt: Date;
  invitedBy?: Types.ObjectId;
  name?: string;
  phone?: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  tokenHash?: string;
};

type UserLookup = {
  _id: Types.ObjectId;
  email?: string;
  name?: string;
  role?: string;
  status?: string;
};

function issueToken() {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function daysFromNow(days: number) {
  const date = new Date();

  date.setDate(date.getDate() + days);

  return date;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

function appUrl(path: string) {
  const base =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function serializeInvite(invite: InviteRecord) {
  return {
    createdAt: invite.createdAt?.toISOString() ?? null,
    email: invite.email,
    expired: invite.status === "PENDING" && invite.expiresAt.getTime() < Date.now(),
    expiresAt: invite.expiresAt.toISOString(),
    id: invite._id.toString(),
    name: invite.name ?? "",
    phone: invite.phone ?? "",
    role: invite.role,
    status: invite.status,
  };
}

/* ── Availability ──────────────────────────────────────────────────────── */

export type EmailAvailability = "AVAILABLE" | "UPGRADEABLE" | "TAKEN";

export type EmailAvailabilityResult = {
  availability: EmailAvailability;
  /** Machine-readable reason, so a caller can branch without parsing prose. */
  reason:
    | "FREE"
    | "PUBLIC_ACCOUNT"
    | "ALREADY_PLATFORM_ADMIN"
    | "OTHER_ROLE"
    | "INVITE_PENDING"
    | "COOK_INVITE_PENDING"
    | "GUARDIAN_INVITE_PENDING";
  /** Plain sentence, shown verbatim under the field as they type. */
  message: string;
  /** True when an invitation may be sent to this address right now. */
  sendable: boolean;
};

/**
 * What this address is already being used for, phrased so a superadmin can act
 * on it without opening another screen.
 *
 * Four places can hold a claim on an address, and all four are checked:
 *
 * - an existing `User`, whatever its role — the identity store every portal
 *   shares, so a resident, a warden and a cook all surface here;
 * - a platform admin invitation that is still outstanding;
 * - a cook invitation that has been sent but not accepted;
 * - a guardian invitation in the same state.
 *
 * The last two have no `User` behind them yet, which is exactly why they need
 * checking separately: the address is spoken for, and whichever invitation is
 * accepted second would fail at accept time with nothing on screen to explain
 * why. Better to say so now.
 *
 * A `PUBLIC` account is the one "already in use" that does not block. It is
 * somebody who signed up to browse hostels, and raising exactly that account is
 * what `createPlatformAdmin` has always done — refusing it would mean a
 * colleague who once looked at a listing could never be given access. It is
 * reported as `UPGRADEABLE` so the sentence on screen says which account is
 * about to change hands, rather than pretending the address was free.
 */
export async function checkPlatformAdminEmail(
  rawEmail: string,
): Promise<EmailAvailabilityResult> {
  await connectToDatabase();

  const email = normalizeEmail(rawEmail);

  const [user, pendingInvite, pendingCook, pendingGuardian] = await Promise.all([
    UserModel.findOne({ email, isDeleted: { $ne: true } })
      .select("email name role status")
      .lean<UserLookup | null>(),
    PlatformAdminInviteModel.findOne({ email, status: "PENDING" })
      .select("expiresAt role")
      .lean<{ expiresAt: Date; role: string } | null>(),
    CookAccountModel.findOne({ loginEmail: email, status: "INVITED" })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>(),
    GuardianAccessModel.findOne({
      email,
      invitationToken: { $exists: true },
      status: "ACTIVE",
      userId: { $exists: false },
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId } | null>(),
  ]);

  if (user && INVITABLE_ROLES.includes(user.role as PlatformAdminInviteRole)) {
    return {
      availability: "TAKEN",
      message: `${email} is already ${ROLE_DESCRIPTIONS[user.role ?? ""] ?? "a platform admin"}. Change their access level on the roster below instead.`,
      reason: "ALREADY_PLATFORM_ADMIN",
      sendable: false,
    };
  }

  if (user && user.role !== Role.PUBLIC) {
    return {
      availability: "TAKEN",
      message: `${email} already belongs to ${ROLE_DESCRIPTIONS[user.role ?? ""] ?? "another account"}. Platform access needs its own address.`,
      reason: "OTHER_ROLE",
      sendable: false,
    };
  }

  if (pendingInvite) {
    const expired = pendingInvite.expiresAt.getTime() < Date.now();

    return {
      availability: "TAKEN",
      message: expired
        ? `${email} has an invitation that has run out. Withdraw it below, then send a fresh one.`
        : `${email} already has a ${roleLabel(pendingInvite.role)} invitation waiting to be accepted. Withdraw it below to send a different one.`,
      reason: "INVITE_PENDING",
      sendable: false,
    };
  }

  if (pendingCook) {
    return {
      availability: "TAKEN",
      message: `${email} has an unaccepted cook invitation from a hostel. Whichever invitation is accepted second would be refused, so use a different address.`,
      reason: "COOK_INVITE_PENDING",
      sendable: false,
    };
  }

  if (pendingGuardian) {
    return {
      availability: "TAKEN",
      message: `${email} has an unaccepted guardian invitation from a resident. Whichever invitation is accepted second would be refused, so use a different address.`,
      reason: "GUARDIAN_INVITE_PENDING",
      sendable: false,
    };
  }

  if (user) {
    return {
      availability: "UPGRADEABLE",
      message: `${email} has a public account (${user.name ?? "unnamed"}). Accepting raises that same account — they keep their password and sign in as they do now.`,
      reason: "PUBLIC_ACCOUNT",
      sendable: true,
    };
  }

  return {
    availability: "AVAILABLE",
    message: `${email} is not used anywhere on the platform. They accept the emailed link, then sign in with Google.`,
    reason: "FREE",
    sendable: true,
  };
}

/* ── Sending ───────────────────────────────────────────────────────────── */

export type InvitePlatformAdminInput = {
  email: string;
  name?: string;
  phone?: string;
  role: PlatformAdminInviteRole;
};

/**
 * Mails an invitation. The availability check above runs again here rather than
 * being trusted from the client: the field on screen was checked while somebody
 * was typing, and the address could have been claimed in between.
 */
export async function invitePlatformAdmin(
  input: InvitePlatformAdminInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const email = normalizeEmail(input.email);

  if (!email) {
    throw new PlatformAdminInviteError("Email is required.", "EMAIL_REQUIRED", 422);
  }

  const availability = await checkPlatformAdminEmail(email);

  if (!availability.sendable) {
    throw new PlatformAdminInviteError(availability.message, availability.reason, 409);
  }

  const token = issueToken();
  const invite = (await PlatformAdminInviteModel.create({
    email,
    expiresAt: daysFromNow(INVITATION_EXPIRY_DAYS),
    invitedBy: principal.userId,
    name: input.name?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    role: input.role,
    status: "PENDING",
    tokenHash: hashToken(token),
  })) as InviteRecord;

  await AuditLogModel.create({
    action: "PLATFORM_ADMIN_INVITED",
    actorId: principal.userId,
    entityId: invite._id.toString(),
    entityType: "PlatformAdminInvite",
    metadata: { email, role: input.role },
  });

  const inviter = await UserModel.findById(principal.userId)
    .select("name")
    .lean<{ name?: string } | null>();
  const message = platformAdminInvitationEmail({
    acceptUrl: appUrl(`/platform-admin-invite?token=${token}`),
    expiresInDays: INVITATION_EXPIRY_DAYS,
    invitedByName: inviter?.name ?? "A platform superadmin",
    roleLabel: roleLabel(input.role),
  });
  const delivery = await sendEmail({
    category: message.category,
    html: message.html,
    subject: message.subject,
    to: email,
  });

  if (!delivery.sent) {
    console.warn(
      JSON.stringify({
        action: "platform_admin_invitation_email_failed",
        email,
        level: "warn",
        reason: delivery.reason,
      }),
    );
  }

  return {
    /*
     * Reported honestly rather than swallowed. An invitation is only useful if
     * the mail arrived — there is no password to read off the screen and hand
     * over — so a superadmin told "sent" while Resend is unconfigured would sit
     * waiting for an acceptance that cannot come.
     */
    delivered: delivery.sent,
    deliveryReason: delivery.sent ? null : (delivery.reason ?? "unknown"),
    invite: serializeInvite(invite),
  };
}

/**
 * Sends several invitations in one go, reporting each one separately.
 *
 * **Deliberately not atomic.** A batch of ten addresses where the fourth is
 * already a resident should send the other nine, not refuse the lot — the
 * superadmin pasted in a list of people who have actually been hired, and
 * making them find and remove the one bad row before anybody gets an email
 * helps nobody. So every address is attempted and the result says, per address,
 * what happened to it.
 *
 * Sequential rather than `Promise.all`, because each send runs its own
 * availability check and two invitations to the same address in one batch must
 * not both pass it.
 */
export async function invitePlatformAdmins(
  input: {
    invitations: { email: string; name?: string; phone?: string }[];
    role: PlatformAdminInviteRole;
  },
  principal: ApiPrincipal,
) {
  const results: {
    delivered: boolean;
    email: string;
    error: string | null;
    sent: boolean;
  }[] = [];

  for (const invitation of input.invitations) {
    try {
      const result = await invitePlatformAdmin(
        { ...invitation, role: input.role },
        principal,
      );

      results.push({
        delivered: result.delivered,
        email: invitation.email,
        error: null,
        sent: true,
      });
    } catch (error) {
      results.push({
        delivered: false,
        email: invitation.email,
        error:
          error instanceof PlatformAdminInviteError
            ? error.message
            : "Could not send this invitation.",
        sent: false,
      });
    }
  }

  return {
    results,
    sent: results.filter((result) => result.sent).length,
    total: results.length,
  };
}

/** Every invitation that has not yet been accepted, newest first. */
export async function listPlatformAdminInvites() {
  await connectToDatabase();

  const invites = await PlatformAdminInviteModel.find({ status: "PENDING" })
    .sort({ createdAt: -1 })
    .lean<InviteRecord[]>();

  return { invites: invites.map(serializeInvite) };
}

/**
 * Withdraws an invitation. The token stops working immediately — the hash is
 * dropped rather than just marked, so a link already sitting in somebody's
 * inbox has nothing left to match against.
 */
export async function revokePlatformAdminInvite(
  inviteId: string,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  if (!Types.ObjectId.isValid(inviteId)) {
    throw new PlatformAdminInviteError(
      "Invalid invitation id.",
      "INVALID_OBJECT_ID",
      422,
    );
  }

  const invite = await PlatformAdminInviteModel.findOne({
    _id: inviteId,
    status: "PENDING",
  }).lean<InviteRecord | null>();

  if (!invite) {
    throw new PlatformAdminInviteError(
      "That invitation is no longer outstanding.",
      "INVITE_NOT_FOUND",
      404,
    );
  }

  await PlatformAdminInviteModel.updateOne(
    { _id: invite._id },
    {
      $set: { revokedAt: new Date(), revokedBy: principal.userId, status: "REVOKED" },
      $unset: { tokenHash: "" },
    },
  );

  await AuditLogModel.create({
    action: "PLATFORM_ADMIN_INVITE_REVOKED",
    actorId: principal.userId,
    entityId: invite._id.toString(),
    entityType: "PlatformAdminInvite",
    metadata: { email: invite.email, role: invite.role },
  });

  return { revoked: true };
}

/* ── Accepting ─────────────────────────────────────────────────────────── */

async function findLiveInvite(token: string) {
  const invite = await PlatformAdminInviteModel.findOne({
    status: "PENDING",
    tokenHash: hashToken(token),
  })
    .select("+tokenHash")
    .lean<InviteRecord | null>();

  if (!invite) {
    throw new PlatformAdminInviteError(
      "This invitation is not valid. It may have been withdrawn or already used.",
      "INVITE_INVALID",
      404,
    );
  }

  if (invite.expiresAt.getTime() < Date.now()) {
    await PlatformAdminInviteModel.updateOne(
      { _id: invite._id },
      { $set: { status: "EXPIRED" }, $unset: { tokenHash: "" } },
    );

    throw new PlatformAdminInviteError(
      "This invitation has expired. Ask the platform team to send a new one.",
      "INVITE_EXPIRED",
      410,
    );
  }

  return invite;
}

/**
 * What the accept page shows before anything is committed: who the invitation
 * is for and what it grants.
 *
 * The token is never echoed back, and nothing is returned beyond what the email
 * already said — this endpoint is reachable by whoever holds the link, which is
 * the point, so it tells the holder only what they need to decide.
 */
export async function readPlatformAdminInvitation(token: string) {
  await connectToDatabase();

  const invite = await findLiveInvite(token);

  return {
    invitation: {
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      role: invite.role,
      roleLabel: roleLabel(invite.role),
    },
  };
}

export type AcceptPlatformAdminInvitationInput = {
  /** Required when the invitation grants `PLATFORM_AGENT`; ignored otherwise. */
  password?: string;
  token: string;
};

/**
 * Grants the role. Accepting asks for nothing — no name, no password. The link
 * arrived in the recipient's mailbox and they opened it; there is no further
 * question worth putting between that and the grant.
 *
 * **No credential is minted here, on either branch.** Google sign-in matches an
 * existing account by email, keeps whatever role it holds, links the Google
 * identity and flips `INVITED` to `ACTIVE` on the way through — so the row this
 * writes is the whole handover, and "sign in with Google" finishes it. That is
 * also why a password would be pure ceremony: it would be a second credential
 * for an account whose owner has already proved the only thing a password is
 * there to prove. (Anyone who later wants one gets it from password reset, on
 * the same verified mailbox.)
 *
 * Two branches:
 *
 * - **No account on the address.** One is created `INVITED`, verified, with no
 *   password hash at all. First Google sign-in activates it.
 * - **A PUBLIC account exists.** Only the role changes. Status and credentials
 *   are left exactly as they are — a suspended account must not come back to
 *   life holding a platform role, and an account somebody already signs into
 *   should not have its sign-in altered by a grant.
 *
 * Any other role on the address is refused. The availability check makes that
 * unreachable from the UI, but an invitation sent yesterday can land on an
 * address that became a resident this morning, and a platform role must never
 * be the thing that quietly strips a tenant scope.
 */
export async function acceptPlatformAdminInvitation(
  input: AcceptPlatformAdminInvitationInput,
) {
  await connectToDatabase();

  const invite = await findLiveInvite(input.token);
  const existing = await UserModel.findOne({
    email: invite.email,
    isDeleted: { $ne: true },
  });

  if (existing && INVITABLE_ROLES.includes(existing.role as PlatformAdminInviteRole)) {
    // Settle the invitation rather than leaving a live token behind for an
    // address that already has the access it was offering.
    await PlatformAdminInviteModel.updateOne(
      { _id: invite._id },
      {
        $set: {
          acceptedAt: new Date(),
          acceptedUserId: existing._id,
          status: "ACCEPTED",
        },
        $unset: { tokenHash: "" },
      },
    );

    throw new PlatformAdminInviteError(
      "This address already has platform access. Sign in with it instead.",
      "ALREADY_PLATFORM_ADMIN",
      409,
    );
  }

  if (existing && existing.role !== Role.PUBLIC) {
    throw new PlatformAdminInviteError(
      "This address now belongs to another kind of account, so the invitation cannot be accepted. Ask the platform team to invite a different address.",
      "EMAIL_ALREADY_HAS_ROLE",
      409,
    );
  }

  let userId: string;
  let accountCreated = false;

  if (existing) {
    // Role only. See the note above on why status and credentials are untouched.
    existing.role = invite.role;

    if (invite.phone && !existing.phone) {
      existing.phone = invite.phone;
    }

    await existing.save();
    userId = String(existing._id);
  } else {
    const created = await UserModel.create({
      /*
       * GOOGLE rather than LOCAL, because that is the way in this account
       * actually has: it is created with no password hash, so there is nothing
       * for a LOCAL sign-in to check.
       */
      authProvider: "GOOGLE",
      email: invite.email,
      /*
       * Verified because the invitation reached this mailbox and somebody
       * opened it — the same fact a verification mail establishes, so sending
       * one would ask them to prove it twice.
       */
      emailVerified: true,
      emailVerifiedAt: new Date(),
      /*
       * The name the inviter typed, falling back to the address. Google does
       * not overwrite the name on an account it merely links to, so whatever
       * lands here is what the roster shows — which is why the invite form
       * keeps asking the inviter for it.
       */
      name: invite.name?.trim() || invite.email,
      ...(invite.phone ? { phone: invite.phone } : {}),
      role: invite.role,
      /** First Google sign-in flips this to ACTIVE. */
      status: "INVITED",
    });

    accountCreated = true;
    userId = String(created._id);
  }

  await PlatformAdminInviteModel.updateOne(
    { _id: invite._id },
    {
      $set: { acceptedAt: new Date(), acceptedUserId: userId, status: "ACCEPTED" },
      $unset: { tokenHash: "" },
    },
  );

  await AuditLogModel.create({
    action: "PLATFORM_ADMIN_INVITE_ACCEPTED",
    actorId: userId,
    entityId: invite._id.toString(),
    entityType: "PlatformAdminInvite",
    metadata: {
      accountCreated,
      email: invite.email,
      invitedBy: invite.invitedBy?.toString(),
      role: invite.role,
    },
  });

  return {
    accepted: true,
    accountCreated,
    email: invite.email,
    role: invite.role,
    roleLabel: roleLabel(invite.role),
  };
}
