/**
 * Topic → "refetch yourself", for screens built on `use-resource`.
 *
 * The web solves this with TanStack Query: `resource:changed` names the domain
 * topics that moved, `endpointsForTopics` turns those into endpoint prefixes,
 * and every mounted panel reading one of them refetches. Mobile has no query
 * cache to invalidate — `use-resource` holds its data in component state — so
 * there is nothing to drop and no shared key space to match on.
 *
 * This is the smallest thing that gives the same result: a screen says which
 * topics it cares about, the socket publishes the topics that changed, and the
 * matching screens re-run their own loader. Endpoint prefixes never enter it,
 * because on mobile the loader is a function the screen already owns.
 *
 * ## Why a plain module store and not Redux
 *
 * Same reason as `lib/upload-queue.ts`: `redux-persist` writes to AsyncStorage
 * on every change, and these events fire per server mutation. Persisting them
 * would also be meaningless — an invalidation is only interesting to a screen
 * that is mounted right now.
 *
 * Kept free of anything React Native so the node-side tests can load it.
 */

import { REALTIME_TOPIC_VALUES, type RealtimeTopic } from "@/constants/topics";

type Listener = (topics: RealtimeTopic[]) => void;

const listeners = new Set<Listener>();

/**
 * Subscribes to every topic publish. Returns the unsubscribe.
 *
 * Filtering is the subscriber's job — `subscribeTopics` below does it — because
 * a screen's topic list can change between renders and re-registering on every
 * change would be a second source of bugs for no gain at this scale.
 */
export function subscribeAllTopics(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes to a specific set. Fires only when one of them is published. */
export function subscribeTopics(
  topics: readonly RealtimeTopic[],
  listener: () => void,
): () => void {
  if (topics.length === 0) {
    return () => {};
  }

  const wanted = new Set<string>(topics);

  return subscribeAllTopics((published) => {
    if (published.some((topic) => wanted.has(topic))) {
      listener();
    }
  });
}

/**
 * Announces that these topics changed server-side.
 *
 * Unknown topics are dropped rather than forwarded. The list arrives over a
 * socket, so it is untrusted input, and a server that adds a topic this build
 * has never heard of should be a no-op — not a string handed to every
 * subscriber's comparison.
 *
 * A listener that throws must not stop the ones after it: they are unrelated
 * screens, and one broken loader taking out the rest would turn a small bug
 * into a dead app.
 */
export function publishTopics(topics: readonly unknown[]): RealtimeTopic[] {
  const known = topics.filter((topic): topic is RealtimeTopic =>
    REALTIME_TOPIC_VALUES.includes(topic as RealtimeTopic),
  );

  if (known.length === 0) {
    return [];
  }

  // Copied before iterating: a listener that unsubscribes itself while being
  // notified would otherwise mutate the set mid-iteration.
  for (const listener of [...listeners]) {
    try {
      listener(known);
    } catch {
      // Deliberately swallowed. See above.
    }
  }

  return known;
}

/** Test seam. Nothing in the app calls this. */
export function resetResourceBus() {
  listeners.clear();
}
