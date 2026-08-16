import type { ReactNode } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`rounded-2xl border border-border bg-card p-4 ${className}`}>
      {children}
    </View>
  );
}

export function SectionHeader({
  action,
  subtitle,
  title,
}: {
  action?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <View className="mb-3 flex-row items-end justify-between">
      <View className="flex-1">
        <Text variant="subtitle">{title}</Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}
