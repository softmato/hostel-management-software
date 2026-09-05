import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { CookShiftCard } from "@/components/cook-shift-card";
import { mealIcon } from "@/components/meal-row";
import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import { announceFoodReady, type CookToday } from "@/lib/cook-api";
import { cookQuery } from "@/lib/cook-queries";
import {
  announcedCount,
  mealButtonLabel,
  mealButtons,
  mealSubtitle,
  nextUnannounced,
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
 * ## What leads it, and why that changed
 *
 * A plain bordered box holding `Cooking for` / `42` / a sentence, under a
 * 16-point bar. Beside the other three portals — all of which open on paint —
 * this was the one that looked like a different app, and it is the one used by
 * somebody reading at arm's length across a worktop.
 *
 * It is `<CookShiftCard>` now: the head count as the figure, `N of 4` on the
 * shoulder, and a two-up of what has been called against what is next. The
 * sentence it replaced said the same two things in prose, in the second-most
 * valuable band on a screen whose point is the buttons below it.
 *
 * The card's shape is the **inset** one (`AdminMoneyCard`'s), not the
 * full-bleed hero's, and that is deliberate — see its own note. This screen is a
 * worktop, not a front door.
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
  const { colors } = useAppTheme();
  /*
   * The portal's key, not an inline loader. `GET /cook/today` carries the whole
   * week's routine as well as today's meals, so the Menu tab reads this same
   * descriptor — and without a `cacheKey` both tabs were refetching it on every
   * visit. See `lib/cook-queries.ts`.
   */
  const query = cookQuery.today();
  const today = useResource<CookToday>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
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

  /*
   * The bell, which no cook screen had. `/notifications` is scoped to
   * `principal.userId` with no role branch, so this shared kitchen account has a
   * feed — the More tab had a row into it and none of the other three tabs did,
   * so the control vanished the moment you left that one screen.
   *
   * The hostel's name moved off the bar and onto the card, where it sits under
   * the head count it qualifies. A subtitle naming the hostel on every tab is
   * chrome repeating what the account already is.
   */
  const header = <AppBar actions={<NotificationBell />} large title="Today" />;

  if (today.loading) {
    return (
      /* The shift card, then four announce cards — the shape it lands in. */
      <Screen header={header} insideTabs padded={false} scroll>
        <View className="px-5">
          <Skeleton height={190} radius={26} />
        </View>

        <View className="gap-3 px-5 pt-6">
          <Skeleton height={18} width="40%" />
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton height={132} key={index} radius={16} />
          ))}
        </View>
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
  const next = nextUnannounced(buttons);

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={today.refresh}
      padded={false}
      refreshing={today.refreshing}
      scroll
    >
      <CookShiftCard
        announced={announcedCount(buttons)}
        hostelName={today.data.hostel.name}
        nextLabel={next ? humanizeEnum(next.mealType) : null}
        nextTiming={next?.timing ?? ""}
        residentCount={today.data.residentCount}
      />

      <View className="gap-3 px-5 pt-6">
        <SectionHeader
          subtitle="Tap when the food is out — every resident gets a notification"
          title="Food ready"
        />

        {buttons.map((button) => (
          <Card
            /*
              The next meal to call is outlined in the brand, which is the only
              thing telling four otherwise identical cards apart before a word of
              them is read. It is the same treatment the resident's focus invoice
              carries, and for the same reason: on a screen of equals, the one
              you are here for should not have to be found.
            */
            className={`gap-3 ${next?.mealType === button.mealType ? "border-primary/40" : ""}`}
            key={button.mealType}
          >
            <View className="flex-row items-start gap-3">
              {/*
                The icon square the rest of the app uses for a meal. A cook
                works this screen in a hurry with wet hands and picks the card
                by shape before reading a word of it — four identical cards
                distinguished only by a heading is the version that gets
                breakfast announced at dinner.
              */}
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-brand-soft">
                <Ionicons
                  color={colors.primary}
                  name={mealIcon(button.mealType)}
                  size={19}
                />
              </View>

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

        <Text className="px-1 pt-1" variant="caption">
          The message is built from today&apos;s menu automatically. If you have cooked
          something else, announce it and tell residents in person — the menu is the
          hostel office&apos;s to change.
        </Text>
      </View>
    </Screen>
  );
}
