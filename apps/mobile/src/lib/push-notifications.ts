/**
 * Expo push: permission, token, channels, registration.
 *
 * The server half already exists (`apps/web/src/modules/notifications/
 * push.service.ts`), batching to Expo and pruning dead tokens. This is what
 * gives it something to send to.
 *
 * ## Android channels are frozen at creation — get them right the first time
 *
 * `setNotificationChannelAsync` creates a channel with the sound, importance
 * and vibration given, and Android then **freezes all three**. Calling it again
 * with the same id only renames the channel; every other field is ignored, on
 * every install that already has it. The reference app
 * (`D:\Jiwan-Mijhar\app\lib\push-notifications.ts`) hit exactly this and had to
 * ship a `calls_v2` id, because its original `calls` channel had been created
 * with a short message chime and could never be corrected in place.
 *
 * So the ids below are a one-way door. Changing what one *does* means
 * publishing a new id — `urgent_v2` — **and** changing `androidChannel()` in
 * `push.service.ts` in the same release, since the server is what stamps
 * `channelId` on the message and Android silently falls back to `default` when
 * the id does not resolve.
 *
 * The three ids match that function exactly: `urgent` (SOS and anything
 * URGENT), `food` (meal-ready), `default` (everything else).
 *
 * ## Failure is always silent and never fatal
 *
 * Every call here is guarded. A phone with notifications denied, an emulator
 * with no Play Services, or a failed `/mobile/device-token` post must all leave
 * the app completely usable — the bell still works, because it is an ordinary
 * GET. Push is an accelerator, not a dependency.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "@/lib/api";
import { palette } from "@/constants/theme";
import { UPLOAD_NOTIFICATION_TYPE } from "@/lib/upload-notification";

/*
 * The notification LED / accent colour is deliberately the light palette's,
 * not the resolved theme's. A channel's settings are frozen at creation, so it
 * could never follow a theme toggle anyway — and this is brand chrome on the
 * system's surface, not part of the app's own.
 */
const BRAND = palette.light;

/**
 * Must match `androidChannel()` in `apps/web/src/modules/notifications/
 * push.service.ts`. See the note above before changing any of these.
 */
export const PUSH_CHANNEL = {
  DEFAULT: "default",
  FOOD: "food",
  URGENT: "urgent",
} as const;

/**
 * Read from app.json rather than hardcoded. `getExpoPushTokenAsync` needs it
 * explicitly in a bare/dev build — without it the call throws with a message
 * about the project id that reads like a configuration bug in Expo itself.
 */
function easProjectId(): string | undefined {
  const config = Constants.expoConfig as
    | { extra?: { eas?: { projectId?: string } } }
    | null;

  return config?.extra?.eas?.projectId;
}

/**
 * How a notification behaves while the app is **open**.
 *
 * Set at module scope, once. A banner over the app is right here: unlike the
 * reference app there is no call UI to suppress, and the alternative — silently
 * swallowing it because the app happens to be foregrounded — loses an SOS
 * alert for someone staring at the screen.
 *
 * `shouldShowBanner`/`shouldShowList` are the SDK 52+ replacements for the
 * deprecated `shouldShowAlert`, which is still returned because older Expo
 * runtimes read that one and ignore the new pair.
 *
 * ## The one exception: our own upload progress
 *
 * `lib/upload-notifier.ts` reposts a notification every 5% of a transfer. With
 * the default answer that is a banner sliding over the screen twenty times per
 * file, on top of the `<UploadToaster />` already showing the same thing — so
 * foregrounded, it goes to the **list only**, silently. The shade is where it
 * is useful; the screen already has a better version of it.
 *
 * Android's LOW-importance channel would suppress the heads-up on its own, but
 * iOS has no channels and this handler is the only place to say it.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isUploadProgress =
      notification.request.content.data?.type === UPLOAD_NOTIFICATION_TYPE;

    return {
      shouldPlaySound: !isUploadProgress,
      shouldSetBadge: !isUploadProgress,
      shouldShowAlert: !isUploadProgress,
      shouldShowBanner: !isUploadProgress,
      shouldShowList: true,
    };
  },
});

async function createAndroidChannels() {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.DEFAULT, {
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: BRAND.primary,
    name: "General",
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });

  /*
   * SOS and anything URGENT. MAX importance so it interrupts, lock-screen
   * visible so it can be read without unlocking — a safety alert that needs the
   * phone unlocked before it says anything has failed at the only moment it
   * mattered. `bypassDnd` is best-effort: Android ignores it unless the user has
   * granted Do Not Disturb access, and asking for that at install time would be
   * a permission prompt in front of a product nobody has used yet.
   */
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.URGENT, {
    bypassDnd: true,
    enableLights: true,
    enableVibrate: true,
    importance: Notifications.AndroidImportance.MAX,
    lightColor: BRAND.destructive,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    name: "Urgent alerts",
    sound: "default",
    vibrationPattern: [0, 400, 200, 400],
  });

  /*
   * Meal-ready. HIGH rather than MAX: it should reach someone who is not
   * looking at their phone, but dinner is not an emergency and a channel that
   * behaves like one is the channel people turn off — taking the SOS alerts
   * with it if they shared an id.
   */
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.FOOD, {
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: BRAND.primary,
    name: "Meals",
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });
}

