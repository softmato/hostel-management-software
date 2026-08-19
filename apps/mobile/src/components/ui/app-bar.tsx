import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";

type AppBarProps = {
  /** Right-hand slot: a bell, a filter, an avatar. */
  actions?: ReactNode;
  /** Paint the bar in the brand/role colour instead of the page background. */
  accent?: boolean;
  /**
   * Centre the title between fixed-width side slots, instead of letting it start
   * at the left edge.
   *
   * For a bar with **at most one control per side** — the layout it is built for
   * is back-arrow, name, share. The side slots are a fixed `SIDE_SLOT` wide
   * precisely so the two of them cancel out and the title lands on the optical
   * centre of the screen; that only holds if neither side needs more room than
   * one icon. A second action would not clip — the slot is `items-end`, so it
   * would overflow left, under the title. Leave `centerTitle` off in that case
   * and let the default left-aligned bar do its job.
   */
  centerTitle?: boolean;
  onBack?: () => void;
  showBack?: boolean;
  subtitle?: string;
  title: string;
};

/**
 * Width of each side slot under `centerTitle`.
 *
 * 40dp: a 26dp `chevron-back` plus enough margin that the 12dp `hitSlop` around
 * it does not reach into the title. Both sides get it whether or not they hold
 * anything, because a title centred against an empty right-hand slot is not
 * centred — it is 20dp left of centre, which is the amount that reads as a
 * mistake rather than as a choice.
 */
const SIDE_SLOT = 40;

/**
 * The top bar, and the only thing allowed to touch the status bar.
 *
 * Android is edge-to-edge from RN 0.86 onwards — there is no opt-out — so the
 * app paints underneath the clock and battery whether it wants to or not. The
 * fix is not to push everything down and leave a grey strip; it is for this bar
 * to *extend* into that area and pad its own content clear of it. The colour
 * runs to the very top of the screen, and the title sits below the clock.
 *
 * `insets.top` is the status bar on Android and the notch/dynamic-island cutout
 * on iOS, so one rule covers both.
 */
export function AppBar({
  actions,
  accent = false,
  centerTitle = false,
  onBack,
  showBack = false,
  subtitle,
  title,
}: AppBarProps) {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();

  const titleTone = accent ? "text-primary-foreground" : "text-foreground";
  const subtitleTone = accent ? "text-primary-foreground/75" : "text-muted-foreground";

  /*
   * An explicit colour, not a `bg-*` class.
   *
   * This strip is the one surface with nothing behind it but the window itself,
   * so if the class fails to resolve — a stale NativeWind cache, a CSS rebuild
   * that has not happened yet — it falls through to the window background and
   * renders as a black bar under the clock while the rest of the app is white.
   * A resolved value from the palette cannot fail that way.
   */
  const background = accent ? colors.primary : colors.background;

  const back = showBack ? (
    <Pressable
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onBack ?? (() => router.back())}
    >
      <Ionicons
        color={accent ? colors.primaryForeground : colors.foreground}
        name="chevron-back"
        size={26}
      />
    </Pressable>
  ) : null;

  const heading = (
    <>
      <Text
        className={`${titleTone} ${centerTitle ? "text-center" : ""}`}
        numberOfLines={1}
        variant="subtitle"
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          className={`${subtitleTone} ${centerTitle ? "text-center" : ""}`}
          numberOfLines={1}
          variant="caption"
        >
          {subtitle}
        </Text>
      ) : null}
    </>
  );

  if (centerTitle) {
    return (
      <View style={{ backgroundColor: background, paddingTop: insets.top }}>
        {/*
          Three columns with the outer two pinned to the same width, rather than
          an absolutely-positioned title over the row.

          Absolute positioning centres the title against the *screen* and is what
          React Navigation does — but it also lets a long name run underneath the
          back arrow and the action, because an absolute child has no siblings to
          be constrained by. A hostel called "Shanti Bhawan Boys Hostel &
          Residency" is not unusual. Here the middle column is `flex-1` between
          two fixed slots, so `numberOfLines={1}` truncates it in the space it
          actually has.
        */}
        <View className="min-h-14 flex-row items-center px-4 pb-2 pt-1">
          <View className="items-start justify-center" style={{ width: SIDE_SLOT }}>
            {back}
          </View>

          <View className="flex-1 items-center px-1">{heading}</View>

          <View className="items-end justify-center" style={{ width: SIDE_SLOT }}>
            {actions}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: background, paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-3 px-4 pb-2 pt-1">
        {back}

        <View className="flex-1">{heading}</View>

        {actions}
      </View>
    </View>
  );
}
