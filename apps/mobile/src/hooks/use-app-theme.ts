import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { useColorScheme as useDeviceColorScheme } from "react-native";

import { type ColorScheme, palette } from "@/constants/theme";
import { useAppSelector } from "@/hooks/redux";

/**
 * Resolves the active scheme from the user's preference, falling back to the OS.
 *
 * Also pushes that choice into NativeWind, which is what makes the `dark:`
 * variants and the `.dark` CSS block agree with everything reading `colors`
 * here. Without the push, a user who picks "Dark" while the phone is in light
 * mode gets dark tokens in JS and light ones in className — half a theme.
 *
 * The push is always a concrete "light" or "dark", never "system". NativeWind's
 * class strategy expresses dark as a class on the document, and "system" clears
 * that class instead of following the OS, so passing it through would leave an
 * OS-dark browser rendering light CSS under a dark JS palette. Resolving the
 * preference here keeps both sides reading the same value.
 */
export function useAppTheme() {
  const preference = useAppSelector((state) => state.ui.themePreference);
  const deviceScheme = useDeviceColorScheme();
  const { colorScheme, setColorScheme } = useColorScheme();

  const resolved: ColorScheme =
    preference === "system"
      ? deviceScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  useEffect(() => {
    if (colorScheme !== resolved) {
      setColorScheme(resolved);
    }
  }, [colorScheme, resolved, setColorScheme]);

  const scheme: ColorScheme = colorScheme === "dark" ? "dark" : "light";

  return {
    colors: palette[scheme],
    isDark: scheme === "dark",
    scheme,
  };
}
