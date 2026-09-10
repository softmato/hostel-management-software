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
  /** Only ever set by the availability check, which deliberately reads it. */
  isDeleted?: boolean;
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
    | "ALREADY_HAS_THIS_ROLE"
    | "OTHER_PLATFORM_ROLE"
    | "OTHER_ROLE"
    | "SUSPENDED_ACCOUNT"
    | "CLOSED_ACCOUNT"
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
 * ## An address in use elsewhere no longer blocks the invitation
 *
 * This check used to refuse any address that already carried a role — a
 * resident, a warden, a cook, the public account behind a service provider —
 * on the reasoning that a platform grant would silently strip that account of
 * its tenant scope. The reasoning was sound and the remedy was wrong. The
 * people a platform hires as field agents are very often already *in* the
 * system: the warden who knows every hostel on the street is exactly who you
 * want registering them, and telling a superadmin to use a different address
 * means telling a real person to open a second mailbox to do their second job.
 *
 * So the takeover is allowed, and made reversible instead of forbidden. The
 * displaced role is written to `User.previousRole` on accept and handed back by
 * "remove from team", which is what turns a one-way door into a decision
 * somebody can undo. What survives here is only the reporting: the sentence
 * says *which* account is about to change hands, so nobody types an address and
 * discovers afterwards that they moved a warden off their hostel.
 *
 * Three things still refuse, and none of them is about the address being busy:
 *
 * - the account already holds the exact role being offered, so there is
 *   nothing for an acceptance to do;
 * - it already holds one of the *other* platform grades, which is a privilege
 *   change and belongs on the admin roster where the last-superadmin guard
 *   lives, not in an invite box;
 * - the account has been closed (soft-deleted). Its address is still held by
 *   the unique index, so a fresh account cannot be minted on it and the grant
 *   would otherwise fail at accept time as a duplicate-key error.
 *
 * A suspended account does *not* refuse. Suspension is frequently how somebody
 * left the team in the first place, and a superadmin deliberately typing that
 * address is the decision to let them back in — so it is reported, and
 * accepting reactivates.
 */
