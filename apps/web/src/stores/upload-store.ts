import { create } from "zustand";

import type { UploadResult, UploadTarget } from "@/lib/uploads/transport";

/**
 * The single source of truth for "what is uploading right now".
 *
 * Every upload started anywhere on the site registers here, which is what lets
 * one always-mounted toaster render live progress without any page wiring it up.
 */

export type UploadStatus =
  | "canceled"
  | "error"
  | "processing"
  | "queued"
  | "success"
  | "uploading";

export type UploadItem = {
  /** Wall-clock ms when the transfer finished, succeeded or not. */
  endedAt?: number;
  error?: string;
  fileName: string;
  id: string;
  /** Caller-facing label, e.g. "Payment proof". Falls back to the file name. */
  label: string;
  loadedBytes: number;
  mimeType: string;
  percent: number;
  result?: UploadResult;
  /** Groups related uploads, e.g. all files in one registration step. */
  scope: string;
  sizeBytes: number;
  startedAt: number;
  status: UploadStatus;
};

/**
 * Non-serialisable per-upload handles. Kept outside the store so that holding
 * an AbortController never triggers a re-render and the store stays plain data.
 */
type UploadHandle = {
  controller: AbortController;
  file: File;
  retry?: () => void;
  target: UploadTarget;
};

const handles = new Map<string, UploadHandle>();

type UploadStore = {
  /** Drops finished rows (success/error/canceled), keeps anything in flight. */
  clearFinished: () => void;
  dismiss: (id: string) => void;
  items: UploadItem[];
  register: (item: UploadItem, handle: UploadHandle) => void;
  update: (id: string, patch: Partial<UploadItem>) => void;
};

export const useUploadStore = create<UploadStore>((set) => ({
  clearFinished: () => {
    set((state) => {
      const kept = state.items.filter((item) => isActive(item.status));

      for (const item of state.items) {
        if (!isActive(item.status)) {
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

export function isActive(status: UploadStatus) {
  return status === "queued" || status === "uploading" || status === "processing";
}

/** Aborts the in-flight request; the upload runner marks the row `canceled`. */
export function cancelUpload(id: string) {
  handles.get(id)?.controller.abort();
}

export function retryUpload(id: string) {
  const handle = handles.get(id);

  if (!handle?.retry) {
    return;
  }

  useUploadStore.getState().dismiss(id);
  handle.retry();
}

export function canRetryUpload(id: string) {
  return Boolean(handles.get(id)?.retry);
}

/**
 * Bytes/second averaged over the whole transfer, and the resulting ETA.
 * Averaged rather than instantaneous so the number in the toast stays readable
 * instead of flickering with every progress event.
 */
export function uploadRate(item: UploadItem) {
  const elapsedSeconds = ((item.endedAt ?? Date.now()) - item.startedAt) / 1000;

  if (elapsedSeconds < 0.35 || item.loadedBytes <= 0) {
    return { bytesPerSecond: 0, etaSeconds: null };
  }

  const bytesPerSecond = item.loadedBytes / elapsedSeconds;
  const remaining = Math.max(0, item.sizeBytes - item.loadedBytes);

  return {
    bytesPerSecond,
    etaSeconds: bytesPerSecond > 0 ? remaining / bytesPerSecond : null,
  };
}
