import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Notifications the reader has been shown but not acknowledged.
 *
 * Opening the feed marks every row read on the server, so the bell's badge and
 * the app-icon count clear the moment somebody looks. What that must not do is
 * wipe the tint off the rows they have not actually read yet — so the ids that
 * were unread when the feed opened are held here, and the screen keeps drawing
 * them unread until the row is tapped or "Mark all read" is pressed.
 *
 * Persisted, so a relaunch does not silently un-tint a row nobody opened, and
 * wiped on logout with every other slice (`RESET_STORE`), so one account's held
 * rows never sit in the next account's app.
 */

/** Ids only, newest first; past this the oldest fall off rather than growing for ever. */
const MAX_HELD = 200;

export type NotificationsState = {
  unacknowledged: string[];
};

const initialState: NotificationsState = { unacknowledged: [] };

const notificationsSlice = createSlice({
  initialState,
  name: "notifications",
  reducers: {
    acknowledgeAllNotifications(state) {
      state.unacknowledged = [];
    },
    acknowledgeNotification(state, action: PayloadAction<string>) {
      state.unacknowledged = state.unacknowledged.filter((id) => id !== action.payload);
    },
    /**
     * Holds `unread`, and — when the whole feed page is passed as `present` —
     * lets go of ids no longer on it, so the "N unread" count never includes a
     * row that has been deleted or scrolled off the end of the mailbox.
     *
     * Only reassigns when something moved, so a revalidate that changed nothing
     * does not re-render every reader of this slice.
     */
    holdUnacknowledged(
      state,
      action: PayloadAction<{ present?: string[]; unread: string[] }>,
    ) {
      const { present, unread } = action.payload;
      const kept = present
        ? state.unacknowledged.filter((id) => present.includes(id))
        : state.unacknowledged;
      const fresh = unread.filter((id) => !kept.includes(id));

      if (fresh.length > 0 || kept.length !== state.unacknowledged.length) {
        state.unacknowledged = [...fresh, ...kept].slice(0, MAX_HELD);
      }
    },
  },
});

export const {
  acknowledgeAllNotifications,
  acknowledgeNotification,
  holdUnacknowledged,
} = notificationsSlice.actions;

export default notificationsSlice.reducer;
