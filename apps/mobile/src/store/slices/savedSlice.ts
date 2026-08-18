import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { SavedHostel } from "@/lib/saved-hostels";

/**
 * Favourites — device-local, and deliberately so. See `lib/saved-hostels.ts` for
 * why there is no server behind this and why each entry is a snapshot rather
 * than an id.
 *
 * Persisted (whitelisted in `store/index.ts`) and therefore **wiped on logout**
 * along with every other slice, because `RESET_STORE` returns the whole tree to
 * its initial state. That is the right trade on a phone that gets handed between
 * a resident and a cook: what someone was shopping for is theirs, and the
 * alternative is one account's browsing history sitting in the next one's app.
 */

export type SavedState = {
  /** Newest first — the order the Favourites row renders in. */
  items: SavedHostel[];
};

const initialState: SavedState = { items: [] };

const savedSlice = createSlice({
  initialState,
  name: "saved",
  reducers: {
    /**
     * Replaces the list with fresher snapshots. Only ever dispatched with the
     * output of `refreshedSnapshots`, which returns `null` when nothing moved —
     * so this does not fire on every payload.
     */
    refreshSaved(state, action: PayloadAction<SavedHostel[]>) {
      state.items = action.payload;
    },
    toggleSaved(state, action: PayloadAction<SavedHostel>) {
      const index = state.items.findIndex((item) => item.id === action.payload.id);

      if (index >= 0) {
        state.items.splice(index, 1);

        return;
      }

      state.items.unshift(action.payload);
    },
    unsaveHostel(state, action: PayloadAction<string>) {
      state.items = state.items.filter((item) => item.id !== action.payload);
    },
  },
});

export const { refreshSaved, toggleSaved, unsaveHostel } = savedSlice.actions;

export default savedSlice.reducer;
