/**
 * Posts the system notification for a payment-claim outcome.
 *
 * The thin half of the pair: the rules are in `lib/claim-notification.ts` and
 * testable, this talks to `expo-notifications` and is verified on a device. Same
 * split — and same reasons — as `lib/upload-notifier.ts`.
 *
 * ## It never asks for permission
 *
 * The system dialogue must not appear on its own, and on Android 13+ a second
 * refusal is permanent. Pressing Submit on a rent payment is the worst possible
 * moment to spend that one chance. So this **reads** permission and stays silent
 * without it — the on-screen notice and the toaster are unaffected and still say
 * everything. The ask lives on the Settings screen, behind an explanation.
 *
 * ## Serialised posts
 *
 * Chained onto the previous one, like the upload notifier: two
 * `scheduleNotificationAsync` calls a frame apart can resolve out of order, and
 * on this screen that would mean a refusal arriving after the success that
 * replaced it.
 *
 * ## Failures are swallowed
 *
 * Every call is best-effort. A resident's claim must never fail, or block, or
 * even look different because the shade could not be written to.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { palette } from "@/constants/theme";
import {
  CLAIM_CHANNEL,
  CLAIM_CHANNEL_NAME,
  CLAIM_NOTIFICATION_TYPE,
  type ClaimOutcome,
  claimNotice,
} from "@/lib/claim-notification";

/** Channel colour is brand chrome on the system's surface — see push-notifications.ts. */
const BRAND = palette.light;

let channelReady = false;
let pending: Promise<unknown> = Promise.resolve();

async function ensureChannel() {
  if (Platform.OS !== "android" || channelReady) {
    return;
  }

  /*
   * DEFAULT, not LOW — the opposite call from the upload channel's, for the
   * opposite reason. Upload progress is twenty notifications per file and must
   * never pop; a claim outcome is exactly one per attempt and is the whole
   * point of the exercise. A refusal that lands silently in the list is a
   * refusal the resident finds tomorrow.
   *
   * No vibration: this fires while the phone is often in the resident's hand,
   * and the banner plus the on-screen notice are already saying it.
   */
  await Notifications.setNotificationChannelAsync(CLAIM_CHANNEL, {
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: BRAND.primary,
    name: CLAIM_CHANNEL_NAME,
    showBadge: false,
    sound: null,
    vibrationPattern: null,
  });

  channelReady = true;
}

/** Reads permission. Never asks — see the note at the top of the file. */
async function readPermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync().catch(() => null);

  return status?.granted ?? false;
}

/**
 * Announce one conclusion about a claim: a refusal, or a claim that went in.
 *
 * Fire-and-forget by design — callers sit in render paths and event handlers
 * that must not wait on the shade. Nothing here is awaited by the screen.
 */
export function notifyClaimOutcome(
  outcome: ClaimOutcome,
  invoiceId: string | null | undefined,
): void {
  const notice = claimNotice(outcome, invoiceId);

  if (!notice) {
    return;
  }

  pending = pending
    .then(async () => {
      if (!(await readPermission())) {
        return;
      }

      await ensureChannel();

      await Notifications.scheduleNotificationAsync({
        content: {
          autoDismiss: true,
          body: notice.body,
          color: notice.tone === "failure" ? BRAND.destructive : BRAND.primary,
          data: {
            // Read by `resolvePushPath` in `usePush`, which already routes
            // `/invoice/{id}` — so a tap lands on the invoice this claim was
            // about rather than on the app's home screen.
            path: notice.path,
            type: CLAIM_NOTIFICATION_TYPE,
          },
          /*
           * `false`, not `null`: the content type reads null as "unspecified"
           * and falls back to the system default sound. Android's channel
           * already says silent, and iOS has no channels, so the content has to
           * say it too.
           */
          sound: false,
          title: notice.title,
          ...(Platform.OS === "android" ? { channelId: CLAIM_CHANNEL } : {}),
        },
        // Immediately.
        trigger: null,
      });
    })
    .catch(() => {
      // Best-effort throughout. See the note at the top of the file.
    });
}
