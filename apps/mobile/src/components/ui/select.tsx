import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { Sheet, SheetRow } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * A single-choice field: a trigger that reads like an `Input`, and a sheet.
 *
 * ## Not a native picker
 *
 * `@react-native-picker/picker` renders a spinner on iOS and a dropdown on
 * Android, so the same field is two different controls with two different
 * heights and no shared styling — on a form that is otherwise entirely
 * `Input`s, the picker is the row that looks like it came from another app.
 * A sheet is one control on both platforms and inherits the theme.
 *
 * ## Why the trigger mirrors `Input`
 *
 * Same height, same border, same label and error slots. A field that opens a
 * sheet and a field that opens a keyboard should be indistinguishable until
 * they are tapped; anything else makes the form look misaligned.
 */

export type SelectOption<T extends string> = {
  /** Second line in the sheet — what the option means, when the label is terse. */
  description?: string;
  label: string;
  value: T;
};

type SelectProps<T extends string> = {
  disabled?: boolean;
  error?: string | null;
  hint?: string;
  label?: string;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  /** Sheet heading. Defaults to `label`. */
  sheetTitle?: string;
  value: T | null | undefined;
};

export function Select<T extends string>({
  disabled = false,
  error,
  hint,
  label,
  onChange,
  options,
  placeholder = "Select",
  sheetTitle,
  value,
}: SelectProps<T>) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value) ?? null;

  const choose = useCallback(
    (next: T) => {
      onChange(next);
      // Closed on choice, not on a second Done tap: there is exactly one
      // selection to make and the sheet has nothing left to say afterwards.
      setOpen(false);
    },
    [onChange],
  );

  const borderTone = error ? "border-destructive" : "border-border";

  return (
    <View className="gap-1.5">
      {label ? <Text variant="label">{label}</Text> : null}

      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        className={`h-12 flex-row items-center rounded-xl border bg-card px-4 active:opacity-80 ${borderTone} ${
          disabled ? "opacity-50" : ""
        }`}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Text
          className={`flex-1 ${selected ? "text-foreground" : "text-muted-foreground"}`}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons color={colors.mutedForeground} name="chevron-down" size={18} />
      </Pressable>

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}

      <Sheet bare onClose={() => setOpen(false)} open={open} title={sheetTitle ?? label}>
        {options.map((option) => (
          <SheetRow
            key={option.value}
            label={option.label}
            onPress={() => choose(option.value)}
            selected={option.value === value}
            subtitle={option.description}
            trailing={
              option.value === value ? (
                <Ionicons color={colors.primary} name="checkmark" size={20} />
              ) : null
            }
          />
        ))}
      </Sheet>
    </View>
  );
}
