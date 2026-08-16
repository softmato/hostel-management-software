import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ThemePreference = "dark" | "light" | "system";

export type UiState = {
  /** Set by the biometric gate in M8; ignored until then. */
  isUnlocked: boolean;
  themePreference: ThemePreference;
};

const initialState: UiState = {
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
    setThemePreference(state, action: PayloadAction<ThemePreference>) {
      state.themePreference = action.payload;
    },
    setUnlocked(state, action: PayloadAction<boolean>) {
      state.isUnlocked = action.payload;
    },
  },
});

export const { setThemePreference, setUnlocked } = uiSlice.actions;

export default uiSlice.reducer;
