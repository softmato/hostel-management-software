/**
 * Scheduling for work that must not compete with the screen someone is looking
 * at — portal prefetches, mostly.
 *
 * This replaces `InteractionManager.runAfterInteractions`, which React Native
 * deprecated in 0.86 and prints a warning for on first access. Two things are
 * worth knowing before reaching back for it:
 *
 * 1. It no longer does what its name says. `InteractionManager` in 0.86 is a
 *    stub whose `runAfterInteractions` is a bare `setImmediate` — it does not
 *    look at touches or animations any more. Every "after the navigation
 *    settles" comment written against it has been describing a `setImmediate`
 *    for a while.
 * 2. `requestIdleCallback` is the replacement React Native names, and it is the
 *    stronger of the two: it runs on a genuinely idle JS frame rather than at
 *    the end of the current tick.
 *
 * The `timeout` is the part that matters for prefetching. Without one an idle
 * callback can be starved indefinitely on a busy phone, and a warm-up that
 * never fires is worse than one that fires slightly late — so the callback is
 * promoted to a plain timer once the deadline passes.
 */
const IDLE_TIMEOUT_MS = 2_000;

/**
 * Runs `task` on the first idle frame, or after {@link IDLE_TIMEOUT_MS} if the
 * phone never goes idle. Returns the canceller to hand back from `useEffect`.
 */
export function runWhenIdle(task: () => void): () => void {
  const handle = requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });

  return () => cancelIdleCallback(handle);
}
