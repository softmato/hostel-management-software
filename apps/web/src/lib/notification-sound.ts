"use client";

/**
 * The app's notification tone, played by the page.
 *
 * ## Why the page, and not the notification
 *
 * A browser notification cannot carry a sound of its own. `showNotification`
 * once had a `sound` option; no browser ever implemented it and it has since
 * left the spec, so a Web Push notification makes whatever noise the operating
 * system gives every app. The only place our tone can come from is an open tab,
 * and it reaches one by two routes:
 *
 *   - the socket (`RealtimeProvider`), the moment a `notification:new` lands;
 *   - the service worker (`public/sw.js`), which asks open tabs to play it
 *     before showing a push, and shows that push silently if one did.
 *
 * With no tab open the push is shown with the system sound. That is the
 * browser's rule, not ours.
 *
 * ## Once per notification, across routes and tabs
 *
 * One notification usually arrives by both routes, and a portal is often open in
 * several tabs, each with its own socket — without coordination, a handful of
 * chimes for one row. So playing is a *claim* on the notification's id, recorded
 * in `localStorage` (which every tab of this origin shares) and taken inside a
 * Web Lock, which serialises the check-and-set across tabs. The first route in
 * any tab plays; everything after finds the claim.
 *
 * A claim is recorded only once playback has actually started. A tab nobody has
 * clicked is refused by the autoplay policy, and if it recorded the claim anyway
 * a tab that *could* have played would stay quiet — and the service worker,
 * told "already played", would silence the push too.
 *
 * ## Autoplay
 *
 * `play()` rejects until the page has had a user gesture. Chrome and Firefox
 * remember the gesture for the page's lifetime; Safari only lets an element play
 * that was first played *during* one, which is what `primeNotificationSound`
 * arranges on the first click or key press.
 */

/** Must match `SOUND_MESSAGE` in `public/sw.js`. */
export const NOTIFICATION_SOUND_MESSAGE = "hostelhub:play-notification-sound";

export type NotificationSoundResult = "already" | "failed" | "played";

const SOUND_URL = "/sounds/water-drop.mp3";
const CLAIMS_KEY = "hostelhub:notification-sound-claims";
const LOCK_NAME = "hostelhub:notification-sound";

/**
 * Long enough to cover a push the push service delivered well behind the
 * socket; short enough that a batched row updated later ("5 people reacted")
 * sounds again.
 */
const CLAIM_TTL_MS = 5 * 60_000;

let element: HTMLAudioElement | null = null;
let primed = false;

/**
 * This tab's own record, consulted alongside `localStorage` so that a browser
 * which refuses storage still does not chime twice for one notification here.
 */
const tabClaims = new Map<string, number>();

function audio() {
  if (!element) {
    element = new Audio(SOUND_URL);
    element.preload = "auto";
  }

  return element;
}

function liveClaims(now: number): Record<string, number> {
  let stored: Record<string, number> = {};

  try {
    stored = JSON.parse(window.localStorage.getItem(CLAIMS_KEY) ?? "{}") ?? {};
  } catch {
    stored = {};
  }

  for (const [id, at] of tabClaims) {
    if (now - at >= CLAIM_TTL_MS) {
      tabClaims.delete(id);
    }
  }

  return Object.fromEntries(
    Object.entries({ ...stored, ...Object.fromEntries(tabClaims) }).filter(
      ([, at]) => typeof at === "number" && now - at < CLAIM_TTL_MS,
    ),
  );
}

function recordClaim(id: string, now: number) {
  tabClaims.set(id, now);

  try {
    window.localStorage.setItem(
      CLAIMS_KEY,
      JSON.stringify({ ...liveClaims(now), [id]: now }),
    );
  } catch {
    // Storage blocked. `tabClaims` still covers this tab.
  }
}

async function attempt(id: string | undefined): Promise<NotificationSoundResult> {
  const now = Date.now();

  if (id && liveClaims(now)[id]) {
    return "already";
  }

  try {
    const player = audio();

    player.currentTime = 0;
    // Resolves when playback starts, not when it ends — the lock is held for
    // the start, never for the length of the chime.
    await player.play();
  } catch {
    return "failed";
  }

  if (id) {
    recordClaim(id, now);
  }

  return "played";
}

/**
 * Play the tone for one notification, unless another route or tab already has.
 *
 * Never throws. An id-less call (a platform broadcast) cannot be matched with
 * its twin and always plays — a second chime beats a silent one.
 */
export async function playNotificationSound(
  id?: string | null,
): Promise<NotificationSoundResult> {
  if (typeof window === "undefined") {
    return "failed";
  }

  const key = id || undefined;

  if (key && typeof navigator.locks?.request === "function") {
    try {
      return await navigator.locks.request(LOCK_NAME, () => attempt(key));
    } catch {
      // The lock manager itself failed — fall through to an unlocked attempt.
    }
  }

  return attempt(key);
}

/**
 * Start fetching the file, and unlock playback on the first gesture, so the
 * first real chime is neither refused nor waiting on the network. Idempotent;
 * returns a cleanup for the listeners.
 */
export function primeNotificationSound(): () => void {
  if (typeof window === "undefined" || primed) {
    return () => {};
  }

  primed = true;

  const player = audio();
  const events = ["pointerdown", "keydown"] as const;

  const stop = () => {
    for (const name of events) {
      window.removeEventListener(name, unlock, true);
    }
  };

  function unlock() {
    stop();

    // Muted, so the gesture that unlocks it makes no noise of its own.
    player.muted = true;
    player
      .play()
      .then(() => {
        player.pause();
        player.currentTime = 0;
      })
      .catch(() => undefined)
      .finally(() => {
        player.muted = false;
      });
  }

  for (const name of events) {
    // Capture phase: a component that stops propagation must not keep the
    // page locked.
    window.addEventListener(name, unlock, true);
  }

  return () => {
    stop();
    primed = false;
  };
}

/**
 * Answer the service worker's "can a tab play this?" — see `public/sw.js`. The
 * reply goes back on the port the worker sent, and is what decides whether the
 * push it is about to show makes the system sound.
 */
export function listenForNotificationSoundRequests(): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const container = navigator.serviceWorker;

  const onMessage = (event: MessageEvent) => {
    const message = event.data as { notificationId?: string; type?: string } | null;

    if (message?.type !== NOTIFICATION_SOUND_MESSAGE) {
      return;
    }

    const [port] = event.ports;

    void playNotificationSound(message.notificationId).then((result) =>
      port?.postMessage(result),
    );
  };

  container.addEventListener("message", onMessage);
  // A page's worker messages are queued until this is called (or `onmessage`
  // is assigned); `addEventListener` alone does not start them.
  container.startMessages();

  return () => container.removeEventListener("message", onMessage);
}
