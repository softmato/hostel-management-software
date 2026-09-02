import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ThemePreference = "dark" | "light" | "system";

/**
 * Which calendar the hostel portal writes its dates in.
 *
 * `"AD"` is Gregorian — `18 Aug 2026`. `"BS"` is Bikram Sambat — `2 Bhadra
 * 2083`. It is a **display** preference and nothing else: every date still
 * crosses the wire as an ISO instant, and every period is still the server's
 * `2026-08`. Nothing here changes what is stored, only what is read.
 */
export type CalendarPreference = "AD" | "BS";

export type UiState = {
  calendarPreference: CalendarPreference;
  /** Set by the biometric gate in M8; ignored until then. */
  isUnlocked: boolean;
  themePreference: ThemePreference;
};

const initialState: UiState = {
  /*
   * Gregorian by default, and not because it is the better calendar.
   *
   * Every screen in the app printed AD alone (or AD beside BS) before this
   * setting existed, so AD is what a phone already updated shows on the day it
   * updates. Defaulting to BS would silently reformat every date a hostel has
   * been reading for months, on an upgrade nobody asked for. The owner who
   * keeps their books in Bikram Sambat turns it on once, in Settings, and it
   * sticks — see `hooks/use-dates.ts` for how the choice reaches the screens.
   */
  calendarPreference: "AD",
  isUnlocked: true,
  /*
   * Light by default, deliberately — not "system".
   *
   * Following the OS would hand a dark app to anyone whose phone is in dark
   * mode, and the product's identity is the white-and-green surface the website
   * uses. Dark is a setting people opt into, so the two audiences that matter
   * (a first-time resident, and a hostel owner comparing the app to the site)
   * both see the same thing.
   */
  themePreference: "light",
};

const uiSlice = createSlice({
  initialState,
  name: "ui",
  reducers: {
    setCalendarPreference(state, action: PayloadAction<CalendarPreference>) {
      state.calendarPreference = action.payload;
    },
    setThemePreference(state, action: PayloadAction<ThemePreference>) {
      state.themePreference = action.payload;
    },
    setUnlocked(state, action: PayloadAction<boolean>) {
      state.isUnlocked = action.payload;
    },
  },
});

export const { setCalendarPreference, setThemePreference, setUnlocked } =
  uiSlice.actions;

export default uiSlice.reducer;
