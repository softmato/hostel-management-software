import * as Haptics from "expo-haptics";
import { ActivityIndicator, Pressable, type PressableProps, View } from "react-native";

import { Text } from "@/components/ui/text";

const VARIANTS = {
  danger: {
    base: "bg-destructive",
    disabled: "bg-destructive/40",
    label: "text-destructive-foreground",
  },
  ghost: {
    base: "bg-transparent",
    disabled: "bg-transparent opacity-40",
    label: "text-primary",
  },
  outline: {
    base: "border border-border bg-transparent",
    disabled: "border border-border bg-transparent opacity-40",
    label: "text-foreground",
  },
  primary: {
    base: "bg-primary",
    disabled: "bg-primary/40",
    label: "text-primary-foreground",
  },
  secondary: {
    base: "bg-secondary",
    disabled: "bg-secondary opacity-50",
    label: "text-secondary-foreground",
  },
} as const;

const SIZES = {
  lg: { label: "text-base", wrapper: "h-14 px-6 rounded-2xl" },
  md: { label: "text-base", wrapper: "h-12 px-5 rounded-xl" },
  sm: { label: "text-sm", wrapper: "h-9 px-3 rounded-lg" },
} as const;

type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  className?: string;
  /** Fires a selection tick on press. Off for destructive flows with their own confirm. */
  haptic?: boolean;
  label: string;
  loading?: boolean;
  size?: keyof typeof SIZES;
  variant?: keyof typeof VARIANTS;
};

export function Button({
  className = "",
  disabled,
  haptic = true,
  label,
  loading = false,
  onPress,
  size = "md",
  variant = "primary",
  ...props
}: ButtonProps) {
  const tone = VARIANTS[variant];
  const dimensions = SIZES[size];
  // A button mid-request must not accept a second press — double-submitting a
  // payment claim is a real cost, not a cosmetic one.
  const isBlocked = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isBlocked }}
      className={`flex-row items-center justify-center active:opacity-80 ${dimensions.wrapper} ${
        isBlocked ? tone.disabled : tone.base
      } ${className}`}
      disabled={isBlocked}
      onPress={(event) => {
        if (haptic) {
          void Haptics.selectionAsync();
        }

        onPress?.(event);
      }}
      {...props}
    >
      {loading ? (
        <View className="mr-2">
          <ActivityIndicator color={variant === "primary" ? "#ffffff" : undefined} size="small" />
        </View>
      ) : null}

      <Text className={`font-semibold ${dimensions.label} ${tone.label}`}>{label}</Text>
    </Pressable>
  );
}
