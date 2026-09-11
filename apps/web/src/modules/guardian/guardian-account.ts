import { Types } from "mongoose";

import { Role } from "@/lib/roles";
import { GuardianAccessModel } from "@hostel/db/models/GuardianAccess";
import { UserModel } from "@hostel/db/models/User";

const LIVE_ACCESS = { $in: ["ACTIVE", "USED"] };

/**
 * Gives guardian accounts back what they had before this hostel took them on,
 * once their last live link here is gone — the access was revoked, or the ward
 * behind it was deleted.
 *
 * A guardian still linked to another ward in this hostel keeps everything. One
 * linked only elsewhere loses this hostel from their scope. One linked nowhere
 * becomes a plain PUBLIC account: without that they keep the GUARDIAN role, land
 * on the guardian dashboard, and every call 404s "Guardian access was not found".
 *
 * Only GUARDIAN-role accounts are touched, so a staff member who is also
 * someone's guardian keeps their hostel. Nobody is signed out — as with
 * `demoteToPublicAccount`, the next token refresh re-reads role and scope.
 */
export async function releaseGuardianAccounts(userIds: unknown[], hostelId: Types.ObjectId) {
  // Unclaimed invitations carry no userId; there is no account to release.
  const accounts = userIds.filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);

  for (const userId of accounts) {
    const [linkedHere, linkedAnywhere] = await Promise.all([
      GuardianAccessModel.exists({ hostelId, status: LIVE_ACCESS, userId }),
      GuardianAccessModel.exists({ status: LIVE_ACCESS, userId }),
    ]);

    if (linkedHere) {
      continue;
    }

    await UserModel.updateOne(
      { _id: userId, isDeleted: { $ne: true }, role: Role.GUARDIAN },
      linkedAnywhere
        ? { $pull: { hostelIds: hostelId } }
        : { $pull: { hostelIds: hostelId }, $set: { role: Role.PUBLIC } },
    );
  }
}