export type PushPermission = "blocked" | "denied" | "granted" | "unsupported";

/**
 * Reads notification permission, and asks for it **only when told to**.
 *
 * ## `ask` defaults to false, and that is the whole point
 *
 * The system dialogue must never appear on its own. On Android 13+ a second
 * refusal sets `canAskAgain: false` permanently and the dialogue never appears
 * again — so a prompt fired over a dashboard the user has not read yet spends
 * the one chance the app gets, on the worst possible moment to ask.
 *
 * That rule was written here from the start and the code broke it anyway:
 * `usePush` called `registerPushToken()` on account change, and that function
 * opened with an unconditional request — so every signed-in cold start met the
 * dialogue. Defaulting to "read, do not ask" makes the rule the default rather
 * than a note above a function that ignored it.
 *
 * `blocked` is reported separately from `denied` because the two need different
 * UI: `denied` can still be asked again, `blocked` can only be sent to system
 * settings, and a "Turn on notifications" button shown to a blocked user is a
 * button that does nothing.
 */
export async function requestPushPermission(
  options: { ask?: boolean } = {},
): Promise<PushPermission> {
  // Simulators and emulators cannot be issued a push token at all, and asking
  // makes a dev build look broken rather than unsupported.
  if (!Device.isDevice) {
    return "unsupported";
  }

  const existing = await Notifications.getPermissionsAsync().catch(() => null);

  if (existing?.granted) {
    return "granted";
  }

  if (existing && !existing.canAskAgain) {
    return "blocked";
  }

  if (!options.ask) {
    // Not granted, and nobody asked us to ask. The caller registers nothing and
    // the Settings screen offers the prompt where it can be explained first.
    return "denied";
  }

  const asked = await Notifications.requestPermissionsAsync().catch(() => null);

  if (asked?.granted) {
    return "granted";
  }

  return asked && !asked.canAskAgain ? "blocked" : "denied";
}

/**
 * The Expo push token for this install, or null.
 *
 * Deliberately **no** fallback to `getDevicePushTokenAsync`. The raw FCM/APNS
 * token is not interchangeable with an Expo one: `push.service.ts` posts to
 * `exp.host/--/api/v2/push/send`, which rejects anything that is not an
 * `ExponentPushToken[…]`. Storing a device token would fill `DeviceToken` with
 * rows that can never be delivered to and that Expo never reports as
 * `DeviceNotRegistered`, so nothing would ever prune them.
 */
async function fetchExpoPushToken(): Promise<string | null> {
  const projectId = easProjectId();

  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  ).catch(() => null);

  return token?.data ?? null;
}

let lastRegisteredToken: string | null = null;

/** The token this install last sent to the server, for logout to revoke. */
export function currentPushToken() {
  return lastRegisteredToken;
}

export type PushRegistration = {
  permission: PushPermission;
  registered: boolean;
  token: string | null;
};

