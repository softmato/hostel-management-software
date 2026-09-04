import { after } from "next/server";

/**
 * Work that must actually finish, but that the caller must not wait for.
 *
 * ## The bug this exists to end
 *
 * `void somePromise()` inside a route handler does not run on a serverless
 * platform. The response is written, the invocation is frozen, and anything
 * still in flight is discarded — silently, with no error anywhere, because the
 * request it belonged to succeeded.
 *
 * That is exactly how push notifications came to be dead in production while
 * every other channel worked. `publishNewNotification` awaited the Pusher call
 * and fire-and-forgot the Expo one, so the bell row arrived, the badge
 * incremented, and the phone never buzzed — for every notification the product
 * has ever raised from a request handler. Only the crons appeared to work, and
 * only by luck: they keep running for the rest of their batch, which gives the
 * abandoned promise time to land.
 *
 * `after()` is the platform's own answer. The callback runs once the response
 * has been sent — so the user is not waiting on it — and the invocation is kept
 * alive until it finishes.
 *
 * ## Why the fallback, and why it is not a silent downgrade
 *
 * `after()` needs a request context. A cron, a migration script and a unit test
 * have none, and there it throws rather than returning false. In those callers
 * there is no response to be torn down behind, so running the work immediately
 * is both correct and what they already did.
 *
 * Never rejects, in either branch. Everything routed through here is
 * best-effort by definition: the durable record is already written, and a
 * failed side effect must not surface as a failed request.
 */
export function afterResponse(work: () => unknown): void {
  /*
   * `await` rather than `.catch`, and `unknown` rather than `Promise`: this
   * has to hold for a callback that throws before it ever returns a promise,
   * and for one that returns nothing at all. Both are ordinary — the second is
   * every test double of a notifier — and a helper whose entire contract is
   * "never rejects" must not be the thing that takes a request down.
   */
  const guarded = async () => {
    try {
      await work();
    } catch {
      // Best-effort. The caller's own record is already committed.
    }
  };

  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
