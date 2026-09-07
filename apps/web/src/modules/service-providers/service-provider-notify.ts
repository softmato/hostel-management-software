import type { Types } from "mongoose";

import { REALTIME_TOPIC } from "@/lib/realtime/channels";
import { publishResourceChange } from "@/lib/realtime/server";
import { PLATFORM_ROLES } from "@/lib/permissions";
import { createInAppNotification } from "@/modules/notifications/notification.service";
import { UserModel } from "@hostel/db/models/User";

/**
 * Tell platform staff a service provider application is waiting for review.
 *
 * Registration used to acknowledge the applicant by email and reach nobody on
 * the review side, so an application sat in `PENDING_APPROVAL` until someone
 * happened to open the queue. Same shape as the pending-hostel fan-out: it
 * swallows its own errors, because the application row is already committed and
 * a notification failure must not turn a successful submission into a 500.
 */
export async function notifyPlatformOfServiceProviderApplication(provider: {
  _id: Types.ObjectId;
  category?: string;
  city?: string;
  fullName: string;
}) {
  try {
    const staff = await UserModel.find({
      isDeleted: { $ne: true },
      role: { $in: PLATFORM_ROLES },
      status: "ACTIVE",
    })
      .select("_id")
      .lean<{ _id: Types.ObjectId }[]>();

    const providerId = provider._id.toString();
    const where = provider.city ? ` in ${provider.city}` : "";

    await Promise.all(
      staff.map((member) =>
        createInAppNotification({
          // Approval is one click; rejection needs a reason, so it lives on the
          // review screen behind `actionUrl`.
          actions: [
            {
              endpoint: `/api/v1/platform/service-providers/${providerId}/approve`,
              key: "approve",
              label: "Approve provider",
              method: "PATCH",
              payload: {},
              tone: "primary",
            },
          ],
          actionUrl: "/platform/service-providers",
          body: `${provider.fullName}${where} applied to join as a service provider.`,
          category: "SERVICE_PROVIDER",
          data: { providerId },
          kind: "ACTION",
          title: "Service provider application",
          userId: member._id.toString(),
        }).catch(() => {}),
      ),
    );

    await publishResourceChange({
      platform: true,
      topics: [REALTIME_TOPIC.SERVICE_PROVIDERS],
    });
  } catch {
    // Never fail the registration over a notification.
  }
}

/**
 * The type that tells the app its account just changed shape.
 *
 * Written as a literal on both sides — the mobile half is `ROLE_CHANGE_TYPES`
 * in `lib/push-link.ts` — and deliberately not a shared package constant. The
 * API and an installed app ship on different clocks, a phone can be a month
 * behind, and a value the two must agree on forever is clearer frozen in two
 * places with a comment than imported from one that looks safe to rename.
 */
const PROVIDER_APPROVED_TYPE = "SERVICE_PROVIDER_APPROVED";

/**
 * Tell an applicant what the platform decided about them.
 *
 * ## What this fixes
 *
 * Approval used to reach the applicant by **email and nothing else**. The phone
 * in their pocket was still the ordinary browsing app: `resolveHome` routes on
 * `/auth/me`'s provider flag, and nothing re-read it while the app was running,
 * so a provider approved on a Tuesday afternoon kept the hostel-shopping shell
 * until the app was killed and cold-started. The hostel had been told they were
 * verified and their app disagreed.
 *
 * This is the signal that changes it. `usePush` treats a notification carrying
 * `PROVIDER_APPROVED_TYPE` as a role change — the one class of push handled on
 * *arrival* as well as on tap — and calls `adoptRoleChange`, which re-reads the
 * session and replaces the shell with the provider's own tabs. Nobody has to
 * tap anything, and nobody has to sign in again.
 *
 * ## Rejection is not silent either
 *
 * A refused applicant is owed the news on the surface they applied from, and
 * their `actionUrl` is the landing screen — the one place that offers a
 * corrected application. `HIDDEN` and `INACTIVE` stay silent, as the email does:
 * hiding a listing is a moderation action, not a decision the provider is owed
 * a notification about.
 *
 * Swallows its own errors, like the queue fan-out above: the status change is
 * already committed, and a notification failure must not turn an approval into
 * a 500 on the reviewer's screen.
 */
export async function notifyServiceProviderDecision(input: {
  approved: boolean;
  fullName: string;
  providerId: string;
  reason?: string;
  /** The linked platform account. Records predating the link have none. */
  userId: string;
}) {
  try {
    await createInAppNotification({
      actionUrl: input.approved ? "/jobs" : "/service-providers",
      body: input.approved
        ? "Your details and documents checked out. Jobs a hostel assigns you now arrive here."
        : input.reason
          ? `Your application wasn't approved: ${input.reason}`
          : "Your application wasn't approved. You can correct the details and send it again.",
      category: "SERVICE_PROVIDER",
      /*
       * `type` is what the app keys the role change on. `providerId` rides along
       * for the same reason every other payload carries its subject's id — a
       * later build that wants the record can read it without a new field.
       */
      data: {
        providerId: input.providerId,
        type: input.approved ? PROVIDER_APPROVED_TYPE : "SERVICE_PROVIDER_REJECTED",
      },
      priority: "HIGH",
      title: input.approved
        ? "You're an approved service provider"
        : "About your provider application",
      userId: input.userId,
    });
  } catch {
    // Never fail a review decision over a notification.
  }
}
