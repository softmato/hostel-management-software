import { resolvePushPath } from "@/lib/push-link";

/**
 * A tapped notification opens `/app/?push=<deep link>` (see
 * `web/push-notifications.ts`). Before the router reads the address, that
 * becomes the screen the phone would open for the same push, through the app's
 * own `resolvePushPath`. The root layout keeps a deep-linked screen rather than
 * sending it home, as it does for the phone.
 */
const push = new URLSearchParams(window.location.search).get("push");

if (push !== null) {
  window.history.replaceState(null, "", `/app${resolvePushPath(push)}`);
}
