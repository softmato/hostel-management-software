import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { getRefundPolicy, type RefundPolicy } from "@/lib/booking-api";

/**
 * Refund policy for room bookings — docs/BOOKINGS.md item 24.
 *
 * Not a `DocumentScreen`: those read fixed site copy, and this policy is built
 * from the live booking settings, so every percentage on it is the one a booking
 * made today is sold under. Same words as the website's `/refund-policy`.
 */
export default function RefundPolicyScreen() {
  const policy = useResource<RefundPolicy>(useCallback(() => getRefundPolicy(), []), {
    cacheKey: "booking-refund-policy",
  });
  const header = <AppBar showBack title="Refund Policy" />;

  if (policy.loading) {
    return (
      <Screen header={header} scroll>
        <View className="gap-3">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={4} />
        </View>
      </Screen>
    );
  }

  if (policy.error || !policy.data) {
    return (
      <Screen header={header}>
        <ErrorState message={policy.error ?? "The refund policy could not be loaded."} onRetry={policy.reload} />
      </Screen>
    );
  }

  const data = policy.data;

  return (
    <Screen header={header} onRefresh={policy.refresh} refreshing={policy.refreshing} scroll>
      <View className="gap-5">
        {data.updatedAt ? <Text variant="caption">Last updated: {data.updatedAt}</Text> : null}
        {data.intro.map((line) => (
          <Text className="text-sm text-foreground" key={line}>
            {line}
          </Text>
        ))}

        {data.customBody ? (
          <Card>
            <Text className="text-sm leading-6 text-foreground">{data.customBody}</Text>
          </Card>
        ) : (
          data.sections.map((section) => (
            <View key={section.title}>
              <SectionHeader title={section.title} />
              <Card>
                <View className="gap-2.5">
                  {section.body.map((line) => (
                    <View className="flex-row gap-2" key={line}>
                      <Text className="text-sm text-muted-foreground">•</Text>
                      <Text className="flex-1 text-sm leading-5 text-foreground">{line}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}
