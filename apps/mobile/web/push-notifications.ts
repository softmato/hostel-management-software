import { api } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";
import type * as Native from "@/lib/push-notifications";
import { readTokens } from "@/lib/session";

/**
 * `lib/push-notifications.ts` for the installable web app: Web Push instead of
 * an Expo token, on the pipeline the website already runs — the site's own
 * `/sw.js`, its VAPID key, and a `DeviceToken` row with platform `WEB`.
 *
 * Registered at scope `/app/`, not `/`, so the app gets a subscription of its
 * own, separate from the website's in the same browser. It is sent with
 * `app: true`, which makes the server link its clicks to `/app/?push=<deep
 * link>` (see `PWA_PUSH` in the web app); `web/push-open.ts` turns that into the
 * screen the phone would open. Same exports, same rule as the phone: the
 * browser's permission prompt appears only when `ask` is passed, which only
 * Settings does — plus the shell's one-time sheet (`public/index.html`), raised
 * below after a signed-in boot, whose grant is heard below too. iPhone has Web Push only once the app is on the
 * Home Screen; in a Safari tab this answers "unsupported".
 */

const SCOPE = "/app/";

let registeredEndpoint: string | null = null;

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");

  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array) {
  const current = subscription.options.applicationServerKey;

  if (!current) {
    return true;
  }

  const bytes = new Uint8Array(current);

  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

export const requestPushPermission: typeof Native.requestPushPermission = async ({ ask = false } = {}) => {
  if (!supported()) {
    return "unsupported";
  }

  const permission =
    Notification.permission === "default" && ask
      ? await Notification.requestPermission()
      : Notification.permission;

  // A browser that says "denied" never shows the prompt again — the phone's "blocked".
  return permission === "granted" ? "granted" : permission === "denied" ? "blocked" : "denied";
};

export const registerPushToken: typeof Native.registerPushToken = async (options = {}) => {
  const permission = await requestPushPermission({ ask: options.ask });

  // `usePush` registers silently once a signed-in session has booted; a browser
  // that has never been asked gets the shell's one-time sheet at that moment.
  if (permission === "denied" && !options.ask) {
    window.dispatchEvent(new Event("pwa-ask-notifications"));
  }

  if (permission !== "granted") {
    return { permission, registered: false, token: null };
  }

  try {
    await navigator.serviceWorker.register("/sw.js", { scope: SCOPE });

    const registration = await navigator.serviceWorker.ready;
    const { publicKey } = unwrap(await api.get<ApiEnvelope<{ publicKey: string }>>("/push/public-key"));
    const key = keyBytes(publicKey);
    let subscription = await registration.pushManager.getSubscription();

    // A rotated VAPID pair leaves a subscription the server can no longer sign for.
    if (subscription && !sameKey(subscription, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }

    subscription ??= await registration.pushManager.subscribe({
      applicationServerKey: key,
      userVisibleOnly: true,
    });

    if (options.force || subscription.endpoint !== registeredEndpoint) {
      await api.post("/push/subscribe", { app: true, subscription: subscription.toJSON() });
    }

    registeredEndpoint = subscription.endpoint;

    return { permission, registered: true, token: subscription.endpoint };
  } catch {
    return { permission, registered: false, token: null };
  }
};

// The shell's first-start ask reports a grant here, so a signed-in session
// subscribes now; a signed-out one subscribes at sign-in, as `usePush` registers.
window.addEventListener("pwa-notifications-granted", () => {
  void readTokens().then((tokens) => (tokens?.accessToken ? registerPushToken() : undefined));
});

export const currentPushToken: typeof Native.currentPushToken = () => registeredEndpoint;

export const forgetPushToken: typeof Native.forgetPushToken = () => {
  registeredEndpoint = null;
};

export const revokePushToken: typeof Native.revokePushToken = async () => {
  const endpoint = registeredEndpoint;

  registeredEndpoint = null;

  if (endpoint) {
    await api.post("/push/unsubscribe", { endpoint }).catch(() => undefined);
  }
};

/** The installed app's icon badge, where the browser supports one. */
export const setBadgeCount: typeof Native.setBadgeCount = async (count) => {
  const badge = navigator as Navigator & {
    clearAppBadge?: () => Promise<void>;
    setAppBadge?: (count: number) => Promise<void>;
  };

  await (count > 0 ? badge.setAppBadge?.(count) : badge.clearAppBadge?.())?.catch(() => undefined);
};
