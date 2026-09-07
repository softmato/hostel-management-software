import type { z } from "zod";

import type { ApiPrincipal } from "@/lib/api-auth";
import { connectToDatabase } from "@/lib/db";
import { DeviceTokenModel } from "@hostel/db/models/DeviceToken";
import type {
  webPushSubscribeSchema,
  webPushUnsubscribeSchema,
} from "@/modules/notifications/notification.validation";

/**
 * Registering and forgetting a browser.
 *
 * The mirror of `saveDeviceToken` / `revokeDeviceToken` for the Web Push
 * transport, and it writes to the same `DeviceToken` collection — the endpoint
 * goes in `token`, the encryption material in `keys`. Everything that already
 * knew how to stop pushing to a device therefore already knows how to stop
 * pushing to a browser: sign-out, account deletion, account purge, and the
 * dead-endpoint pruning in `push.service.ts` all keep working untouched.
 *
 * ## Upsert on the endpoint, not on the account
 *
 * A push endpoint identifies one browser profile on one machine, and it is
 * stable across sign-outs. Keying on it means a shared machine re-attributes
 * cleanly: whoever signs in next claims that endpoint, and the previous
 * account's notifications stop arriving on it in the same request — which is
 * the leak `revokeDeviceToken`'s doc comment describes for phones, closed here
 * before it can open.
 */

type SubscribeInput = z.infer<typeof webPushSubscribeSchema>;
type UnsubscribeInput = z.infer<typeof webPushUnsubscribeSchema>;

export async function saveWebPushSubscription(
  input: SubscribeInput,
  principal: ApiPrincipal,
  userAgent?: string | null,
) {
  await connectToDatabase();

  const { endpoint, expirationTime, keys } = input.subscription;

  await DeviceTokenModel.findOneAndUpdate(
    { token: endpoint },
    {
      $set: {
        expirationTime: expirationTime ?? null,
        keys: { auth: keys.auth, p256dh: keys.p256dh },
        lastSeenAt: new Date(),
        platform: "WEB",
        // A browser that re-subscribes after being pruned is a browser that
        // wants notifications again, so this un-revokes rather than leaving a
        // dead row that quietly swallows every future send.
        status: "ACTIVE",
        userAgent: userAgent?.slice(0, 400) ?? undefined,
        userId: principal.userId,
      },
    },
    { new: true, upsert: true },
  );

  return { subscribed: true };
}

/**
 * Turning browser notifications off.
 *
 * Scoped to the caller for the same reason the phone version is: an endpoint is
 * posted by a page and is not secret, so without the `userId` in the filter
 * this route would be a way to silence any browser whose endpoint had been
 * observed. Answers success either way — the caller asked for "this browser is
 * not receiving", and a row that matches nothing already satisfies it.
 */
export async function revokeWebPushSubscription(
  input: UnsubscribeInput,
  principal: ApiPrincipal,
) {
  await connectToDatabase();

  const result = await DeviceTokenModel.updateMany(
    { token: input.endpoint, userId: principal.userId },
    { $set: { status: "REVOKED" } },
  );

  return { revoked: result?.modifiedCount ?? 0 };
}

/**
 * Whether this account has any browser still registered.
 *
 * The client asks on load because the browser's own answer is not enough: a
 * `PushSubscription` can exist in the browser while our row is gone (pruned
 * after a 410, or revoked by a sign-out on this machine), and in that state the
 * toggle would read "on" and deliver nothing. Server state decides.
 */
export async function countWebPushSubscriptions(principal: ApiPrincipal) {
  await connectToDatabase();

  const subscriptions = await DeviceTokenModel.countDocuments({
    platform: "WEB",
    status: "ACTIVE",
    userId: principal.userId,
  });

  return { subscriptions };
}
