import { Text } from "@/components/ui/text";
import { formatMoney } from "@/lib/format";

const SIZES = {
  display: "text-3xl font-semibold tracking-tight",
  inline: "text-base",
  large: "text-2xl font-semibold tracking-tight",
} as const;

/**
 * An amount, rendered the one way the app renders amounts.
 *
 * The tone rule is the reason this is a component rather than a call to
 * `formatMoney`: an outstanding balance is the number the screen exists to
 * communicate, and it should be the loudest thing on it, while a zero balance
 * should be quiet — "NPR 0" in red is a false alarm. `owed` colours by the
 * value, so no screen has to decide.
 */
export function Money({
  className = "",
  owed = false,
  size = "inline",
  value,
}: {
  className?: string;
  /** Colour by whether anything is actually outstanding. */
  owed?: boolean;
  size?: keyof typeof SIZES;
  value: number | null | undefined;
}) {
  const tone = owed
    ? (value ?? 0) > 0
      ? "text-destructive"
      : "text-success"
    : "text-foreground";

  return (
    <Text className={`${SIZES[size]} ${tone} ${className}`}>{formatMoney(value)}</Text>
  );
}
