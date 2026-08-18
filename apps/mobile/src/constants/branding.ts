/**
 * Product identity in one place.
 *
 * PLACEHOLDER ASSETS: everything under `assets/images/` is a generated stand-in
 * (a green rounded-square "H"). When the real logo arrives, replace the PNGs
 * and nothing here or in any component needs to change — see
 * `assets/images/README.md`.
 */

export const APP_NAME = "HostelHub";

/**
 * The wordmark, split so the home header can draw the tail in brand green — the
 * two-tone lockup the discovery mockup uses. Kept beside `APP_NAME` rather than
 * sliced out of it at the call site: a rename that changes where the halves fall
 * should be one edit here, not a `slice(0, 6)` somewhere in a component.
 */
export const APP_NAME_PARTS = { head: "Hostel", tail: "Hub" } as const;

/** Shown under the mark on the splash screen. */
export const POWERED_BY = "Powered by Softmato";

export const logo = {
  /** Green mark, for light backgrounds. */
  mark: require("../../assets/images/logo-mark.png"),
  /** White mark, for the brand-green splash and dark surfaces. */
  markLight: require("../../assets/images/logo-mark-light.png"),
} as const;
