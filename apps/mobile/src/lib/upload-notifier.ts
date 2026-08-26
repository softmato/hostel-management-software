/**
 * Drives the system notification for uploads. Started once, at the app root.
 *
 * The decisions all live in `lib/upload-notification.ts`, which is testable;
 * this file is the part that talks to `expo-notifications` and is therefore
 * verified on a device. Keep it that way — anything with a rule in it belongs
 * on the other side of the import.
 *
 * ## It never asks for permission
 *
 * §4.5 of the task list: the system dialogue must not appear on its own, and on
 * Android 13+ a second refusal is permanent. An upload is the worst possible
 * moment to spend that one chance — the user is mid-payment. So this **reads**
 * permission and stays silent when it does not have it. The in-app toaster is
 * unaffected and still shows everything; the Settings screen is where the ask
 * lives, with an explanation in front of it.
 *
 * ## Serialised posts
 *
 * Every post is chained onto the previous one. Two `scheduleNotificationAsync`
 * calls issued a frame apart can resolve out of order, and the loser overwrites
 * the winner — which in practice means "Uploaded" flashing and then reverting
 * to "45%" forever, because nothing else is coming to correct it.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { palette } from "@/constants/theme";
import {
  DOWNLOAD_CHANNEL,
  DOWNLOAD_CHANNEL_NAME,
  DOWNLOAD_NOTIFICATION_TYPE,
  EMPTY_TALLY,
  shouldRepost,
  tallyUploads,
  UPLOAD_CHANNEL,
  UPLOAD_CHANNEL_NAME,
  UPLOAD_NOTIFICATION_ID,
  UPLOAD_NOTIFICATION_TYPE,
  type UploadNotice,
  uploadNotice,
  type UploadTally,
} from "@/lib/upload-notification";
import { getUploadRows, subscribeToUploads } from "@/lib/upload-queue";

/** Channel colour is brand chrome on the system's surface — see push-notifications.ts. */
const BRAND = palette.light;

let started = false;
let tally: UploadTally = EMPTY_TALLY;
let posted: UploadNotice | null = null;
let granted = false;
let pending: Promise<unknown> = Promise.resolve();

async function ensureChannel() {
  if (Platform.OS !== "android") {
    return;
  }

  /*
   * LOW: shows in the shade, never as a heads-up, never with a sound. A
   * progress notification that pops over the screen every 5% would be the
   * reason someone turns notifications off for this app — and channels are
   * all-or-nothing per app in the user's head, so that would take the SOS
   * alerts with it.
   */
  await Notifications.setNotificationChannelAsync(UPLOAD_CHANNEL, {
    importance: Notifications.AndroidImportance.LOW,
    lightColor: BRAND.primary,
    name: UPLOAD_CHANNEL_NAME,
    showBadge: false,
    sound: null,
    vibrationPattern: null,
  });

  /*
   * DEFAULT, unlike the progress channel above, and that difference is the
   * whole point. A finished download is the app's only report that a file now
   * exists on the phone; posted at LOW it lands silently in the list, which
   * reads as nothing having happened. Still no vibration — a browser does not
   * buzz when a CSV lands either.
   */
  await Notifications.setNotificationChannelAsync(DOWNLOAD_CHANNEL, {
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: BRAND.primary,
    name: DOWNLOAD_CHANNEL_NAME,
    showBadge: false,
    sound: null,
    vibrationPattern: null,
  });
}

/** Reads permission. Never asks — see the note at the top of the file. */
async function readPermission(): Promise<boolean> {
  const status = await Notifications.getPermissionsAsync().catch(() => null);

  return status?.granted ?? false;
}

async function apply(notice: UploadNotice | null) {
  if (notice === null) {
    await Notifications.dismissNotificationAsync(UPLOAD_NOTIFICATION_ID).catch(() => {});

    return;
  }

  const openable = notice.openUri !== null;

  await Notifications.scheduleNotificationAsync({
    content: {
      /*
       * A finished download stays until it is tapped or swiped. Everything else
       * is a progress readout with no life of its own once the transfer ends.
       */
      autoDismiss: !openable,
      body: notice.body,
      color: notice.tone === "failed" ? BRAND.destructive : BRAND.primary,
      data: openable
        ? {
            mimeType: notice.openMimeType,
            type: DOWNLOAD_NOTIFICATION_TYPE,
            uri: notice.openUri,
          }
        : { type: UPLOAD_NOTIFICATION_TYPE },
      // Silent throughout: the channel already handles Android, and iOS has no
      // channels, so the content has to say it too. `false`, not `null` — the
      // content type reads null as "unspecified" and falls back to the default
      // sound, which is the chime this is trying to avoid twenty times a file.
      sound: false,
      /*
       * Ongoing while bytes are moving, so it cannot be swiped away — a
       * transfer the user dismissed and then wonders about is the uncertainty
       * this whole feature exists to remove. Cleared the moment it finishes, so
       * the completion notice behaves like any other.
       */
      sticky: notice.ongoing,
      title: notice.title,
      ...(Platform.OS === "android" ? { channelId: notice.channel } : {}),
    },
    identifier: UPLOAD_NOTIFICATION_ID,
    trigger: null,
  }).catch(() => {
    /*
     * Swallowed on purpose. The shade is the secondary readout; the toaster on
     * screen is the primary one, and an upload must not fail because a
     * notification could not be posted.
     */
  });
}

function onQueueChanged() {
  const previouslyIdle = tally.active === 0;
  /*
   * Every row, both directions. `uploadNotice` reads the batch's direction and
   * picks its verb from it, so a download posts "Downloading statement export"
   * rather than borrowing the upload wording — which is the only reason this
   * ever needed filtering.
   */
  tally = tallyUploads(tally, getUploadRows());

  // A new batch is the one moment worth re-reading permission: the user may
  // have granted it in Settings since the last upload.
  const batchStarted = previouslyIdle && tally.active > 0;

  const next = uploadNotice(tally, Date.now());

  if (!shouldRepost(posted, next)) {
    return;
  }

  posted = next;

  pending = pending
    .then(async () => {
      if (batchStarted || !granted) {
        granted = await readPermission();
      }

      if (!granted) {
        return;
      }

      await apply(next);
    })
    .catch(() => {});
}

/**
 * Subscribes the shade to the upload queue.
 *
 * Idempotent: a second call is a no-op rather than a second subscription, so a
 * fast-refresh in development cannot end up posting every update twice.
 */
export function startUploadNotifications(): () => void {
  if (started) {
    return () => {};
  }

  started = true;
  void ensureChannel();

  const unsubscribe = subscribeToUploads(onQueueChanged);

  return () => {
    unsubscribe();
    started = false;
    /*
     * A teardown leaves an in-flight transfer's notification behind on purpose:
     * the upload itself is a plain module and keeps running, so clearing the
     * shade here would hide a transfer that is still happening.
     */
  };
}

/** Test seam, and the reset a sign-out uses so one account's rows cannot follow another. */
export function resetUploadNotifications() {
  tally = EMPTY_TALLY;
  posted = null;
  granted = false;
  void Notifications.dismissNotificationAsync(UPLOAD_NOTIFICATION_ID).catch(() => {});
}
