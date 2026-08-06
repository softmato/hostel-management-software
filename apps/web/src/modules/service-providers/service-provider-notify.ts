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
