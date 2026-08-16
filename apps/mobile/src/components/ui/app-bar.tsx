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
  onBack?: () => void;
  showBack?: boolean;
  subtitle?: string;
  title: string;
};

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

  return (
    <View style={{ backgroundColor: background, paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-3 px-4 pb-2 pt-1">
        {showBack ? (
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
        ) : null}

        <View className="flex-1">
          <Text className={titleTone} numberOfLines={1} variant="subtitle">
            {title}
          </Text>
          {subtitle ? (
            <Text className={subtitleTone} numberOfLines={1} variant="caption">
              {subtitle}
            </Text>
          ) : null}
        </View>

        {actions}
      </View>
    </View>
  );
}
