import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { getBookingGuide, type BookingGuide } from "@/lib/booking-api";

/**
 * How booking works — docs/BOOKINGS.md item 33.
 *
 * The same sentences as the website's `/how-booking-works`, built from the live
 * booking settings, so the checkout, this screen and the emails cannot end up
 * quoting three different answer windows. The money itself is next door, on the
 * refund policy screen.
 */
export default function HowBookingWorksScreen() {
  const guide = useResource<BookingGuide>(useCallback(() => getBookingGuide(), []), {
    cacheKey: "booking-guide",
  });
  const header = <AppBar showBack title="How Booking Works" />;

  if (guide.loading) {
    return (
      <Screen header={header} scroll>
        <View className="gap-3">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={4} />
        </View>
      </Screen>
    );
  }

  if (guide.error || !guide.data) {
    return (
      <Screen header={header}>
        <ErrorState message={guide.error ?? "This could not be loaded."} onRetry={guide.reload} />
      </Screen>
    );
  }

  const data = guide.data;

  return (
    <Screen header={header} onRefresh={guide.refresh} refreshing={guide.refreshing} scroll>
      <View className="gap-5">
        {data.enabled ? null : (
          <View className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <Text className="text-sm text-foreground">
              Room booking is not open right now. This is how it works when it is.
            </Text>
          </View>
        )}

        {data.intro.map((line) => (
          <Text className="text-sm text-foreground" key={line}>
            {line}
          </Text>
        ))}

        {data.sections.map((section) => (
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
        ))}

        <Button
          label="Read the refund policy"
          onPress={() => router.push("/legal/refund-policy")}
          variant="outline"
        />
      </View>
    </Screen>
  );
}
