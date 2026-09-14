import { useCallback, useEffect, useRef } from "react";

import { toastSuccess } from "@/lib/toast";

/**
 * Writes `snapshot` to the phone one second after the last change.
 *
 * The first snapshot is the form as it opened, and nothing is written until
 * something differs from it — opening and leaving is not a draft. Call the
 * returned function once the server accepts the form, so a timer from the last
 * keystroke cannot re-write a draft that was just cleared.
 *
 * `save` must be stable (a `useCallback`), or every render restarts the timer.
 */
export function useDraftAutosave<T>(
  snapshot: T,
  restored: boolean,
  save: (snapshot: T) => unknown,
): () => void {
  const opened = useRef(JSON.stringify(snapshot));
  const saved = useRef(false);

  useEffect(() => {
    if (JSON.stringify(snapshot) === opened.current) {
      return;
    }

    const timer = setTimeout(() => {
      if (!saved.current) {
        void save(snapshot);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [save, snapshot]);

  useEffect(() => {
    if (restored) {
      toastSuccess("Picked up where you left off");
    }
    // Once, for the draft the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useCallback(() => {
    saved.current = true;
  }, []);
}
