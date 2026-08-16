import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The states every list and detail view has to handle — DESIGN.md §5.
 *
 * They live together so it is obvious when a screen has only implemented two of
 * them. An empty list and a failed request look identical to a user if you let
 * them both render as nothing.
 */

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text variant="muted">{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8 py-16">
      <Text className="text-center" variant="subtitle">
        {title}
      </Text>
      {description ? (
        <Text className="text-center" variant="muted">
          {description}
        </Text>
      ) : null}
      {action ? <View className="mt-3">{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8 py-16">
      <Text className="text-center" variant="subtitle">
        That didn&apos;t load
      </Text>
      <Text className="text-center" variant="muted">
        {message}
      </Text>
      {onRetry ? (
        <Button className="mt-2" label="Try again" onPress={onRetry} variant="outline" />
      ) : null}
    </View>
  );
}
