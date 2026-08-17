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
  danger: { background: "bg-destructive/10", foreground: "text-destructive" },
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
    <View className={`self-start rounded-full px-2.5 py-1 ${background} ${className}`}>
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
    <Badge className={className} label={humanizeEnum(status)} tone={statusTone(status)} />
  );
}
