import { Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Safe-area insets, with an Android floor under the top one.
 *
 * `useSafeAreaInsets` reports 0 for the top whenever the window is not drawing
 * under the status bar — during the first frames after launch, and for as long
 * as a host activity we do not control (Expo Go's) keeps an opaque bar. A 0
 * there puts the screen title directly under the clock.
 *
 * `StatusBar.currentHeight` is a plain Android constant that is right either
 * way, so taking the larger of the two is correct in both states: it matches
 * the real inset once edge-to-edge settles, and stands in for it until then.
 *
 * iOS has no equivalent constant and no equivalent problem — the notch inset is
 * available from the first layout — so it is left alone.
 */
export function useSystemInsets() {
  const insets = useSafeAreaInsets();

  const top =
    Platform.OS === "android"
      ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
      : insets.top;

  return { ...insets, top };
}