export async function checkPlatformAdminEmail(
  rawEmail: string,
  /**
   * The grade the caller is about to offer. Optional because the type-ahead
   * endpoint answers before a role has been chosen; with it absent, any
   * platform grade already on the address reads as "already has access".
   */
  role?: PlatformAdminInviteRole,
): Promise<EmailAvailabilityResult> {
  await connectToDatabase();

  const email = normalizeEmail(rawEmail);

  const [user, pendingInvite, pendingCook, pendingGuardian] = await Promise.all([
    /*
     * Soft-deleted accounts are looked up too, unlike everywhere else in this
     * file. They are invisible to the product but still own their address as
     * far as the unique index is concerned, so leaving them out would turn a
     * closed account into an unexplained 500 at accept time.
     */
    UserModel.findOne({ email })
      .select("email isDeleted name role status")
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

  if (user?.isDeleted) {
    return {
      availability: "TAKEN",
      message: `${email} belongs to a closed account. The address stays reserved until that account is purged, so it cannot be invited yet.`,
      reason: "CLOSED_ACCOUNT",
      sendable: false,
    };
  }

  if (user && role && user.role === role) {
    return {
      availability: "TAKEN",
      message: `${email} is already ${ROLE_DESCRIPTIONS[user.role ?? ""] ?? "on the team"}. There is nothing left for an invitation to grant.`,
      reason: "ALREADY_HAS_THIS_ROLE",
      sendable: false,
    };
  }

  if (user && INVITABLE_ROLES.includes(user.role as PlatformAdminInviteRole)) {
    return {
      availability: "TAKEN",
      message: `${email} is already ${ROLE_DESCRIPTIONS[user.role ?? ""] ?? "a platform admin"}. Change their access level on the admin roster instead.`,
      reason: role ? "OTHER_PLATFORM_ROLE" : "ALREADY_HAS_THIS_ROLE",
      sendable: false,
    };
  }

  /*
   * Every remaining branch is sendable. They differ only in what the superadmin
   * is told they are about to do, and they run most-consequential first: taking
   * an account off the role it is living on is a bigger fact about this address
   * than a cook invitation nobody has opened.
   */

  const dormant = user?.status === "SUSPENDED" || user?.status === "ARCHIVED";

  if (user && user.role !== Role.PUBLIC) {
    return {
      availability: "UPGRADEABLE",
      message: `${email} currently belongs to ${ROLE_DESCRIPTIONS[user.role ?? ""] ?? "another account"}. Accepting moves that same account onto the field team${dormant ? " and reactivates it" : ""} — their present access ends, and comes back if you remove them from the team later.`,
      reason: "OTHER_ROLE",
      sendable: true,
    };
  }

  if (pendingInvite) {
    const expired = pendingInvite.expiresAt.getTime() < Date.now();

    return {
      availability: "UPGRADEABLE",
      message: expired
        ? `${email} has an invitation that has run out. Sending again replaces it with a fresh link.`
        : `${email} already has a ${roleLabel(pendingInvite.role)} invitation waiting. Sending again withdraws that one and replaces it.`,
      reason: "INVITE_PENDING",
      sendable: true,
    };
  }

  if (pendingCook) {
    return {
      availability: "UPGRADEABLE",
      message: `${email} also has an unaccepted cook invitation from a hostel. Whichever link is opened second will be refused, so tell them which one to use.`,
      reason: "COOK_INVITE_PENDING",
      sendable: true,
    };
  }

  if (pendingGuardian) {
    return {
      availability: "UPGRADEABLE",
      message: `${email} also has an unaccepted guardian invitation from a resident. Whichever link is opened second will be refused, so tell them which one to use.`,
      reason: "GUARDIAN_INVITE_PENDING",
      sendable: true,
    };
  }

  if (dormant) {
    return {
      availability: "UPGRADEABLE",
      message: `${email} has a suspended account. Accepting the invitation reactivates it and puts them on the field team.`,
      reason: "SUSPENDED_ACCOUNT",
      sendable: true,
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
 *
 * Sending to an address that already has an invitation waiting **replaces** it
 * rather than refusing. A superadmin who types the same address twice is asking
 * for the person to get a link they can use, and the old one is usually the
 * reason they are asking — it went to spam, or it expired. The previous token
 * is dropped, so exactly one live link exists per address at any moment, which
 * is also what the partial unique index on `email` insists on.
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

  const availability = await checkPlatformAdminEmail(email, input.role);

  if (!availability.sendable) {
    throw new PlatformAdminInviteError(availability.message, availability.reason, 409);
  }

  /*
   * Superseded rather than left to collide. The index would reject the insert
   * below with a duplicate-key error, which reaches the superadmin as a 500 on
   * the one address they most wanted to retry.
   */
  await PlatformAdminInviteModel.updateMany(
    { email, status: "PENDING" },
    {
      $set: { revokedAt: new Date(), revokedBy: principal.userId, status: "REVOKED" },
      $unset: { tokenHash: "" },
    },
  );

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

  /*
   * A pasted list repeats addresses more often than anyone expects. Sending
   * twice is not harmless now that a second send supersedes the first: the
   * recipient would get two mails and only the later link would work, so the
   * duplicate is dropped here and the first spelling of the row wins.
   */
  const seen = new Set<string>();

  for (const invitation of input.invitations) {
    const key = normalizeEmail(invitation.email);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

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
 * - **An account exists, on any non-platform role.** That same account is moved
 *   onto the granted role and its old one is parked in `previousRole`. A
 *   resident, a warden, a cook and the public account behind a service provider
 *   are all accepted here.
 *
 * The second branch used to refuse anything but PUBLIC, on the grounds that a
 * platform role must never quietly strip a tenant scope. It still must not —
 * what changed is that stripping is no longer the only way to do this. The
 * displaced role is written down and handed back by `removeTeamMember`, and
 * nothing keyed on the account is deleted on the way, so the scope is parked
 * rather than lost. See `checkPlatformAdminEmail` for why refusing outright was
 * the wrong remedy.
 *
 * An address that already holds one of the platform grades is still refused —
 * that is a privilege change, and it belongs on the admin roster where the
 * last-superadmin guard lives.
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

  let userId: string;
  let accountCreated = false;
  let displacedRole: string | null = null;

  if (existing) {
    /*
     * The role is taken over, whatever it was. A resident, a warden, a cook or
     * the public account behind a service provider all arrive here, and all of
     * them are moved onto the platform grade the invitation offers.
     *
     * `role` holds one value, so the old one is written to `previousRole` on
     * the way past. That single field is the whole reason this is allowed to be
     * a takeover rather than a refusal: "remove from team" reads it back and
     * puts the account where it was, so a warden who spends a season on the
     * field team returns to their hostel rather than to PUBLIC.
     *
     * `hostelIds` and every tenant row keyed on this account are left exactly
     * as they are. They are inert while a platform role is on the account —
     * nothing reads them for a PLATFORM_AGENT — and they are what makes the
     * restore mean something rather than being a role with nothing behind it.
     */
    if (existing.role !== invite.role) {
      displacedRole = existing.role;
      existing.previousRole = existing.role;
    }

    existing.role = invite.role;

    /*
     * Reactivated, and only from the two dormant states. A superadmin typing
     * this exact address is a deliberate grant of access, and suspension is
     * frequently how the person left the team in the first place — refusing to
     * lift it would make "invite them back" quietly do nothing. INVITED is left
     * alone because the first sign-in is what clears it, and ACTIVE needs no help.
     */
    if (existing.status === "SUSPENDED" || existing.status === "ARCHIVED") {
      existing.status = "ACTIVE";
    }

    if (invite.phone && !existing.phone) {
      existing.phone = invite.phone;
    }

    /*
     * A session the account is already holding carries the *old* role in a
     * signed token, and the symptom of leaving it alone is nasty: the team desk
     * renders and every call inside it 403s. Bumping the version makes the
     * refresh fail, which sends them to sign in again and mints a token that
     * says what they now are. (The token in hand still works until it expires;
     * the role heal in `browser-api` spends that window trying to refresh.)
     */
    existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;

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
      /*
       * The role this acceptance took the account off, or null. The one fact
       * that makes a takeover auditable rather than a role appearing out of
       * nowhere — and the one to read if a restore ever has to be done by hand.
       */
      displacedRole,
      email: invite.email,
      invitedBy: invite.invitedBy?.toString(),
      role: invite.role,
    },
  });

  return {
    accepted: true,
    accountCreated,
    displacedRole,
    email: invite.email,
    role: invite.role,
    roleLabel: roleLabel(invite.role),
  };
}
