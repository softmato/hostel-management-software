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
  variant?: TextVariant;
};

/**
 * Typography lives in the variant table, not in call sites. A screen that needs
 * a size not listed here almost always wants an existing variant instead.
 */
export function Text({ className = "", variant = "body", ...props }: TextProps) {
  return <RNText className={`${VARIANTS[variant]} ${className}`} {...props} />;
}
