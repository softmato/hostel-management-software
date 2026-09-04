import { Types } from "mongoose";

import { connectToDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { Role } from "@/lib/roles";
import { UserServiceError } from "@/modules/users/user.service";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import { HostelMemberModel } from "@hostel/db/models/HostelMember";
import { HostelModel } from "@hostel/db/models/Hostel";
import { UserModel } from "@hostel/db/models/User";

/**
 * Moving into a hostel is not something an account can be too busy for.
 *
 * ## Why this is not `registerOrUpgradeUserByEmail`
 *
 * That function refuses to change the role of anything that is not already
 * PUBLIC, and it is right to: raising somebody to HOSTEL_ADMIN because their
 * address was typed into a form is how an account gets taken over. But it was
 * also standing in the way of the opposite act. Somebody who once accepted — or
 * far more often, never accepted — a warden invitation, and who later actually
 * moves into a hostel, is a resident. They arrived at the desk with their
 * luggage. The product registered them, invoiced them, emailed them a welcome,
 * and then left them signed in as a public user with no portal, because a stale
 * `INVITED` row on their mailbox outranked the bed they were standing next to.
 *
 * So residency has no blocker. Whatever the account was, it becomes a resident
 * login, and the things that competed with that are cleared rather than allowed
 * to win.
 *
 * ## What "cleared" means, and why the person is told
 *
 * Clearing a role silently would be its own defect — somebody would go looking
 * for a warden dashboard that had quietly stopped existing. Everything removed
 * is collected in {@link ResidentPromotionClearance} and handed back to the
 * caller, which is what puts it in an email and in the audit log. The account
 * keeps its password, its Google link and its history; only the role and the
 * memberships that contradicted residency are touched.
 *
 * ## The one thing that is still refused
 *
 * A HOSTEL_ADMIN or SUPERADMIN is not demoted by an intake form. Those roles
 * hold power over other people's data, and a hostel admin who could register the
 * platform owner's address as a resident could strip that owner's access from a
 * screen meant for admitting students. Those accounts fall through to QR
 * activation and the resident gets a separate login — the correct outcome, and a
 * rare one. Every other role gives way.
 */

/** Roles an intake will not overwrite. See the doc comment above. */
const PROTECTED_ROLES = new Set<string>([Role.HOSTEL_ADMIN, Role.SUPERADMIN]);

export type ResidentPromotionClearance = {
  /** True when an account that never accepted its invitation was activated. */
  activatedInvite: boolean;
  /** Memberships stood down, named the way the person would recognise them. */
  clearedMemberships: { hostelName: string; role: string }[];
  /** The role they held before, when it was not already PUBLIC or RESIDENT. */
  clearedRole: string | null;
};

export type ResidentPromotion = {
  cleared: ResidentPromotionClearance;
  upgraded: boolean;
  user: { email: string; id: string; role: string };
};

/** True when anything was actually taken away, so a mail is worth sending. */
export function hasClearance(cleared: ResidentPromotionClearance) {
  return (
    cleared.clearedRole !== null ||
    cleared.clearedMemberships.length > 0 ||
    cleared.activatedInvite
  );
}

type PromotableUser = {
  _id: Types.ObjectId;
  email?: string;
  hostelIds?: Types.ObjectId[];
  name?: string;
  phone?: string;
  role?: string;
  status?: string;
};

/**
 * Promotes one specific account to RESIDENT, clearing whatever stood in the way.
 *
 * Addressed by id, never by email. An address is not an identity — two rows can
 * and do share one — and the caller has already resolved which account this is.
 */
export async function promoteAccountToResident(input: {
  hostelId: Types.ObjectId | string;
  name?: string;
  performedBy?: string;
  phone?: string;
  userId: Types.ObjectId | string;
}): Promise<ResidentPromotion> {
  await connectToDatabase();

  const user = await UserModel.findOne({
    _id: input.userId,
    isDeleted: { $ne: true },
  }).lean<PromotableUser | null>();

  if (!user) {
    throw new UserServiceError("That account no longer exists.", "USER_NOT_FOUND", 404);
  }

  const previousRole = user.role ?? Role.PUBLIC;

  if (PROTECTED_ROLES.has(previousRole)) {
    throw new UserServiceError(
      "This email belongs to an administrator account, which an intake may not change.",
      "ROLE_TOO_PRIVILEGED",
      409,
    );
  }

  const hostelId = new Types.ObjectId(input.hostelId.toString());
  const alreadyHere = (user.hostelIds ?? []).some(
    (id) => id.toString() === hostelId.toString(),
  );

  /*
   * An `INVITED` account is one somebody was sent credentials for and never
   * used. Leaving it INVITED keeps them out of the portal they were just given,
   * which is the same bug wearing a different field.
   */
  const activatedInvite = user.status === "INVITED";
  const clearedRole =
    previousRole === Role.PUBLIC || previousRole === Role.RESIDENT ? null : previousRole;

  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        role: Role.RESIDENT,
        ...(activatedInvite
          ? {
              // A resident is never sent credentials, so a `mustChangePassword`
              // left over from an invitation they never opened would strand them
              // behind a password nobody ever told them.
              mustChangePassword: false,
              status: "ACTIVE",
            }
          : {}),
        ...(input.name?.trim() && !user.name ? { name: input.name.trim() } : {}),
        ...(input.phone?.trim() && !user.phone ? { phone: input.phone.trim() } : {}),
      },
      ...(alreadyHere ? {} : { $addToSet: { hostelIds: hostelId } }),
    },
  );

  const clearedMemberships = await standDownMemberships(user._id);

  const cleared: ResidentPromotionClearance = {
    activatedInvite,
    clearedMemberships,
    clearedRole,
  };

  if (input.performedBy) {
    await AuditLogModel.create({
      action: "USER_ROLE_UPGRADED",
      actorId: input.performedBy,
      entityId: String(user._id),
      entityType: "User",
      hostelId: hostelId.toString(),
      metadata: {
        clearedMemberships: clearedMemberships.length,
        clearedRole,
        email: user.email,
        previousRole,
        reactivatedInvite: activatedInvite,
        role: Role.RESIDENT,
      },
    });
  }

  return {
    cleared,
    upgraded: previousRole !== Role.RESIDENT,
    user: {
      email: user.email ?? "",
      id: String(user._id),
      role: Role.RESIDENT,
    },
  };
}

