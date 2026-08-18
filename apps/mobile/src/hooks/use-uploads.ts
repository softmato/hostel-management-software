import { useEffect, useSyncExternalStore } from "react";

import {
  getUploadRows,
  isUploadActive,
  subscribeToUploads,
  sweepUploads,
  type UploadRow,
} from "@/lib/upload-queue";

/**
 * The live upload list, for the global toaster.
 *
 * `useSyncExternalStore` rather than a context provider: the queue is written
 * from `lib/uploads.ts`, which is a plain module with no React in scope, and
 * threading a dispatch down to it would mean every call site passing something.
 */
export function useUploads(): readonly UploadRow[] {
  const rows = useSyncExternalStore(subscribeToUploads, getUploadRows, getUploadRows);

  /*
   * Finished rows expire on a clock, so something has to re-render when their
   * time is up — a store that only emits on upload events would leave the last
   * "Uploaded" row on screen forever. The interval runs only while there is
   * something to sweep, so an idle app has no timer at all.
   */
  const hasFinished = rows.some((row) => !isUploadActive(row.stage));

  useEffect(() => {
    if (!hasFinished) {
      return;
    }

    const timer = setInterval(() => sweepUploads(), 500);

    return () => clearInterval(timer);
  }, [hasFinished]);

  return rows;
}

/** Gate a submit button on any in-flight upload — the web's `useIsUploading`. */
export function useIsUploading(): boolean {
  return useUploads().some((row) => isUploadActive(row.stage));
}
