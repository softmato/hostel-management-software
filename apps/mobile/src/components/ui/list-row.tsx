import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * One line in a list: a label, an optional second line, something on the right.
 *
 * Rows are the app's densest surface, so the tap target is set by `min-h-14`
 * rather than by whatever the text happens to measure — a one-line row and a
 * two-line row must not have different-sized hit areas, and 56dp clears the
 * 48dp Android minimum with room for the divider.
 */
export function ListRow({
  className = "",
  icon,
  onPress,
  right,
  subtitle,
  title,
  value,
}: {
  className?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** Replaces the chevron/value slot entirely — a switch, a pill, a button. */
  right?: ReactNode;
  subtitle?: string;
  title: string;
  /** Right-aligned secondary text, e.g. an amount. */
  value?: string;
}) {
  const { colors } = useAppTheme();

  const body = (
    <View className={`min-h-14 flex-row items-center gap-3 py-3 ${className}`}>
      {icon ? (
        <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Ionicons color={colors.mutedForeground} name={icon} size={18} />
        </View>
      ) : null}

      <View className="flex-1">
        <Text numberOfLines={1} variant="label">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} variant="caption">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right ?? (
        <View className="flex-row items-center gap-1">
          {value ? <Text variant="muted">{value}</Text> : null}
          {onPress ? (
            <Ionicons color={colors.mutedForeground} name="chevron-forward" size={18} />
          ) : null}
        </View>
      )}
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="button"
      className="active:opacity-70"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      {body}
    </Pressable>
  );
}

/** A hairline between rows. Inset past the icon column so it reads as a group. */
export function RowDivider({ inset = false }: { inset?: boolean }) {
  return <View className={`h-px bg-border ${inset ? "ml-12" : ""}`} />;
}
