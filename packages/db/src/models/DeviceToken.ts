import { Schema, model, models } from "mongoose";

/**
 * One place a person can be pushed to.
 *
 * Deliberately **one** collection for both transports rather than a second
 * model beside it. A phone reached through Expo and a browser reached through
 * the Web Push protocol differ only in what `token` holds and whether `keys` is
 * filled in — everything around them is identical, and that "everything" is the
 * part worth not duplicating: sign-out revocation (`revokeDeviceToken`), the
 * account-deletion and account-purge sweeps, the preference and quiet-hours
 * filter, and the dead-endpoint pruning. A separate `WebPushSubscription`
 * collection would have meant a second copy of each of those, and the second
 * copy is the one that gets forgotten.
 *
 * `token` is therefore the address, in whatever form the platform uses:
 *   - `ANDROID` / `IOS` — an `ExponentPushToken[…]`.
 *   - `WEB` — the push service endpoint URL, which is what the browser hands
 *     out and what `webpush.sendNotification` addresses.
 *
 * The unique index holds for both: an Expo token and an endpoint are each
 * globally unique to one installation, which is exactly what makes upsert-on-
 * token the right way to re-register a device that moved between accounts.
 */
const deviceTokenSchema = new Schema(
  {
    userId: { ref: "User", required: true, type: Schema.Types.ObjectId },
    token: { required: true, trim: true, type: String },
    platform: {
      enum: ["IOS", "ANDROID", "WEB"],
      required: true,
      type: String,
    },
    deviceId: { trim: true, type: String },
    /**
     * The encryption material a Web Push message is sealed with. Empty on
     * `IOS` / `ANDROID`, where Expo owns the transport and there is nothing for
     * us to encrypt against.
     *
     * Both halves come from `PushSubscription.toJSON().keys` in the browser and
     * are useless without the endpoint, so they are stored beside it rather
     * than anywhere more careful — but a row missing either one cannot be sent
     * to at all, which is why `web-push.service.ts` skips instead of throwing.
     */
    keys: {
      auth: { type: String },
      p256dh: { type: String },
    },
    /**
     * When the browser says the subscription stops working. Almost always null
     * — no shipping push service sets it — but it is part of the subscription
     * the spec hands us, and `web-push` accepts it, so it is kept rather than
     * dropped.
     */
    expirationTime: { default: null, type: Number },
    /**
     * Which browser this is, so a person looking at "you have 3 browsers
     * subscribed" can tell which one to turn off. Never used for delivery.
     */
    userAgent: { trim: true, type: String },
    /**
     * What this install's JavaScript says it can do, re-sent on every
     * registration so an upgrade or a downgrade corrects it.
     *
     * Exists for one delivery decision in `push.service.ts`: an Android message
     * that should carry action buttons has to go out **data-only** so the app
     * draws it — a message with a title is drawn by the OS itself, which never
     * looks at the app's categories. A build that cannot draw it would receive
     * that data-only message and show nothing at all, so it is only ever sent to
     * a row that declared it. Empty on every row written before this existed,
     * which is exactly the set of builds that must keep the ordinary message.
     */
    capabilities: { default: [], type: [String] },
    lastSeenAt: { default: Date.now, type: Date },
    status: {
      default: "ACTIVE",
      enum: ["ACTIVE", "REVOKED"],
      type: String,
    },
  },
  { timestamps: true },
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
deviceTokenSchema.index({ userId: 1, status: 1 });

export const DeviceTokenModel =
  models.DeviceToken || model("DeviceToken", deviceTokenSchema);
