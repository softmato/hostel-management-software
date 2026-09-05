import { describe, expect, it } from "vitest";

import { migrations, PERSIST_VERSION } from "@/store/index";
import uiReducer from "@/store/slices/uiSlice";

/**
 * The Nepali calendar is the default, and it reaches phones that already have
 * the app.
 *
 * Two halves that are easy to change independently and useless apart. Flipping
 * `initialState` alone ships the new default to fresh installs only, because
 * redux-persist writes the stored value straight over it on rehydration — which
 * looks perfect on a simulator and does nothing on the handset you have been
 * testing with all week. Writing the migration alone leaves new installs on the
 * old default. So both are pinned here, together.
 */
describe("dates default to Bikram Sambat", () => {
  it("starts a fresh install in BS", () => {
    const state = uiReducer(undefined, { type: "@@INIT" });

    expect(state.calendarPreference).toBe("BS");
  });

  it("moves an existing install off the old Gregorian default", () => {
    const migrated = migrations[3]({
      ui: { calendarPreference: "AD", themePreference: "dark" },
    }) as { ui: { calendarPreference: string; themePreference: string } };

    expect(migrated.ui.calendarPreference).toBe("BS");
    // Only the calendar moves. A migration that rebuilt `ui` from scratch would
    // silently reset the theme somebody chose.
    expect(migrated.ui.themePreference).toBe("dark");
  });

  it("runs that migration — the persist version reaches it", () => {
    // `createMigrate` runs every entry up to `PERSIST_VERSION` and no further.
    // Adding a migration without bumping the version is a no-op that reads like
    // a fix.
    expect(PERSIST_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("survives a store with nothing persisted yet", () => {
    expect(migrations[3](undefined)).toBeUndefined();
  });
});
