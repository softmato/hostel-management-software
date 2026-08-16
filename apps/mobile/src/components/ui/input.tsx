import { useState } from "react";
import {
  Pressable,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

type InputProps = Omit<TextInputProps, "className"> & {
  error?: string | null;
  hint?: string;
  label?: string;
  /** Renders the show/hide toggle and starts masked. */
  secure?: boolean;
};

export function Input({
  error,
  hint,
  label,
  secure = false,
  onBlur,
  onFocus,
  ...props
}: InputProps) {
  const { colors } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderTone = error
    ? "border-destructive"
    : focused
      ? "border-primary"
      : "border-border";

  return (
    <View className="gap-1.5">
      {label ? <Text variant="label">{label}</Text> : null}

      <View
        className={`h-12 flex-row items-center rounded-xl border bg-card px-4 ${borderTone}`}
      >
        <TextInput
          className="h-full flex-1 text-base text-foreground"
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secure && !revealed}
          {...props}
        />

        {secure ? (
          <Pressable
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => setRevealed((value) => !value)}
          >
            <Text className="text-primary" variant="label">
              {revealed ? "Hide" : "Show"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
