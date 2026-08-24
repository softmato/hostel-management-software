import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  View,
} from "react-native";
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
  /**
   * Drop the gutter between the header and the content, for a screen whose
   * first element is artwork that has to meet the bar with no seam — the admin
   * Home gradient, and nothing else so far.
   *
   * Two things normally sit above the content, and which of them this removes
   * depends on whether there is a `header`: the standard 8dp content gutter
   * always, and the bare `insets.top` spacer as well when there is no header.
   * Either one leaves a strip of page background above the artwork, which does
   * not read as spacing — it reads as a rendering fault.
   *
   * Without a `header`, the first element then owns the status-bar inset, which
   * means it also owns getting it right: `useSystemInsets`, not a guess. A
   * headerless `bleedTop` screen whose first element skips that puts its first
   * line of text under the clock.
   */
  bleedTop?: boolean;
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
  bleedTop = false,
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
      transform: [
        { translateY: progress * (FLOATING_CLEARANCE + insets.bottom) },
      ],
    };
  });

  /*
   * When a screen has both a sticky footer and tabs, the footer owns the tab
   * clearance because the tab bar floats over the footer. Otherwise the tab
   * bar, footer, or scroll content owns the bottom edge, in that order.
   *
   * The tab bar is absolutely positioned — it floats over the content so that
   * hiding it does not reflow the list behind it — which means the content has
   * to reserve the full bar height itself, inset included.
   */
  const tabClearance = insideTabs ? TAB_BAR_HEIGHT + insets.bottom : 0;
  const reservedBottom = footer
    ? MIN_BOTTOM_PAD
    : (insideTabs ? tabClearance : insets.bottom) + MIN_BOTTOM_PAD;

  // A floating action does not occupy layout, so the content has to leave room
  // for it on top of whatever the bottom edge already claimed.
  const contentBottomPad = reservedBottom + (floating ? FLOATING_CLEARANCE : 0);

  const paddingClass = padded ? "px-5" : "";
  const topPadClass = bleedTop ? "" : "pt-2";

  const body = scroll ? (
    <Animated.ScrollView
      className="flex-1"
      contentContainerClassName={`grow ${paddingClass} ${topPadClass} ${contentClassName}`}
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
      {header ?? (bleedTop ? null : <View style={{ height: insets.top }} />)}

      {/*
        The footer is **inside** this, and that is the whole point.

        It used to be a sibling below, which meant the keyboard covered the
        primary action on every form in the app — register, forgot-password,
        raise-a-complaint, edit ID card, payment claim, night
        status, leave a review, admin alerts and the hostel inquiry all put their
        submit button in `footer`. On iOS `behavior="padding"` padded the scroll
        body and left the footer exactly where it was, under the keyboard; on
        Android the window's `adjustPan` shoved the whole thing up and pushed the
        footer off the bottom edge. Either way the button was unreachable, with
        nothing on screen to say the keyboard had to be dismissed first.

        Android is `undefined` on purpose rather than `"padding"`:
        `softwareKeyboardLayoutMode` is now `"resize"` (app.json), so the window
        itself shrinks and the footer rides up with it. Adding padding on top of
        that would compensate twice and leave a keyboard-height gap.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        {body}

        {footer ? (
          <View
            className="border-t border-border bg-background px-5 pt-3"
            style={{
              paddingBottom: insideTabs
                ? tabClearance + MIN_BOTTOM_PAD
                : Math.max(insets.bottom, MIN_BOTTOM_PAD),
            }}
          >
            {footer}
          </View>
        ) : null}
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
    </View>
  );
}
