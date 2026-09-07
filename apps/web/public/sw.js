/*
 * The service worker that receives browser push notifications.
 *
 * ## What it deliberately does NOT do
 *
 * No `fetch` handler, and no caching. A service worker that caches is an
 * offline strategy, and an offline strategy layered over a Next app that
 * already does its own routing, revalidation and streaming is a way to serve
 * somebody yesterday's dashboard — with no error and no obvious cause, because
 * the stale page renders perfectly. This worker exists for one reason: a push
 * message has to be delivered to a process, and only a service worker is
 * running when the tab is closed. Everything else is out of scope on purpose.
 *
 * If offline support is ever wanted it belongs in a separate, explicit piece of
 * work — not smuggled in behind push.
 *
 * ## The payload
 *
 * Written by `web-push.service.ts` and read here. Flat and small, because push
 * services cap the encrypted body around 4 KB:
 *
 *   { title, body, url, category, tag, icon, badge, image, notificationId, urgent }
 *
 * `url` is decided on the server by `web-routing.ts` — the recipient's portal
 * is known there and not here — and is always a same-origin path. It is
 * re-checked below anyway: a client that trusts a field because the server
 * promised to sanitise it is one server bug away from opening whatever an
 * attacker likes.
 */

const FALLBACK_TITLE = "New notification";
const FALLBACK_URL = "/";

self.addEventListener("install", () => {
  // No precache to wait for, so take over immediately rather than sitting in
  // "waiting" until every tab is closed — which for a portal somebody keeps
  // open all day is functionally never.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(showNotification(event));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(openTarget(event.notification.data && event.notification.data.url));
});

/**
 * Re-subscribe when the browser rotates the subscription behind our back.
 *
 * Fires rarely and entirely without a page — a key rotation at the push
 * service, a browser update. Without this the old endpoint keeps being sent to
 * until it 410s and gets pruned, and the person simply stops receiving
 * notifications with nothing anywhere to explain why.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});

function readPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch {
    // A push with a body we did not write. Still worth showing rather than
    // dropping — a silent push is a spent wake-up with nothing to show for it.
    return { body: event.data.text() };
  }
}

/** Same-origin paths only. `//evil.example` reads local and resolves off-origin. */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return FALLBACK_URL;
  }

  return value;
}

async function showNotification(event) {
  const payload = readPayload(event);
  const url = safePath(payload.url);

  await self.registration.showNotification(payload.title || FALLBACK_TITLE, {
    badge: payload.badge || "/notification-badge.png",
    body: payload.body || "",
    data: { category: payload.category, notificationId: payload.notificationId, url },
    icon: payload.icon || "/notification-icon.png",
    // Large preview — the product photo on a store order, the meal photo on a
    // food announcement. Ignored where unsupported, so no feature detection.
    image: payload.image || undefined,
    // Replaces the previous notification with the same tag instead of stacking
    // beside it, which is what makes a batched row ("5 people reacted") read
    // correctly on the desktop as well as in the bell.
    renotify: Boolean(payload.tag),
    requireInteraction: Boolean(payload.urgent),
    tag: payload.tag || undefined,
    // An SOS should be felt, not just seen, on a phone browser.
    vibrate: payload.urgent ? [300, 120, 300, 120, 300] : undefined,
  });
}

/**
 * Focus the tab that is already on the target, otherwise reuse any open tab of
 * ours, otherwise open a new one.
 *
 * The middle case is the one that matters: somebody working in the portal all
 * day should not accumulate a window per notification.
 */
async function openTarget(rawUrl) {
  const target = new URL(safePath(rawUrl), self.location.origin);
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });

  for (const client of clients) {
    if (client.url === target.href && "focus" in client) {
      await client.focus();
      return;
    }
  }

  for (const client of clients) {
    if ("navigate" in client && "focus" in client) {
      try {
        await client.navigate(target.href);
        await client.focus();
        return;
      } catch {
        // A cross-origin or otherwise un-navigable client. Fall through and
        // open a window instead of giving up on the click.
      }
    }
  }

  if (self.clients.openWindow) {
    await self.clients.openWindow(target.href);
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);

  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function resubscribe(event) {
  try {
    const keyResponse = await fetch("/api/v1/push/public-key", { cache: "no-store" });

    if (!keyResponse.ok) {
      return;
    }

    const key = (await keyResponse.json())?.data?.publicKey;

    if (!key) {
      return;
    }

    const subscription = await self.registration.pushManager.subscribe({
      applicationServerKey: urlBase64ToUint8Array(key),
      userVisibleOnly: true,
    });

    await fetch("/api/v1/push/subscribe", {
      body: JSON.stringify({ subscription: subscription.toJSON() }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    const previous = event.oldSubscription && event.oldSubscription.endpoint;

    if (previous) {
      await fetch("/api/v1/push/unsubscribe", {
        body: JSON.stringify({ endpoint: previous }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => null);
    }
  } catch {
    // Nothing to report to and nobody to report it to. The next page load
    // re-subscribes through `web-push-client.ts`.
  }
}
