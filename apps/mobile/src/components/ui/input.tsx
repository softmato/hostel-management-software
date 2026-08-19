import { useState } from "react";
import {
  Pressable,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The single-line box height, and the floor under a multiline one.
 *
 * A number rather than `h-12` / `min-h-12` on the multiline branch: `h-12` is a
 * class this app uses in a dozen places and is certainly generated, but
 * `min-h-12` appears nowhere else, and NativeWind compiles the class list at
 * bundle time — a name nothing else uses can resolve to nothing and take the
 * floor with it. Written this way it cannot.
 */
const FIELD_HEIGHT = 48;

/**
 * A labelled field, single-line or multiline.
 *
 * ## The box has to be told when it is holding a textarea
 *
 * The bordered row was `h-12` and `items-center` for every field, and callers
 * that wanted a textarea passed the height straight to the `TextInput` —
 * `style={{ height: 132, paddingTop: 12, textAlignVertical: "top" }}` and
 * variants of it, in eight screens. A 132dp input inside a 48dp row that centres
 * its children does not clip: React Native has no `overflow: hidden` by default,
 * so the input **overflowed the border by 42dp in each direction** and the first
 * line of text was drawn *above* the box, on top of the field's own label. The
 * ID card form showed it worst — "Permanent address" rendered its value on the
 * label line with an empty box underneath, which reads as two broken fields
 * rather than one.
 *
 * So the row now branches: single-line keeps the fixed 48dp and centres, and
 * multiline stops constraining the height and lets the input's own height define
 * the box. `FIELD_HEIGHT` is the floor, so a textarea with no height given is
 * still at least as tall as an ordinary field instead of collapsing to one line.
 *
 * `textAlignVertical: "top"` is applied here rather than left to callers because
 * it is not a preference — it is what stops Android centring a single line of
 * text in a tall box, and every caller that remembered it wanted the same thing.
 * A caller's own `style` is merged last and still wins.
 */
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
  multiline = false,
  secure = false,
  onBlur,
  onFocus,
  style,
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
        className={`flex-row rounded-xl border bg-card px-4 ${
          multiline ? "items-stretch" : "h-12 items-center"
        } ${borderTone}`}
        style={multiline ? { minHeight: FIELD_HEIGHT } : undefined}
      >
        <TextInput
          className={`flex-1 text-base text-foreground ${multiline ? "" : "h-full"}`}
          multiline={multiline}
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
          style={[multiline ? { paddingTop: 12, textAlignVertical: "top" } : null, style]}
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
