import { useColorScheme } from "nativewind";
import { useEffect } from "react";

import { type ColorScheme, palette } from "@/constants/theme";
import { useAppSelector } from "@/hooks/redux";

/**
 * Resolves the active scheme from the user's preference, falling back to the OS.
 *
 * Also pushes that choice into NativeWind, which is what makes the `dark:`
 * variants and the `.dark` CSS block agree with everything reading `colors`
 * here. Without the push, a user who picks "Dark" while the phone is in light
 * mode gets dark tokens in JS and light ones in className — half a theme.
 */
export function useAppTheme() {
  const preference = useAppSelector((state) => state.ui.themePreference);
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme(preference);
  }, [preference, setColorScheme]);

  const scheme: ColorScheme = colorScheme === "dark" ? "dark" : "light";

  return {
    colors: palette[scheme],
    isDark: scheme === "dark",
    scheme,
  };
}
