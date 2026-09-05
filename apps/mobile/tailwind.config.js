/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  /*
   * Class, not media.
   *
   * The app owns the theme: `useAppTheme` pushes the user's stored preference
   * into NativeWind on every render. NativeWind refuses that push while dark
   * mode is `media` ("Unable to manually set color scheme without using
   * darkMode: class"), which on web threw out of the effect and took the whole
   * tree down with it. Class also means the browser stops deciding: with
   * `media`, an OS-dark phone got the dark `:root` variables even when the user
   * had chosen Light, so the JS palette and the CSS one disagreed.
   */
  darkMode: "class",
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          soft: "var(--destructive-soft)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        surface: {
          DEFAULT: "var(--surface)",
          strong: "var(--surface-strong)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        info: {
          DEFAULT: "var(--info)",
          soft: "var(--info-soft)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          soft: "var(--brand-soft)",
        },
        role: {
          platform: "var(--role-platform)",
          "platform-soft": "var(--role-platform-soft)",
          admin: "var(--role-admin)",
          "admin-soft": "var(--role-admin-soft)",
          resident: "var(--role-resident)",
          "resident-soft": "var(--role-resident-soft)",
          guardian: "var(--role-guardian)",
          "guardian-soft": "var(--role-guardian-soft)",
          cook: "var(--role-cook)",
          "cook-soft": "var(--role-cook-soft)",
          provider: "var(--role-provider)",
          "provider-soft": "var(--role-provider-soft)",
        },
      },
      borderRadius: {
        DEFAULT: "10px",
        card: "16px",
        sheet: "24px",
      },
    },
  },
  plugins: [],
};
