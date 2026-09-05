import { Text as RNText, type TextProps as RNTextProps } from "react-native";

const VARIANTS = {
  body: "text-base text-foreground",
  caption: "text-xs text-muted-foreground",
  label: "text-sm font-medium text-foreground",
  muted: "text-sm text-muted-foreground",
  subtitle: "text-base font-medium text-foreground",
  title: "text-2xl font-semibold tracking-tight text-foreground",
  display: "text-3xl font-semibold tracking-tight text-foreground",
} as const;

export type TextVariant = keyof typeof VARIANTS;

type TextProps = RNTextProps & {
  className?: string;
  /**
   * `null` renders with **no variant classes at all** — the caller supplies the
   * whole type treatment.
   *
   * It exists because stacking a size on top of a variant does not work and
   * fails silently. Every variant already sets a font size, and NativeWind
   * resolves two font-size utilities of equal specificity by their order in the
   * generated stylesheet, not by their order in the string — Tailwind emits
   * `text-sm` before `text-base`, so `body`'s `text-base` beats a `text-sm` the
   * call site appended. `<Button size="sm">` was rendering at 16pt for exactly
   * this reason.
   *
   * So a component that owns its own type — `<Button>` — passes `null` and
   * states all of it. A *screen* still should not: it wants an existing
   * variant, which is what the table is for.
   */
  variant?: TextVariant | null;
};

/**
 * Typography lives in the variant table, not in call sites. A screen that needs
 * a size not listed here almost always wants an existing variant instead.
 */
export function Text({ className = "", variant = "body", ...props }: TextProps) {
  const variantClasses = variant ? VARIANTS[variant] : "";

  return <RNText className={`${variantClasses} ${className}`} {...props} />;
}
