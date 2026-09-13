import { Pressable, View } from "react-native";

import { FieldLabel } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

/**
 * A labelled set of pill choices that wraps — one answer or several.
 *
 * Not {@link Segmented}: that is a single row of two to five tabs switching a
 * view. A form answer can have eight options (blood group) or allow many
 * (interests), and neither fits a tab strip. The caller owns the semantics:
 * `onToggle` hands back the tapped value and `value` says what is on.
 */
export function ChoiceChips<T extends string>({
  columns,
  error,
  label,
  onToggle,
  options,
  value,
}: {
  /** Equal-width chips in this many columns; omit to size chips to their text. */
  columns?: number;
  error?: string | null;
  label?: string;
  onToggle: (value: T) => void;
  options: readonly { label: string; value: T }[];
  value: T | readonly T[] | null | undefined;
}) {
  const isOn = (option: T) =>
    Array.isArray(value) ? value.includes(option) : value === option;

  return (
    <View className="gap-2.5">
      {label ? <FieldLabel>{label}</FieldLabel> : null}

      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const on = isOn(option.value);

          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              className={`items-center rounded-full border px-4 py-2 active:opacity-70 ${
                on ? "border-primary bg-primary" : "border-border"
              }`}
              key={option.value}
              onPress={() => onToggle(option.value)}
              style={
                columns
                  ? { flexBasis: `${Math.floor(100 / columns) - 4}%`, flexGrow: 1 }
                  : undefined
              }
            >
              <Text
                className={`text-sm ${on ? "font-semibold text-primary-foreground" : "text-foreground"}`}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
