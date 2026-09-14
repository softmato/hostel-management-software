import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * Fills the query cache for a whole portal the moment its shell mounts, and
 * again every time the app comes back to the foreground.
 *
 * ## In parallel with the landing screen, not after it
 *
 * The warm-ups used to wait for an idle frame, then three or four seconds more,
 * so every other tab's data queued behind Home's. The waves now fire in the same
 * commit as the landing screen. Order is still preserved where it matters:
 * React runs a child's effects before its parent's, so the screen's own
 * `useResource` issues its requests first, and the warm-up lists the landing
 * keys first as well — whichever asks second joins the request already in
 * flight (`fetchQuery` deduplicates by key). The rest sit behind them in the
 * native HTTP dispatcher's queue instead of behind a timer.
 *
 * ## Again on foreground
 *
 * The cache drops an answer past `DEFAULT_MAX_AGE_MS`, so a phone left in a
 * pocket would come back to a portal of skeletons. Re-running the wave on
 * `active` refills it before a tab is tapped; `prefetchQuery` skips every key
 * still fresh, so this costs only what actually aged out.
 *
 * `task` must be a stable module-level function — it is the effect's only
 * dependency.
 */
export function usePortalWarmup(task: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    task();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        task();
      }
    });

    return () => subscription.remove();
  }, [enabled, task]);
}
