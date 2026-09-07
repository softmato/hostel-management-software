import type { Types } from "mongoose";

import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getHostelName } from "@/modules/residents/resident-notify";

/**
 * A warden being told what happened to their own account.
 *
 * Three events, all of them decided by somebody else about them, and none of
 * which reached them before this file existed:
 *
 *   - **added** — the account-creation email covers a brand-new account, but a
 *     PUBLIC account *upgraded* to warden keeps its password and gets no email
 *     at all. That person was made staff of a hostel and told nothing;
 *   - **permissions changed** — the whole point of `WardenPermission` is that a
 *     warden can do some things and not others. Taking one away silently means
 *     the next attempt fails with a permission error and reads as a bug;
 *   - **deactivated** — the strongest case. Suspension does not sign them out
 *     of anything they are looking at now; it makes the next thing they try
 *     fail. Told, they stop; untold, they call the hostel.
 *
 * Category `ACCOUNT` with an explicit `actionUrl` of the hostel dashboard,
 * which is the one page in that portal every role inside it can open — the
 * wardens page itself is gated on a capability the warden whose account just
 * changed may well not hold.
 */

function dashboardUrl() {
  return "/hostel-admin/dashboard";
}

export async function notifyWardenAdded(input: {
  actorUserId?: string;
  hostelId: Types.ObjectId | string;
  reactivated: boolean;
  userId: string;
}) {
  try {
    if (input.userId === input.actorUserId) {
      return;
    }

    const hostelName = await getHostelName(input.hostelId);

    await createInAppNotification({
      actionUrl: dashboardUrl(),
      body: input.reactivated
        ? `Your warden access at ${hostelName} has been restored.`
        : `You have been added as a warden at ${hostelName}.`,
      category: "ACCOUNT",
      createdBy: input.actorUserId,
      hostelId: String(input.hostelId),
      title: input.reactivated ? "Warden access restored" : "You are now a warden",
      userId: input.userId,
    });
  } catch {
    // Best effort; the membership row is written either way.
  }
}

export async function notifyWardenUpdated(input: {
  actorUserId?: string;
  hostelId: Types.ObjectId | string;
  permissionsChanged: boolean;
  status?: string;
  userId: string;
}) {
  try {
    if (input.userId === input.actorUserId) {
      return;
    }

    const suspended = input.status === "SUSPENDED";
    const reinstated = input.status === "ACTIVE";

    // Nothing the warden would notice — a rename, a no-op save. Sending it
    // would teach them this channel carries nothing.
    if (!suspended && !reinstated && !input.permissionsChanged) {
      return;
    }

    const hostelName = await getHostelName(input.hostelId);

    await createInAppNotification({
      actionUrl: dashboardUrl(),
      body: suspended
        ? `Your warden access at ${hostelName} has been suspended. Contact the hostel admin if this is unexpected.`
        : reinstated
          ? `Your warden access at ${hostelName} is active again.`
          : `What you can do at ${hostelName} has been changed by an admin.`,
      category: "ACCOUNT",
      createdBy: input.actorUserId,
      hostelId: String(input.hostelId),
      priority: suspended ? "HIGH" : "NORMAL",
      title: suspended
        ? "Warden access suspended"
        : reinstated
          ? "Warden access restored"
          : "Your permissions changed",
      userId: input.userId,
    });
  } catch {
    // Best effort.
  }
}
