import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Ids only, newest first; past this the oldest fall off. */
const MAX_HELD = 200;

type NotificationHoldStore = {
  acknowledge: (id: string) => void;
  acknowledgeAll: () => void;
  /**
   * Holds `unread`. With `present` (the whole feed page) it also lets go of ids
   * no longer on it, so a deleted row never keeps the unread count up.
   */
  hold: (unread: string[], present?: string[]) => void;
  ids: string[];
};

/**
 * Notifications the reader has been shown but not acknowledged.
 *
 * Opening the bell marks every row read on the server, so the badge clears the
 * moment somebody looks. The rows that were unread at that moment are held here
 * and stay tinted until they are clicked or "Mark all read" is pressed.
 *
 * Persisted so a reload does not silently un-tint a row nobody opened. Only ids
 * are stored, and ids are unique across accounts, so another account's leftovers
 * on a shared browser match nothing.
 */
export const useNotificationHoldStore = create<NotificationHoldStore>()(
  persist(
    (set, get) => ({
      acknowledge: (id) => {
        const { ids } = get();

        if (ids.includes(id)) {
          set({ ids: ids.filter((value) => value !== id) });
        }
      },
      acknowledgeAll: () => {
        if (get().ids.length > 0) {
          set({ ids: [] });
        }
      },
      hold: (unread, present) => {
        const { ids } = get();
        const kept = present ? ids.filter((id) => present.includes(id)) : ids;
        const fresh = unread.filter((id) => !kept.includes(id));

        if (fresh.length > 0 || kept.length !== ids.length) {
          set({ ids: [...fresh, ...kept].slice(0, MAX_HELD) });
        }
      },
      ids: [],
    }),
    { name: "hostelhub-notification-hold", partialize: (state) => ({ ids: state.ids }) },
  ),
);
