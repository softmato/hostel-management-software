import { create } from "zustand";

/**
 * The single source of truth for "what is downloading right now".
 *
 * The mirror image of `stores/upload-store.ts`, and deliberately its own store
 * rather than a `direction` field on that one. The two look identical in the
 * toaster and share almost nothing underneath: an upload starts from a `File`
 * the browser already holds, is presigned, and ends in an `UploadResult`; a
 * download starts from a URL, may never learn its own size, and ends in a blob
 * handed to the browser's download manager. Merging them would mean an item
 * type where half the fields are optional and every reader has to ask which
 * kind it is holding.
 *
 * What *is* shared is the surface: every download started anywhere on the site
 * registers here, so the always-mounted toaster renders live progress without
 * the page wiring anything up. Call sites never touch fetch or progress
 * plumbing — see `lib/downloads/downloader.ts`.
 */

export type DownloadStatus = "canceled" | "downloading" | "error" | "saving" | "success";

export type DownloadItem = {
  /** Wall-clock ms when the transfer finished, however it finished. */
  endedAt?: number;
  error?: string;
  /** The name the file is saved under, extension included. */
  fileName: string;
  id: string;
  /** Caller-facing label, e.g. "Collection report". Falls back to the file name. */
  label: string;
  loadedBytes: number;
  mimeType: string;
  /**
   * 0–100, or `null` when the server sent no `Content-Length`.
   *
   * Not zero: a streamed CSV export genuinely has no declared length, and a bar
   * pinned at empty while bytes are visibly arriving is what makes people click
   * the button again. `null` is what the toaster draws as indeterminate.
   */
  percent: number | null;
  /** Groups related downloads, e.g. every export on one reports page. */
  scope: string;
  /** `0` until `Content-Length` says otherwise. */
  sizeBytes: number;
  startedAt: number;
  status: DownloadStatus;
};

/**
 * Non-serialisable per-download handles, kept outside the store so that holding
 * an AbortController never triggers a re-render and the store stays plain data.
 * Same split `upload-store.ts` makes, for the same reason.
 */
type DownloadHandle = {
  controller: AbortController;
  retry?: () => void;
};

const handles = new Map<string, DownloadHandle>();

type DownloadStore = {
  /** Drops finished rows, keeps anything in flight. */
  clearFinished: () => void;
  dismiss: (id: string) => void;
  items: DownloadItem[];
  register: (item: DownloadItem, handle: DownloadHandle) => void;
  update: (id: string, patch: Partial<DownloadItem>) => void;
};

export const useDownloadStore = create<DownloadStore>((set) => ({
  clearFinished: () => {
    set((state) => {
      const kept = state.items.filter((item) => isDownloadActive(item.status));

      for (const item of state.items) {
        if (!isDownloadActive(item.status)) {
          handles.delete(item.id);
        }
      }

      return { items: kept };
    });
  },
  dismiss: (id) => {
    handles.delete(id);
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
  items: [],
  register: (item, handle) => {
    handles.set(item.id, handle);
    set((state) => ({ items: [...state.items, item] }));
  },
  update: (id, patch) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
}));

export function isDownloadActive(status: DownloadStatus) {
  return status === "downloading" || status === "saving";
}

/** Aborts the in-flight request; the runner marks the row `canceled`. */
export function cancelDownload(id: string) {
  handles.get(id)?.controller.abort();
}

export function retryDownload(id: string) {
  const handle = handles.get(id);

  if (!handle?.retry) {
    return;
  }

  useDownloadStore.getState().dismiss(id);
  handle.retry();
}

export function canRetryDownload(id: string) {
  return Boolean(handles.get(id)?.retry);
}

/**
 * Bytes/second averaged over the whole transfer, and the resulting ETA.
 *
 * Averaged rather than instantaneous so the number in the toast stays readable
 * instead of flickering with every chunk. `etaSeconds` is `null` whenever the
 * total is unknown — an ETA computed against a size the server never sent would
 * be a confident countdown to nothing.
 */
export function downloadRate(item: DownloadItem) {
  const elapsedSeconds = ((item.endedAt ?? Date.now()) - item.startedAt) / 1000;

  if (elapsedSeconds < 0.35 || item.loadedBytes <= 0) {
    return { bytesPerSecond: 0, etaSeconds: null };
  }

  const bytesPerSecond = item.loadedBytes / elapsedSeconds;

  if (item.sizeBytes <= 0) {
    return { bytesPerSecond, etaSeconds: null };
  }

  const remaining = Math.max(0, item.sizeBytes - item.loadedBytes);

  return {
    bytesPerSecond,
    etaSeconds: bytesPerSecond > 0 ? remaining / bytesPerSecond : null,
  };
}
