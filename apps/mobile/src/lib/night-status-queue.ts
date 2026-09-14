/**
 * Answers that could not be posted the moment they were given.
 *
 * ## Why a queue exists at all
 *
 * The whole promise of this feature is that a resident answers from the
 * notification and never opens the app. That means the network call happens in
 * the worst possible conditions: a handset that may be dozing, on hostel Wi-Fi
 * that may be down, in a process the OS gives a few seconds and then kills. A
 * design that only tries once and shrugs would silently drop exactly the answers
 * it was built to collect — and the resident would have no idea, because they
 * saw the notification disappear and reasonably concluded it worked.
 *
 * So the order is: **write to disk, then try the network.** If the post
 * succeeds the entry is dropped; if anything at all goes wrong it stays, and the
 * next time the app is opened it is flushed with the ordinary API client, which
 * has the token refresh and the retry behaviour a background task cannot safely
 * carry.
 *
 * ## And why it is also the iOS answer
 *
 * `expo-notifications` documents its background task as running for a
 * notification action tap **on Android only**. So on an iPhone that has been
 * force-quit, the tap produces no JS at all until the app is next launched —
 * there is nothing to post from. The queue is what makes that a delay rather
 * than a loss: the response is replayed out of
 * `getLastNotificationResponseAsync` on the next launch, lands here, and flushes.
 *
 * ## AsyncStorage, not SecureStore
 *
 * The same call `claim-draft.ts` makes and for the same reason. A pending
 * "I am at home tonight" is not a secret worth a Keychain round trip on a device
 * that may be waking from doze, and SecureStore's writes are markedly slower —
 * which matters when the OS has given this process a few seconds to live. It is
 * the resident's own answer about their own night, already about to be sent to
 * their own hostel.
 *
 * ## The cap is deliberate and it drops the oldest
 *
 * One answer per night is expected, so a queue that has grown past a handful
 * means the network has been unreachable for days — and in that case the *newest*
 * answer is the one worth keeping, because it is the only one still about a
 * night anybody is looking at. An unbounded queue on a phone that is offline for
 * a month is a slow leak that ends in a corrupted read.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { NightStatusAnswer } from "@/lib/night-status-actions";

const QUEUE_KEY = "hh_night_status_queue";

/** See the note above on why this is small. */
const MAX_ENTRIES = 20;

export type QueuedNightStatus = NightStatusAnswer & {
  /**
   * The night this answer was about, as the prompt stated it.
   *
   * Carried so a flush that happens days later can be discarded rather than
   * filed against the wrong night — see {@link readNightStatusQueue}. Absent on
   * an answer given from a notification that carried no night, which is only
   * possible from a build older than the prompt.
   */
  night?: string;
  /** When the resident actually answered, not when it was finally sent. */
  answeredAt: string;
  /**
   * The prompt's own credential for this answer, and where it posts — see
   * `postAnswer`. Scoped to this one night and expired with it, so keeping it
   * beside the entry costs nothing once the entry is stale.
   */
  answerToken?: string;
  answerPath?: string;
};

async function readRaw(): Promise<QueuedNightStatus[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    /*
     * A shape guard rather than a cast. This value survives app upgrades, so it
     * can have been written by a build with a different idea of what an entry
     * is, and a malformed queue must never be the reason the app cannot start.
     */
    return Array.isArray(parsed)
      ? (parsed.filter(
          (entry) =>
            typeof entry === "object" && entry !== null && "status" in entry,
        ) as QueuedNightStatus[])
      : [];
  } catch {
    return [];
  }
}

/** Everything still waiting to be sent, oldest first. */
export async function readNightStatusQueue(): Promise<QueuedNightStatus[]> {
  return readRaw();
}

/**
 * Remember an answer before trying to send it.
 *
 * Never throws. It is called from a background handler with seconds to live and
 * an unhandled rejection there is a crash the resident sees as nothing at all.
 */
export async function enqueueNightStatus(entry: QueuedNightStatus): Promise<void> {
  try {
    const queue = await readRaw();

    /*
     * One entry per night. A resident who taps `Outside…`, changes their mind
     * and taps `Inside` while still offline has changed their answer, not made
     * two — and replaying both in order would end with whichever the array
     * happened to hold last rather than whichever they meant.
     */
    const withoutNight = entry.night
      ? queue.filter((queued) => queued.night !== entry.night)
      : queue;
    const next = [...withoutNight, entry].slice(-MAX_ENTRIES);

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  } catch {
    // Nothing to do and nobody to tell. See the note on never throwing.
  }
}

/** Drop one entry, once it has actually reached the server. */
export async function dequeueNightStatus(answeredAt: string): Promise<void> {
  try {
    const queue = await readRaw();
    const next = queue.filter((entry) => entry.answeredAt !== answeredAt);

    if (next.length === 0) {
      await AsyncStorage.removeItem(QUEUE_KEY);

      return;
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  } catch {
    // As above.
  }
}

export async function clearNightStatusQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // As above.
  }
}
