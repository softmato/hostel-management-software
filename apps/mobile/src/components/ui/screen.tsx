import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback } from "react";
import { KeyboardAvoidingView, Platform, RefreshControl, View } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
} from "react-native-reanimated";

import { useBottomChrome } from "@/components/bottom-chrome";
import { TAB_BAR_HEIGHT } from "@/components/tab-bar";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";

/**
 * The outermost element of every screen, and the single place system-bar insets
 * are handled.
 *
 * ## Why this is not `<SafeAreaView edges={[...]}>`
 *
 * Android has been edge-to-edge since RN 0.86 with no opt-out, so the app always
 * draws behind the status bar and the navigation bar. `SafeAreaView` solves that
 * by insetting the whole view, which leaves an unpainted strip at the top and
 * stops a colour running to the screen edge. What we want instead is for the
 * chrome to *extend* under the system bars while the **content** stays clear of
 * them. So insets are applied as padding, per region, by this component.
 *
 * ## The bottom edge is the one that actually breaks
 *
 * With gesture navigation `insets.bottom` is a ~20dp hint bar and almost
 * anything looks fine. Switch the phone to **three-button navigation** and it
 * jumps to ~48dp of opaque buttons sitting directly on top of whatever the app
 * drew there — a submit button that cannot be pressed, a last list row that
 * cannot be read. Every screen therefore reserves `insets.bottom`, either on the
 * scroll content, the sticky footer, or the tab bar, and no screen opts out.
 *
 * `MIN_BOTTOM_PAD` keeps a little breathing room on devices that report `0`,
 * so content never sits flush against the physical edge.
 */

const MIN_BOTTOM_PAD = 16;

/**
 * Room reserved under the content for a floating action: the pill's height plus
 * the gap above and below it. Without this the last card sits behind the button
 * at the end of a scroll and cannot be read.
 */
const FLOATING_CLEARANCE = 56 + 20;

type ScreenProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * A floating action that hovers over the content — see `<FloatingButton>`.
   * Unlike `footer` it does not occupy layout, so the page scrolls underneath
   * it; the content reserves room for it via `FLOATING_CLEARANCE`.
   */
  floating?: ReactNode;
  /** Sticky bottom region — a CTA or a summary bar. Gets the bottom inset. */
  footer?: ReactNode;
  /** Usually an `<AppBar />`. It paints its own status-bar padding. */
  header?: ReactNode;
  /**
   * Set when this screen sits inside a `<Tabs>` navigator. Reserves the tab
   * bar's height and connects scrolling to its hide/show animation.
   */
  insideTabs?: boolean;
  onRefresh?: () => void;
  /** Horizontal padding on the content. Off for full-bleed lists. */
  padded?: boolean;
  refreshing?: boolean;
  scroll?: boolean;
};

export function Screen({
  children,
  className = "",
  contentClassName = "",
  floating,
  footer,
  header,
  insideTabs = false,
  onRefresh,
  padded = true,
  refreshing = false,
  scroll = false,
}: ScreenProps) {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();
  const chrome = useBottomChrome();

  /*
   * Drives the tab bar *and* any floating action. Both hide on a deliberate
   * scroll down and come back on a small scroll up, from the same shared value,
   * so the signed-out home with its Log in pill behaves exactly like a tabbed
   * screen.
   */
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      chrome?.onScroll(event.contentOffset.y);
    },
  });

  const reset = chrome?.reset;

  useFocusEffect(
    useCallback(() => {
      // The state is shared app-wide, so a screen left scrolled-and-hidden
      // would otherwise hand the next screen a missing tab bar it has no way
      // to scroll back into view.
      reset?.();
    }, [reset]),
  );

  const floatingStyle = useAnimatedStyle(() => {
    const progress = chrome?.progress.value ?? 0;

    return {
      opacity: 1 - progress,
      // Far enough to clear the screen edge entirely, shadow included.
      transform: [{ translateY: progress * (FLOATING_CLEARANCE + insets.bottom) }],
    };
  });

  /*
   * Who owns the bottom inset, in priority order: the tab bar, then a sticky
   * footer, then the scroll content. Exactly one of them, or the gap doubles.
   *
   * The tab bar is absolutely positioned — it floats over the content so that
   * hiding it does not reflow the list behind it — which means the content has
   * to reserve the full bar height itself, inset included.
   */
  const reservedBottom = insideTabs
    ? TAB_BAR_HEIGHT + insets.bottom + MIN_BOTTOM_PAD
    : footer
      ? MIN_BOTTOM_PAD
      : insets.bottom + MIN_BOTTOM_PAD;

  // A floating action does not occupy layout, so the content has to leave room
  // for it on top of whatever the bottom edge already claimed.
  const contentBottomPad = reservedBottom + (floating ? FLOATING_CLEARANCE : 0);

  const paddingClass = padded ? "px-5" : "";

  const body = scroll ? (
    <Animated.ScrollView
      className="flex-1"
      contentContainerClassName={`grow ${paddingClass} pt-2 ${contentClassName}`}
      contentContainerStyle={{ paddingBottom: contentBottomPad }}
      keyboardShouldPersistTaps="handled"
      onScroll={scrollHandler}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        ) : undefined
      }
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </Animated.ScrollView>
  ) : (
    <View
      className={`flex-1 ${paddingClass} ${contentClassName}`}
      style={{ paddingBottom: contentBottomPad }}
    >
      {children}
    </View>
  );

  return (
    <View className={`flex-1 bg-background ${className}`}>
      {/*
        With no AppBar there is nothing to paint the status-bar strip, so the
        screen reserves it itself — otherwise the first line of content renders
        under the clock.
      */}
      {header ?? <View style={{ height: insets.top }} />}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        {body}
      </KeyboardAvoidingView>

      {floating ? (
        <Animated.View
          /*
           * A wider gutter than the content's `px-5`. The pill is deliberately
           * inset from the cards behind it — matching their width would read as
           * another row in the page rather than as something floating above it,
           * and the shadow would have no ground to fall on.
           */
          className="absolute inset-x-0 items-center px-14"
          pointerEvents="box-none"
          style={[
            {
              bottom:
                (insideTabs ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom) +
                MIN_BOTTOM_PAD,
            },
            floatingStyle,
          ]}
        >
          {floating}
        </Animated.View>
      ) : null}

      {footer ? (
        <View
          className="border-t border-border bg-background px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, MIN_BOTTOM_PAD) }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
