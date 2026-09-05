import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { humanizeEnum } from "@/lib/format";
import { type BadgeTone, statusTone } from "@/lib/status";

/**
 * Small labels: a category, a count, a status.
 *
 * The tone *table* lives in `lib/status.ts` so it can be unit tested — Vitest
 * runs node-side with no React Native shim, so anything in this file is
 * untestable by construction. Only the styling stays here.
 */

const TONES: Record<BadgeTone, { background: string; foreground: string }> = {
  /*
    `bg-destructive-soft`, not `bg-destructive/10`. NativeWind does not compose
    an opacity suffix onto a colour that is a CSS variable, so every `danger`
    badge in the app shipped with *no background at all* — red text floating on
    the card while its `warning` and `success` neighbours sat on a tint. The
    token this needs already exists; `global.css` documents why it was added.
  */
  danger: { background: "bg-destructive-soft", foreground: "text-destructive" },
  info: { background: "bg-role-admin-soft", foreground: "text-role-admin" },
  neutral: { background: "bg-muted", foreground: "text-muted-foreground" },
  success: { background: "bg-success-soft", foreground: "text-success" },
  warning: { background: "bg-warning-soft", foreground: "text-warning" },
};

export function Badge({
  className = "",
  label,
  tone = "neutral",
}: {
  className?: string;
  label: string;
  tone?: BadgeTone;
}) {
  const { background, foreground } = TONES[tone];

  return (
    <View
      className={`self-start rounded-full px-2.5 py-1 ${background} ${className}`}
    >
      <Text className={`text-xs font-semibold ${foreground}`}>{label}</Text>
    </View>
  );
}

export function StatusPill({
  className = "",
  status,
}: {
  className?: string;
  status: string | null | undefined;
}) {
  return (
    <Badge
      className={className}
      label={humanizeEnum(status)}
      tone={statusTone(status)}
    />
  );
}

const STATUS_INK: Record<BadgeTone, string> = {
  danger: "text-destructive",
  info: "text-role-admin",
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
};

/**
 * A status with the tone and none of the pill.
 *
 * ## Where this belongs, and where it does not
 *
 * A pill is a *chip*: a shape with a background, which the eye reads as an
 * object sitting on the surface. That is right when the status is one of two or
 * three things competing for a row — an invoice row’s badge next to its
 * amount, a claim next to its date — and wrong when the status is the **second
 * line of a value that is already right-aligned**. Stacking a filled pill under
 * a figure gives a column of amounts a ragged edge of coloured rectangles, and
 * the rectangles read as louder than the money they are annotating.
 *
 * So the invoice list draws `Rs 4,500` over a small red `OVERDUE`, and both
 * lines sit on the same right margin. Same table, same tones, no box.
 *
 * Uppercase and tracked, because at 10 points without a container the label
 * needs some other cue that it is a state rather than a caption.
 */
export function StatusText({
  className = "",
  status,
}: {
  className?: string;
  status: string | null | undefined;
}) {
  return (
    <Text
      className={`font-bold uppercase tracking-wider ${STATUS_INK[statusTone(status)]} ${className}`}
      numberOfLines={1}
      style={{ fontSize: 10 }}
    >
      {humanizeEnum(status)}
    </Text>
  );
}
