import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { readApiError } from "@/lib/api-contract";

/**
 * One GET, with the four states every screen has to render.
 *
 * The web has TanStack Query for this; mobile deliberately does not, because
 * the offline cache in M8 is Redux-persist's job and two caches that disagree
 * is worse than one. What screens actually need from a query library is this
 * hook's surface, so this is that and nothing more.
 *
 * Four things here are not obvious:
 *
 * 1. **`loading` is the first load only.** A pull-to-refresh that swapped the
 *    list for a spinner would throw away the thing the user is looking at, and
 *    a background revalidate that did it would flicker on every tab switch.
 *    Those set `refreshing` instead, and the stale data stays on screen.
 *
 * 2. **Responses are matched to the request that asked for them.** Pull to
 *    refresh while the first load is still in flight and the two land in
 *    whatever order the network decides; without the sequence check the older
 *    payload wins and the screen shows data the user already refreshed away.
 *
 * 3. **Refocus revalidates silently.** Paying an invoice happens in a browser
 *    handoff or on another screen, so returning to a tab is when stale numbers
 *    are most likely and least excusable. The first focus is skipped — the
 *    mount effect already covers it.
 *
 * 4. **Raising the spinner belongs to the caller, not to the fetch.** `loading`
 *    starts `true`, so the mount fetch has nothing to set before its first
 *    `await`; `reload()` and `refresh()` set their own flag in the event
 *    handler. That is what keeps the mount effect free of a synchronous
 *    `setState` — a real extra render on every screen, and one React's lint
 *    rules trace into the callee to find.
 */

export type Resource<T> = {
  data: T | null;
  error: string | null;
  /** First load, with nothing to show yet. Render `<LoadingState>`. */
  loading: boolean;
  refresh: () => void;
  refreshing: boolean;
  /** Full reload with the spinner — for the `<ErrorState>` retry button. */
  reload: () => void;
  /** Local, optimistic edit. Replaced by whatever the next fetch returns. */
  setData: (updater: (current: T | null) => T | null) => void;
};

export function useResource<T>(
  load: () => Promise<T>,
  { refetchOnFocus = true }: { refetchOnFocus?: boolean } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // `load` is nearly always an inline arrow, so a new identity every render.
  // Holding it in a ref keeps `run` stable — otherwise the mount effect below
  // re-fires on every render and the screen fetches in a loop.
  //
  // Assigned in an effect rather than during render, and declared *before* the
  // fetch effect so it lands first on mount: effects run in source order.
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const mounted = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  /*
   * Fetches, and touches no state until after the first `await`.
   *
   * Raising the spinner is the caller's job — `reload`/`refresh` do it in the
   * event handler where a synchronous render is expected and cheap. Keeping it
   * out of here is what lets the mount effect call `run` at all: React's lint
   * rules trace into the callee, so a single synchronous `setState` anywhere in
   * this function would make every effect that calls it a cascading render.
   */
  const run = useCallback(async (silent: boolean) => {
    const ticket = ++sequence.current;

    try {
      const result = await loadRef.current();

      if (!mounted.current || ticket !== sequence.current) {
        return;
      }

      setData(result);
      setError(null);
    } catch (caught) {
      if (!mounted.current || ticket !== sequence.current) {
        return;
      }

      // A failed background revalidate keeps whatever is already on screen.
      // Replacing a working list with an error because the phone walked into a
      // lift is not an improvement.
      if (silent) {
        return;
      }

      setError(readApiError(caught));
      setData(null);
    } finally {
      if (mounted.current && ticket === sequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // `loading` already starts `true`, so the first fetch has no spinner to
    // raise and this effect sets nothing synchronously.
    void run(false);
  }, [run]);

  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }

      if (refetchOnFocus) {
        void run(true);
      }
    }, [refetchOnFocus, run]),
  );

  return {
    data,
    error,
    loading,
    refresh: useCallback(() => {
      setRefreshing(true);
      void run(false);
    }, [run]),
    refreshing,
    reload: useCallback(() => {
      setLoading(true);
      void run(false);
    }, [run]),
    setData: useCallback((updater: (current: T | null) => T | null) => {
      setData((current) => updater(current));
    }, []),
  };
}
