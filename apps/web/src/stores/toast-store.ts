import { create } from "zustand";

/**
 * Minimal global toaster.
 *
 * Deliberately hand-rolled rather than pulled from a library: the primary
 * consumer is the universal uploader, whose notifications are long-lived rows
 * with a live progress bar, a cancel button and a retry button — not the
 * fire-and-forget strings a toast library optimises for. Generic one-shot
 * toasts ride along in the same viewport so the whole app has one place where
 * transient feedback appears.
 */

export type ToastTone = "error" | "info" | "success" | "warning";

export type ToastItem = {
  createdAt: number;
  description?: string;
  /** ms before auto-dismiss. `0` pins the toast until dismissed. */
  duration: number;
  id: string;
  title: string;
  tone: ToastTone;
};

type ToastStore = {
  dismiss: (id: string) => void;
  push: (toast: ToastItem) => void;
  toasts: ToastItem[];
  update: (id: string, patch: Partial<Omit<ToastItem, "id">>) => void;
};

const MAX_VISIBLE = 4;

export const useToastStore = create<ToastStore>((set) => ({
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
  push: (toast) =>
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE) })),
  toasts: [],
  update: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })),
}));

type ToastInput = string | { description?: string; duration?: number; title: string };

function show(tone: ToastTone, input: ToastInput, fallbackDuration: number) {
  const normalized = typeof input === "string" ? { title: input } : input;
  const id = crypto.randomUUID();

  useToastStore.getState().push({
    createdAt: Date.now(),
    description: normalized.description,
    duration: normalized.duration ?? fallbackDuration,
    id,
    title: normalized.title,
    tone,
  });

  return id;
}

/**
 * `toast.success("Saved")` from anywhere in the client bundle — no context or
 * hook required, since the store lives outside React.
 */
export const toast = {
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  error: (input: ToastInput) => show("error", input, 7000),
  info: (input: ToastInput) => show("info", input, 4500),
  success: (input: ToastInput) => show("success", input, 4000),
  warning: (input: ToastInput) => show("warning", input, 6000),
};
