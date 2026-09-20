/**
 * Moves a browser-storage value from an old key name to a new one, once.
 *
 * The `hostelhub:*` → `hostelpalika:*` rename is free for a cache — drop it and
 * it rebuilds. It is **not** free for the three keys that hold work nobody else
 * has a copy of: a half-finished hostel registration, a half-finished team
 * registration, and the marker saying an application was already submitted.
 * Renaming those without moving them first throws away somebody's afternoon,
 * or shows them a blank form for a hostel they have already filed.
 *
 * So the read goes through here: new key wins, and an old one is moved up and
 * removed the first time it is seen. Once every browser has been through the
 * app once, the `oldKey` argument can go.
 *
 * Storage access throws in a private window and with site data blocked, so
 * every call is wrapped — a failed migration must degrade to "no draft", never
 * to a crashed page.
 */
export function readRenamedStorage(
  storage: Storage,
  newKey: string,
  oldKey: string,
): string | null {
  try {
    const current = storage.getItem(newKey);

    if (current !== null) {
      return current;
    }

    const previous = storage.getItem(oldKey);

    if (previous === null) {
      return null;
    }

    storage.setItem(newKey, previous);
    storage.removeItem(oldKey);

    return previous;
  } catch {
    return null;
  }
}