/**
 * Permission → channels → token → `POST /mobile/device-token`.
 *
 * Called on launch **for a signed-in account** and again after every login. Not
 * once per install: the row is keyed to `principal.userId`, so the same phone
 * used by two people has to register under each, or person B's alerts keep
 * arriving on a token the server still believes belongs to person A.
 *
 * Those calls pass no `ask`, so they are silent: an account that has already
 * granted permission is registered, and one that has not is left alone until it
 * chooses to turn notifications on from Settings.
 *
 * The same token re-posted is not a problem — `saveDeviceToken` upserts — but
 * it is skipped anyway, because launch and login both fire on a cold start
 * where a user just signed in.
 */
export async function registerPushToken(
  options: { ask?: boolean; force?: boolean } = {},
): Promise<PushRegistration> {
  // `ask` is off unless a caller opts in — see `requestPushPermission`. Boot and
  // the foreground re-check both register silently when permission is already
  // there and do nothing when it is not.
  const permission = await requestPushPermission({ ask: options.ask });

  if (permission !== "granted") {
    return { permission, registered: false, token: null };
  }

  // Before the token, not after: a token issued for a channel that does not
  // exist yet arrives on `default` with none of the urgent channel's settings.
  await createAndroidChannels().catch(() => undefined);

  const token = await fetchExpoPushToken();

  if (!token) {
    return { permission, registered: false, token: null };
  }

  if (!options.force && token === lastRegisteredToken) {
    return { permission, registered: true, token };
  }

  try {
    await api.post("/mobile/device-token", {
      // `deviceTokenSaveSchema` accepts IOS | ANDROID | WEB. Neither of the
      // other two can be reached from this app, and an unrecognised value is a
      // 400 that would read as a token problem.
      platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
      token,
    });

    lastRegisteredToken = token;

    return { permission, registered: true, token };
  } catch {
    // Offline, or the session ended between the token fetch and the post. The
    // next launch retries; nothing about the app is broken in the meantime.
    return { permission, registered: false, token };
  }
}

/**
 * Forgets the token locally so the next sign-in re-registers it.
 *
 * Local only, and not enough on its own — `revokePushToken` is what actually
 * stops delivery. What *this* prevents is the `token === lastRegisteredToken`
 * skip above quietly suppressing registration for the next account on a shared
 * phone.
 */
export function forgetPushToken() {
  lastRegisteredToken = null;
}

/**
 * Tells the server to stop sending to this device, on sign-out.
 *
 * ## Why forgetting locally was never enough
 *
 * `DeviceToken` rows are keyed to a user id, and the row survives sign-out. So
 * the account that just left kept receiving its invoices, complaint replies and
 * SOS alerts on a phone it had signed out of — indefinitely, because Expo only
 * reports `DeviceNotRegistered` for a token the app no longer holds, and this
 * one was still perfectly valid. On a shared or handed-down handset that is
 * someone else reading them.
 *
 * ## Called before the tokens are cleared
 *
 * `DELETE /mobile/device-token` is authenticated, so it has to go out while the
 * session is still usable — `endSession` runs it ahead of `clearTokens()`.
 *
 * ## Never blocks the sign-out
 *
 * Offline, already-expired, no permission ever granted: all of them end here
 * quietly. A user who taps "Sign out" is signed out either way; refusing would
 * strand them in an account they asked to leave, to fix a problem the *next*
 * registration corrects anyway (the upsert re-points the row at whoever signs
 * in next).
 */
export async function revokePushToken() {
  const token = lastRegisteredToken;

  forgetPushToken();

  if (!token) {
    return;
  }

  // `data` on a DELETE, because the token is long and credential-adjacent — a
  // query string would put it in every access log between here and the server.
  await api.delete("/mobile/device-token", { data: { token } }).catch(() => undefined);
}

/**
 * The app-icon badge.
 *
 * Driven from the unread count the bell already fetches rather than counted
 * here: two counters for one number always drift, and the server's is the one
 * that survives a reinstall. iOS is the platform that actually renders this;
 * most Android launchers show a dot at best, and the call is harmless there.
 */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => undefined);
}
