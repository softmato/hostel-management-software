"use client";

import { browserApi } from "@/lib/browser-api";

/**
 * Turning browser notifications on and off, from the page.
 *
 * Four things have to line up before a notification can arrive on a laptop with
 * the tab closed, and any one of them missing produces the same symptom —
 * nothing happens:
 *
 *   1. the browser supports `Notification`, `serviceWorker` and `PushManager`;
 *   2. the user has granted permission;
 *   3. a service worker is registered and active;
 *   4. this server holds a row for the resulting subscription.
 *
 * Nothing here assumes any of them. Every entry point re-derives the state it
 * needs, because the four drift apart in ordinary use: permission is revoked
 * from the browser's site settings without telling the page, a subscription is
 * pruned server-side after a `410`, a different account signs in on the same
 * machine.
 */

export type PushSupport = {
  /** The browser can do this at all. */
  supported: boolean;
  /** What the user has already decided, if anything. */
  permission: NotificationPermission;
};

const SERVICE_WORKER_PATH = "/sw.js";

export function readPushSupport(): PushSupport {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return { permission: "denied", supported: false };
  }

  return { permission: Notification.permission, supported: true };
}

/** base64url → the `Uint8Array` `pushManager.subscribe` insists on. */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);

  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

/**
 * The active registration, registering one if this is the first visit.
 *
 * `navigator.serviceWorker.ready` never rejects — it simply never settles when
 * nothing is registered — so it is raced against a timeout rather than awaited
 * bare. A hung promise here would leave the toggle spinning forever, which is a
 * worse answer than "could not turn it on, try again".
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);

    if (existing) {
      return existing;
    }

    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });

    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
    ]);
  } catch {
    return null;
  }
}

async function publicKey(): Promise<string | null> {
  try {
    const { publicKey: key } = await browserApi<{ publicKey: string }>(
      "/api/v1/push/public-key",
      { cache: "no-store" },
    );

    return key || null;
  } catch {
    // 503 when the deployment has no VAPID pair. Not an error worth showing —
    // the caller renders the toggle as unavailable instead.
    return null;
  }
}

/**
 * Whether an existing subscription was made against the key we are sending
 * with now.
 *
 * A subscription is bound to the public key it was created with. If the pair is
 * ever rotated, every existing subscription keeps looking healthy in the
 * browser and silently rejects every send — so a mismatch has to be found here
 * and re-subscribed, not discovered as "notifications stopped working".
 */
function matchesKey(subscription: PushSubscription, key: string) {
  const current = subscription.options.applicationServerKey;

  if (!current) {
    return true;
  }

  const currentBytes = new Uint8Array(current);
  const expectedBytes = urlBase64ToUint8Array(key);

  return (
    currentBytes.length === expectedBytes.length &&
    currentBytes.every((byte, index) => byte === expectedBytes[index])
  );
}

async function syncToServer(subscription: PushSubscription) {
  await browserApi("/api/v1/push/subscribe", {
    body: JSON.stringify({ subscription: subscription.toJSON() }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "denied" | "unconfigured" | "failed" };

/**
 * Ask for permission if needed, subscribe, and register with the server.
 *
 * Must be called from a user gesture: Chrome ignores a permission prompt that
 * did not come from a click, and Safari refuses it outright.
 */
export async function enableBrowserPush(): Promise<EnableResult> {
  const { supported } = readPushSupport();

  if (!supported) {
    return { ok: false, reason: "unsupported" };
  }

  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

  if (permission !== "granted") {
    return { ok: false, reason: "denied" };
  }

  const key = await publicKey();

  if (!key) {
    return { ok: false, reason: "unconfigured" };
  }

  const registration = await activeRegistration();

  if (!registration) {
    return { ok: false, reason: "failed" };
  }

  try {
    const existing = await registration.pushManager.getSubscription();

    if (existing && !matchesKey(existing, key)) {
      // Bound to a retired key. Unsubscribing first is what makes the next
      // `subscribe` mint a fresh endpoint rather than hand back the dead one.
      await existing.unsubscribe().catch(() => null);
    }

    const subscription =
      existing && matchesKey(existing, key)
        ? existing
        : await registration.pushManager.subscribe({
            applicationServerKey: urlBase64ToUint8Array(key),
            // Non-negotiable: browsers only allow a push that results in a
            // visible notification, and lying about it gets the subscription
            // revoked.
            userVisibleOnly: true,
          });

    await syncToServer(subscription);

    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Stop this browser receiving.
 *
 * Both halves, in this order: the server row first, so delivery stops even if
 * the browser-side unsubscribe fails, and then the browser's own subscription
 * so the endpoint is released rather than left to be pruned by a future 410.
 */
export async function disableBrowserPush(): Promise<boolean> {
  const { supported } = readPushSupport();

  if (!supported) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration(
      SERVICE_WORKER_PATH,
    );
    const subscription = await registration?.pushManager.getSubscription();

    if (subscription) {
      await browserApi("/api/v1/push/unsubscribe", {
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => null);

      await subscription.unsubscribe().catch(() => null);
    }

    return true;
  } catch {
    return false;
  }
}

export type PushStatus = {
  configured: boolean;
  enabled: boolean;
  subscriptions: number;
};

export async function readPushStatus(): Promise<PushStatus | null> {
  try {
    return await browserApi<PushStatus>("/api/v1/push/status", { cache: "no-store" });
  } catch {
    return null;
  }
}

/**
 * Quietly put things back in order on page load.
 *
 * Called on every portal mount, and it never prompts — it only acts when
 * permission is *already* granted, which means the person has said yes at some
 * point and expects notifications to keep working. It exists because the four
 * conditions at the top of this file come apart on their own:
 *
 *   - a new deploy ships a new service worker;
 *   - the server pruned this endpoint after a push service returned `410`;
 *   - somebody else signed in on this machine and the row now names them.
 *
 * In every one of those the browser still reports a healthy subscription and
 * nothing is delivered. Re-posting the current subscription costs one request
 * and re-attaches it to the signed-in account.
 */
export async function resyncBrowserPush(): Promise<void> {
  const { permission, supported } = readPushSupport();

  if (!supported || permission !== "granted") {
    return;
  }

  const key = await publicKey();

  if (!key) {
    return;
  }

  const registration = await activeRegistration();

  if (!registration) {
    return;
  }

  try {
    const existing = await registration.pushManager.getSubscription();

    if (existing && matchesKey(existing, key)) {
      await syncToServer(existing);
      return;
    }

    if (existing) {
      await existing.unsubscribe().catch(() => null);
    }

    const subscription = await registration.pushManager.subscribe({
      applicationServerKey: urlBase64ToUint8Array(key),
      userVisibleOnly: true,
    });

    await syncToServer(subscription);
  } catch {
    // Best effort by definition. The toggle in the bell is the explicit path.
  }
}
