/**
 * Product identity in one place.
 *
 * PLACEHOLDER ASSETS: everything under `assets/images/` is a generated stand-in
 * (a green rounded-square "H"). When the real logo arrives, replace the PNGs
 * and nothing here or in any component needs to change — see
 * `assets/images/README.md`.
 */

export const APP_NAME = "HostelHub";

/** Shown under the mark on the splash screen. */
export const POWERED_BY = "Powered by Softmato";

export const logo = {
  /** Green mark, for light backgrounds. */
  mark: require("../../assets/images/logo-mark.png"),
  /** White mark, for the brand-green splash and dark surfaces. */
  markLight: require("../../assets/images/logo-mark-light.png"),
} as const;
