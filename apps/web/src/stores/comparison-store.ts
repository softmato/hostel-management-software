import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Max hostels comparable side-by-side (PHASES.md §2 — "up to 3 hostels"). */
export const MAX_COMPARE = 3;

type ComparisonStore = {
  clear: () => void;
  has: (id: string) => boolean;
  ids: string[];
  remove: (id: string) => void;
  toggle: (id: string) => boolean;
};

/**
 * The public comparison tray. Persisted to localStorage so a selection survives
 * navigation from the listing page to /compare.
 */
export const useComparisonStore = create<ComparisonStore>()(
  persist(
    (set, get) => ({
      clear: () => set({ ids: [] }),
      has: (id) => get().ids.includes(id),
      ids: [],
      remove: (id) => set({ ids: get().ids.filter((value) => value !== id) }),
      toggle: (id) => {
        const { ids } = get();
        if (ids.includes(id)) {
          set({ ids: ids.filter((value) => value !== id) });
          return true;
        }
        if (ids.length >= MAX_COMPARE) {
          return false;
        }
        set({ ids: [...ids, id] });
        return true;
      },
    }),
    { name: "hostelpalika-compare-tray" },
  ),
);
