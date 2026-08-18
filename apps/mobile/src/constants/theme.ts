/**
 * The same tokens as `src/global.css`, as JS values.
 *
 * NativeWind resolves `var(--x)` for anything styled with `className`, but a
 * handful of consumers cannot use className at all — the status bar, native
 * navigator options, the splash background, `expo-notifications` channel
 * colours, gradient stop arrays. Those read from here.
 *
 * Keep the two files in step. If a colour exists in only one of them, it is a
 * bug waiting for dark mode.
 */

export const palette = {
  light: {
    background: "#ffffff",
    foreground: "#1c1917",
    card: "#ffffff",
    cardForeground: "#1c1917",
    primary: "#0a8a4b",
    primaryForeground: "#ffffff",
    secondary: "#f4f4f5",
    muted: "#f5f5f4",
    mutedForeground: "#78716c",
    destructive: "#dc2626",
    border: "#e7e5e4",
    surface: "#fffaf4",
    warning: "#d97706",
    success: "#16a34a",
    brand: "#0a8a4b",
    brandSoft: "#e6f4ec",
  },
  dark: {
    background: "#0c0a09",
    foreground: "#fafaf9",
    card: "#1c1917",
    cardForeground: "#fafaf9",
    primary: "#12a95d",
    primaryForeground: "#04140c",
    secondary: "#27272a",
    muted: "#292524",
    mutedForeground: "#a8a29e",
    destructive: "#ef4444",
    border: "#292524",
    surface: "#1c1917",
    warning: "#f59e0b",
    success: "#22c55e",
    brand: "#12a95d",
    brandSoft: "#07301f",
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type ThemeColors = (typeof palette)[ColorScheme];

/**
 * Portal chrome, one per audience. The accent picks out *which product* you are
 * in at a glance — a cook and a resident should never wonder whose screen this
 * is. Mirrors `--role-*` in global.css and docs/DESIGN.md.
 */
export const roleAccent = {
  ADMIN: { light: "#0891b2", dark: "#22d3ee", soft: "role-admin-soft", token: "role-admin" },
  COOK: { light: "#ea580c", dark: "#fb923c", soft: "role-cook-soft", token: "role-cook" },
  GUARDIAN: {
    light: "#d97706",
    dark: "#f59e0b",
    soft: "role-guardian-soft",
    token: "role-guardian",
  },
  PLATFORM: {
    light: "#0d9488",
    dark: "#2dd4bf",
    soft: "role-platform-soft",
    token: "role-platform",
  },
  PROVIDER: {
    light: "#7c3aed",
    dark: "#a78bfa",
    soft: "role-provider-soft",
    token: "role-provider",
  },
  PUBLIC: { light: "#0a8a4b", dark: "#12a95d", soft: "brand-soft", token: "brand" },
  RESIDENT: {
    light: "#16a34a",
    dark: "#22c55e",
    soft: "role-resident-soft",
    token: "role-resident",
  },
} as const;

export type RoleAccentKey = keyof typeof roleAccent;

/** Splash background, duplicated in app.json — Expo reads that one before JS boots. */
export const SPLASH_BACKGROUND = { dark: "#0c0a09", light: "#ffffff" } as const;

export const radius = { card: 16, control: 10, sheet: 24 } as const;

export const spacing = { lg: 24, md: 16, sm: 8, xl: 32, xs: 4, xxl: 48 } as const;
