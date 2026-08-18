import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { announceFoodReady, type CookToday, getCookToday } from "@/lib/cook-api";
import {
  announcedCount,
  mealButtonLabel,
  mealButtons,
  mealSubtitle,
  reachedNobody,
} from "@/lib/cook";
import { collectDeviceInfo } from "@/lib/device-info";
import { formatTime, humanizeEnum } from "@/lib/format";
import type { MealType } from "@/lib/food-week";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";

/**
 * The kitchen's screen: four big buttons, and the two facts that decide what to
 * cook.
 *
 * ## The buttons are the screen
 *
 * A cook uses this with wet hands, in a hurry, probably one-handed. So each
 * meal is a full-width card with a full-width button rather than a row with a
 * trailing action, and all four are always present — a hostel serving an
 * unplanned snack still needs to call it, and a routine cell an admin left
 * blank must not remove the ability to announce.
 *
 * ## Success is `notifiedCount`, not `201`
 *
 * `announceFoodReady` returns 201 as soon as the log row is written, whether or
 * not a single resident had an account to notify. Reporting "residents
 * notified" off the status code would tell a cook the hostel had been called to
 * dinner when nobody was told, so the toast reads the count and says so plainly
 * when it is zero.
 *
 * ## The cooldown belongs to the server
 *
 * `foodReadyCooldownMinutes` caps repeat announcements and returns 429 with the
 * wait in minutes. The button therefore says "Announce again" rather than
 * disabling itself: a cook re-calling a late sitting must be able to try, and a
 * client-side copy of that rule would drift the moment an admin changes it.
 */
export default function CookTodayScreen() {
  const today = useResource<CookToday>(useCallback(() => getCookToday(), []), {
    topics: [REALTIME_TOPIC.FOOD],
  });

  const [busy, setBusy] = useState<MealType | null>(null);

  const announce = useCallback(
    async (mealType: MealType) => {
      setBusy(mealType);

      try {
        const announcement = await announceFoodReady({
          // One login serves the whole kitchen, so the device fingerprint is
          // the only thing that distinguishes two cooks in the audit trail.
          deviceInfo: await collectDeviceInfo(),
          mealType,
        });

        if (reachedNobody(announcement)) {
          toastInfo(
            "Nobody was notified",
            "This announcement was recorded, but no resident here has an app account yet.",
          );
        } else {
          toastSuccess(
            `${humanizeEnum(mealType)} announced`,
            `${announcement.notifiedCount} resident(s) notified.`,
          );
        }

        today.refresh();
      } catch (caught) {
        // Includes the 429 cooldown, whose message names the wait in minutes.
        toastError("Not announced", readApiError(caught));
      } finally {
        setBusy(null);
      }
    },
    [today],
  );

  const header = <AppBar subtitle={today.data?.hostel.name} title="Today" />;

  if (today.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading today's menu" />
      </Screen>
    );
  }

  if (today.error || !today.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={today.error ?? "Today's menu could not be loaded."}
          onRetry={today.reload}
        />
      </Screen>
    );
  }

  const buttons = mealButtons(today.data.meals, today.data.announced);

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={today.refresh}
      refreshing={today.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-2">
          <Text variant="caption">Cooking for</Text>
          <Text variant="display">{today.data.residentCount}</Text>
          <Text variant="muted">
            {`Active residents at ${today.data.hostel.name}. ${announcedCount(
              buttons,
            )} of 4 meals announced today.`}
          </Text>
        </Card>

        <View className="gap-3">
          <SectionHeader
            subtitle="Tap when the food is out — every resident gets a notification"
            title="Food ready"
          />

          {buttons.map((button) => (
            <Card className="gap-3" key={button.mealType}>
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text variant="subtitle">{humanizeEnum(button.mealType)}</Text>
                  <Text variant="caption">{mealSubtitle(button)}</Text>
                </View>

                {button.sent ? (
                  <Badge
                    label={`Sent ${formatTime(button.sent.announcedAt)}`}
                    tone="success"
                  />
                ) : button.timing ? (
                  <Badge label={button.timing} />
                ) : null}
              </View>

              <Button
                label={mealButtonLabel(button)}
                loading={busy === button.mealType}
                onPress={() => void announce(button.mealType)}
                size="lg"
                variant={button.sent ? "outline" : "primary"}
              />

              {button.sent ? (
                <Text variant="caption">
                  {`${button.sent.notifiedCount} resident(s) notified.`}
                </Text>
              ) : null}
            </Card>
          ))}
        </View>

        <Text className="px-1" variant="caption">
          The message is built from today&apos;s menu automatically. If you have cooked
          something else, announce it and tell residents in person — the menu is the
          hostel office&apos;s to change.
        </Text>
      </View>
    </Screen>
  );
}
