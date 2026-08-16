import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useBottomChrome } from "@/components/bottom-chrome";
import { Text } from "@/components/ui/text";
import { type RoleAccentKey, roleAccent } from "@/constants/theme";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";

/**
 * expo-router vendors react-navigation rather than depending on it, so
 * `@react-navigation/bottom-tabs` is not resolvable here. Deriving the props
 * from the `tabBar` slot keeps this correct across expo-router upgrades without
 * reaching into `expo-router/build/...`.
 */
export type TabBarRenderProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

/** Bar height excluding the system inset. Screens reserve this much. */
export const TAB_BAR_HEIGHT = 58;

/**
 * The tab bar.
 *
 * Custom rather than the navigator's default because the default cannot be
 * animated from a screen's scroll position. It is absolutely positioned so the
 * content behind it keeps its full height — the bar sliding away must not
 * reflow the list underneath, or every hide and show would shift the text the
 * reader is looking at.
 *
 * Visibility comes from `BottomChromeProvider`, shared with floating actions,
 * so a tabbed screen and the signed-out home behave identically on scroll.
 */
export function AnimatedTabBar({
  accent,
  descriptors,
  navigation,
  state,
}: TabBarRenderProps & { accent: RoleAccentKey }) {
  const insets = useSystemInsets();
  const { colors, isDark } = useAppTheme();
  const chrome = useBottomChrome();

  const activeColor = isDark ? roleAccent[accent].dark : roleAccent[accent].light;
  const totalHeight = TAB_BAR_HEIGHT + insets.bottom;

  const barStyle = useAnimatedStyle(() => {
    const progress = chrome?.progress.value ?? 0;

    return {
      // Fades slightly ahead of the slide, so the bar reads as leaving rather
      // than as being clipped by the screen edge.
      opacity: 1 - progress * 0.6,
      // Slid by its full height, inset included, so nothing peeks out.
      transform: [{ translateY: progress * totalHeight }],
    };
  });

  return (
    <Animated.View
      className="absolute inset-x-0 bottom-0 flex-row border-t border-border"
      style={[
        {
          backgroundColor: colors.background,
          height: totalHeight,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        barStyle,
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const label = typeof options.title === "string" ? options.title : route.name;
        const tint = focused ? activeColor : colors.mutedForeground;

        function onPress() {
          const event = navigation.emit({
            canPreventDefault: true,
            target: route.key,
            type: "tabPress",
          });

          if (focused || event.defaultPrevented) {
            return;
          }

          void Haptics.selectionAsync();
          navigation.navigate(route.name, route.params);
        }

        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            className="flex-1 items-center justify-center gap-0.5 active:opacity-60"
            key={route.key}
            onPress={onPress}
          >
            {options.tabBarIcon?.({ color: tint, focused, size: 23 })}
            <Text
              numberOfLines={1}
              style={{ color: tint, fontSize: 11, fontWeight: "500" }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}