/**
 * Stands down every staff membership the account held.
 *
 * `REMOVED` and `isDeleted`, matching what `warden.service` writes when somebody
 * is taken off a hostel by hand — so a warden list, a roll-call fan-out and a
 * permission check all stop counting them without any of them learning a new
 * state. A membership already removed is left alone, so the list handed to the
 * email describes what *this* promotion took away and nothing else.
 *
 * Never fatal. The role is already changed by the time this runs, and a
 * membership that could not be written is worth a log line rather than an intake
 * that reports failure over a resident who is registered.
 */
async function standDownMemberships(userId: Types.ObjectId) {
  try {
    const memberships = await HostelMemberModel.find({
      isDeleted: { $ne: true },
      status: { $ne: "REMOVED" },
      userId,
    }).lean<{ _id: Types.ObjectId; hostelId: Types.ObjectId; role?: string }[]>();

    const staff = memberships.filter((member) => member.role !== Role.RESIDENT);

    if (staff.length === 0) {
      return [];
    }

    await HostelMemberModel.updateMany(
      { _id: { $in: staff.map((member) => member._id) } },
      { $set: { isDeleted: true, status: "REMOVED" } },
    );

    const hostels = await HostelModel.find({
      _id: { $in: staff.map((member) => member.hostelId) },
    })
      .select("_id name")
      .lean<{ _id: Types.ObjectId; name?: string }[]>();

    const nameById = new Map(
      hostels.map((hostel) => [hostel._id.toString(), hostel.name ?? "a hostel"]),
    );

    return staff.map((member) => ({
      hostelName: nameById.get(member.hostelId.toString()) ?? "a hostel",
      role: member.role ?? Role.WARDEN,
    }));
  } catch (error) {
    logger.error("Could not stand down memberships during resident promotion.", {
      error: error instanceof Error ? error.message : String(error),
      userId: userId.toString(),
    });

    return [];
  }
}
