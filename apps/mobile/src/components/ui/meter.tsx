import { View } from "react-native";

import { Text } from "@/components/ui/text";

/**
 * A filled track — "this much of that", as a shape rather than as two numbers.
 *
 * The pair it replaces is `NPR 74,000 of NPR 98,000`, which is accurate and
 * takes a moment's arithmetic to turn into the thing anybody actually wanted:
 * *are we nearly there*. A bar answers that before it is read. Both are shown —
 * the figures stay above it — because the bar alone cannot be acted on.
 *
 * ## The tone comes from the value, not from the call site
 *
 * The screens that use this all mean the same thing by a low bar (money that
 * has not come in), so deciding the colour per call site is how two of them end
 * up disagreeing about what counts as bad. The thresholds are deliberately
 * generous: below 60% is amber rather than red, because a hostel collects rent
 * through the month and a red bar on the 3rd would cry wolf every month.
 *
 * ## `null` is a state, not a zero
 *
 * A month nobody billed has no percentage, and drawing an empty track for it
 * says "you have collected nothing" to a hostel whose real problem is that no
 * invoices exist. That case renders the track alone with a dash, and the caller
 * supplies the sentence explaining it.
 */

const TONES = {
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
} as const;

function toneFor(percent: number): keyof typeof TONES {
  if (percent >= 90) {
    return "success";
  }

  if (percent >= 60) {
    return "warning";
  }

  return "danger";
}

export function Meter({
  /** Height of the track in points. The default is a bar, not a hairline. */
  height = 8,
  label,
  /** `0`–`100`, or `null` when the ratio does not apply. */
  percent,
}: {
  height?: number;
  /** Right-hand caption. Falls back to the percentage itself. */
  label?: string;
  percent: number | null;
}) {
  const clamped = percent === null ? null : Math.max(0, Math.min(100, percent));
  const tone = clamped === null ? "neutral" : toneFor(clamped);

  return (
    <View className="gap-1.5">
      <View
        className="w-full overflow-hidden rounded-full bg-muted"
        style={{ height }}
      >
        {clamped === null ? null : (
          <View
            className={`h-full rounded-full ${TONES[tone]}`}
            /*
             * A percentage width, not a measured pixel one. `<Grid>` measures
             * because it has to divide a row into a whole number of cells;
             * a single bar has no such constraint, and percentage widths inside
             * a rounded, clipping parent are exact enough that the extra layout
             * pass would buy nothing but a frame of empty track on every render.
             */
            style={{ width: `${Math.max(clamped > 0 ? 4 : 0, clamped)}%` }}
          />
        )}
      </View>

      <Text variant="caption">{label ?? (clamped === null ? "—" : `${clamped}%`)}</Text>
    </View>
  );
}
