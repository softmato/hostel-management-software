import { Switch } from "react-native";

import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * A themed on/off switch.
 *
 * Wraps the platform `Switch` rather than drawing one, because this is a control
 * people already know how to read: the platform decides the shape, the animation
 * and — importantly — the accessibility semantics, all of which a hand-rolled
 * `Pressable` would have to reproduce and would get subtly wrong.
 *
 * What is themed is only the colour. `trackColor.true` is the brand green, so a
 * switch reads as "on" at a glance in a list where most are off, and the
 * platform default (iOS system green, Android's accent) would otherwise be a
 * second, unrelated green sitting next to ours.
 *
 * `accessibilityLabel` is required rather than optional: a bare switch announces
 * itself as "switch, on" with no indication of *what* is on, and in a settings
 * list that is every row sounding identical.
 */
export function Toggle({
  accessibilityLabel,
  disabled = false,
  onChange,
  value,
}: {
  accessibilityLabel: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  value: boolean;
}) {
  const { colors, isDark } = useAppTheme();

  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onValueChange={onChange}
      /*
       * Android tints the thumb too; iOS ignores it and always uses white. The
       * light thumb is correct on both because the "on" track is the brand green,
       * which is dark enough to carry it in either theme.
       */
      thumbColor={value ? colors.primaryForeground : undefined}
      trackColor={{ false: isDark ? colors.border : colors.muted, true: colors.primary }}
      value={value}
    />
  );
}
