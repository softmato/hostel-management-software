import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useCallback, useState } from "react";
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
  /**
   * Drawn ahead of the label — in the sheet's row, and on the trigger once this
   * option is the chosen one.
   *
   * A node rather than an icon name, because the one list that needs it draws
   * `<WalletMark>` (an image on a white tile), not an `<Ionicons>`.
   *
   * **The same node appears in both places, so size it for the trigger.** The
   * trigger is `h-12`, which leaves room for a mark up to about 28 points; pass
   * anything taller and the field grows past the `<Input>`s either side of it,
   * which is the one thing this component exists not to do. Sharing the node
   * rather than taking two is deliberate — a picker whose mark changes size the
   * moment you choose it reads as two different controls.
   */
  leading?: ReactNode;
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
        /*
          The left inset tightens when there is a mark to show.

          `px-4` in front of a 28-point tile puts the tile where the *text*
          belongs and pushes the label a third of the way across the field. The
          mark takes the gutter instead and the label sits where a leading
          adornment always puts it.
        */
        className={`h-12 flex-row items-center gap-2.5 rounded-xl border bg-card pr-4 active:opacity-80 ${
          selected?.leading ? "pl-2.5" : "pl-4"
        } ${borderTone} ${disabled ? "opacity-50" : ""}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        {/*
          The chosen option's own mark, on the trigger.

          Without it the logo a resident just tapped in the sheet vanishes the
          instant they choose it, so the control that is hardest to get right —
          picking the wrong method sends the hostel looking for the payment in
          the wrong statement — is the one that shows the least once it is
          filled in. The confirmation of a choice should look like the choice.
        */}
        {selected?.leading ?? null}

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
            leading={option.leading}
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
