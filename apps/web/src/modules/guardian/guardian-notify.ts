import type { Types } from "mongoose";

import { createInAppNotification } from "@/modules/notifications/notification.service";
import { getHostelName } from "@/modules/residents/resident-notify";
import { ResidentModel } from "@hostel/db/models/Resident";

/**
 * The resident ↔ guardian loop, which until now was carried entirely by email.
 *
 * Email is right for the invitation itself — the guardian has no account yet,
 * so there is nobody to notify — but wrong for everything after it, where both
 * sides *do* have accounts and the events are ones people act on:
 *
 *   - a guardian accepting is the moment a resident's family can see their
 *     payments, notices and safety status, and the resident is the person who
 *     granted that. They should be told it took effect, not discover it;
 *   - a permission change and a revocation land on somebody else's account
 *     silently. A guardian who opens the app to a screen that has stopped
 *     working, with nothing to explain it, reports a bug.
 *
 * All best-effort: the access row is written before any of this runs.
 */

/** The user account behind a resident record, if that resident has one. */
async function residentUserId(residentId: Types.ObjectId | string) {
  const resident = await ResidentModel.findOne({ _id: residentId })
    .select({ userId: 1 })
    .lean<{ userId?: Types.ObjectId } | null>();

  return resident?.userId?.toString() ?? null;
}

/** The resident hearing that their guardian is now in. */
export async function notifyResidentGuardianAccepted(input: {
  guardianName: string;
  hostelId: Types.ObjectId | string;
  residentId: Types.ObjectId | string;
}) {
  try {
    const userId = await residentUserId(input.residentId);

    if (!userId) {
      return;
    }

    await createInAppNotification({
      actionUrl: "/resident/guardians",
      body: `${input.guardianName} accepted your invitation and can now see what you allowed.`,
      category: "GUARDIAN",
      /*
       * One category, two audiences — the same shape `FOOD` already has. A
       * resident's copy belongs on their guardians list and a guardian's copy
       * belongs in the guardian portal, and neither account can open the
       * other's screen, so the routing has to be told which this is.
       */
      data: { audience: "RESIDENT" },
      hostelId: String(input.hostelId),
      title: "Guardian linked",
      userId,
    });
  } catch {
    // Best effort.
  }
}

/**
 * The guardian hearing that what they can see has changed.
 *
 * Deliberately does not enumerate the permissions. The list belongs on the
 * screen the notification links to, where it is current; a push carrying six
 * booleans is unreadable in a tray and stale the moment the resident edits
 * again.
 */
export async function notifyGuardianOfPermissionChange(input: {
  guardianUserId?: string;
  hostelId: Types.ObjectId | string;
  residentName: string;
}) {
  try {
    if (!input.guardianUserId) {
      return;
    }

    const hostelName = await getHostelName(input.hostelId);

    await createInAppNotification({
      actionUrl: "/guardian/dashboard",
      body: `${input.residentName} changed what you can see at ${hostelName}.`,
      category: "GUARDIAN",
      data: { audience: "GUARDIAN" },
      hostelId: String(input.hostelId),
      title: "Your access changed",
      userId: input.guardianUserId,
    });
  } catch {
    // Best effort.
  }
}

/**
 * The guardian hearing that their access is gone.
 *
 * The one message here that must arrive: without it the next thing that
 * happens is a guardian opening the app, finding the resident missing, and
 * telephoning the hostel about it.
 */
export async function notifyGuardianOfRevocation(input: {
  guardianUserId?: string;
  hostelId: Types.ObjectId | string;
  residentName: string;
}) {
  try {
    if (!input.guardianUserId) {
      return;
    }

    await createInAppNotification({
      body: `${input.residentName} has ended your guardian access. You will no longer see their hostel information.`,
      category: "GUARDIAN",
      data: { audience: "GUARDIAN" },
      hostelId: String(input.hostelId),
      priority: "HIGH",
      title: "Guardian access ended",
      userId: input.guardianUserId,
    });
  } catch {
    // Best effort.
  }
}
