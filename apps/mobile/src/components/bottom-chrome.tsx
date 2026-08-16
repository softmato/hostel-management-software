import { createContext, type ReactNode, useContext } from "react";
import {
  Easing,
  type SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * Shared hide-on-scroll state for everything that sits at the bottom of a
 * screen — the role tab bar and floating actions alike.
 *
 * It lives at the app root rather than inside the tab navigator because the two
 * consumers are not always siblings: the signed-out home is a plain stack with
 * a floating Log in pill and no tabs at all, and it should feel identical when
 * you scroll. One shared value, one set of thresholds, one animation curve.
 *
 * ## Thresholds
 *
 * Asymmetric on purpose. Hiding takes a deliberate downward push, so a jittery
 * thumb or the rubber-band at the end of a list does not make the chrome
 * flicker. Showing takes barely a nudge — the moment someone scrolls back up
 * they are looking for a way out of the screen, and making them scroll further
 * to get navigation back feels broken.
 */

const HIDE_AFTER = 16;
const SHOW_AFTER = 6;

/** Below this offset the chrome always shows; near the top there is nothing to reclaim. */
const ALWAYS_SHOWN_BELOW = 48;

export const CHROME_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

type BottomChrome = {
  /**
   * Scroll logic, for `<Screen scroll>`. A worklet, so it runs on the UI
   * thread — a JS-thread handler drops frames exactly when a list is rendering
   * rows, which is exactly when someone is scrolling.
   */
  onScroll: (offsetY: number) => void;
  /** 0 = fully shown, 1 = fully tucked away. Animated on the UI thread. */
  progress: SharedValue<number>;
  /** Bring the chrome back and forget any accumulated intent. */
  reset: () => void;
};

const BottomChromeContext = createContext<BottomChrome | null>(null);

/**
 * Owns the visibility state and the scroll logic that changes it.
 *
 * The two live together deliberately. Reanimated shared values are mutable by
 * design, but the React Compiler's immutability rule cannot tell a
 * `SharedValue` from an ordinary object — so writing to one that arrived as a
 * prop, a hook argument or a dependency-array entry is a lint error. Creating
 * and mutating it in the same component keeps that ownership legible to the
 * compiler and to a reader.
 */
export function BottomChromeProvider({ children }: { children: ReactNode }) {
  const progress = useSharedValue(0);
  const lastOffset = useSharedValue(0);
  const accumulated = useSharedValue(0);
  const hidden = useSharedValue(0);

  /*
   * Plain functions, not `useCallback`. The React Compiler is on
   * (`experiments.reactCompiler`), so it memoises these and the context value
   * below — and passing a shared value through a dependency array is exactly
   * what its immutability rule objects to.
   */
  function onScroll(offsetY: number) {
    "worklet";

    const delta = offsetY - lastOffset.value;
    lastOffset.value = offsetY;

    if (offsetY <= ALWAYS_SHOWN_BELOW) {
      accumulated.value = 0;

      if (hidden.value === 1) {
        hidden.value = 0;
        progress.value = withTiming(0, CHROME_TIMING);
      }

      return;
    }

    // Direction change: start counting again from here, so the thresholds
    // measure intent rather than raw offset.
    if ((delta > 0 && accumulated.value < 0) || (delta < 0 && accumulated.value > 0)) {
      accumulated.value = 0;
    }

    accumulated.value += delta;

    /*
     * `hidden` guards the animation. Without it every scroll frame would
     * restart `withTiming` from wherever it had reached, and the chrome would
     * crawl instead of sliding.
     */
    if (accumulated.value > HIDE_AFTER && hidden.value === 0) {
      hidden.value = 1;
      accumulated.value = 0;
      progress.value = withTiming(1, CHROME_TIMING);
    } else if (accumulated.value < -SHOW_AFTER && hidden.value === 1) {
      hidden.value = 0;
      accumulated.value = 0;
      progress.value = withTiming(0, CHROME_TIMING);
    }
  }

  /*
   * Called when a screen takes focus. The state is shared across the whole app,
   * so without this you could scroll a list until the bar hid, switch tabs, and
   * arrive on a screen scrolled to the top with no navigation showing and no
   * obvious way to get it back.
   */
  function reset() {
    lastOffset.value = 0;
    accumulated.value = 0;
    hidden.value = 0;
    progress.value = withTiming(0, CHROME_TIMING);
  }

  const value = { onScroll, progress, reset };

  return (
    <BottomChromeContext.Provider value={value}>{children}</BottomChromeContext.Provider>
  );
}

export function useBottomChrome() {
  return useContext(BottomChromeContext);
}
