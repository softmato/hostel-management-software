import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { NotificationBell } from "@/components/notification-bell";
import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { type ResidentMore, residentQuery } from "@/lib/resident-queries";
import { endSession } from "@/lib/auth-session";
import { prefetchCommunity } from "@/lib/community-queries";
import { formatDate, humanizeEnum } from "@/lib/format";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Everything that is not a tab.
 *
 * ## Every row opens a real screen, as of M5.9
 *
 * This file used to carry a `soon()` helper that toasted "it lands in the next
 * release" for the M5 entries — a row that navigates nowhere is indistinguishable
 * from a bug, and one that explains itself is a roadmap. All of them now navigate:
 * **complaints** (`/complaints`), **night status** (`/night-status`), **profile**
 * (`/profile`), the **digital ID** (`/id-card`), **community** (`/community`),
 * **referrals** (`/referrals`), **reviews** (`/review`) and both App rows
 * (`/settings`). The helper is gone with them.
 *
 * If a later milestone wants a row listed before its screen exists, bring `soon()`
 * back rather than pointing the row at nothing.
 *
 * **Explore** is the discovery entry (agreed 2026-08-16): residents keep their
 * own five tabs, and hostel browsing lives here rather than taking a tab from
 * rent, meals or notices.
 */

export default function ResidentMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  /*
    The loader moved to `lib/resident-queries.ts` so the warm-up and this screen
    run the same request under the same key — otherwise the prefetch warms a key
    nobody reads and More loads twice. `safety` is the topic because the
    night-status subtitle is the one value on this menu a warden can change from
    the roll-call screen.
  */
  const query = residentQuery.more();
  const more = useResource<ResidentMore>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });
  const [signingOut, setSigningOut] = useState(false);

  const profile = more.data?.profile;
  const resident = profile?.resident;

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your password to get back in.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          setSigningOut(true);
          void endSession().finally(() => router.replace("/(browse)"));
        },
        style: "destructive",
        text: "Sign out",
      },
    ]);
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";

  return (
    <Screen
      header={<AppBar actions={<NotificationBell />} title="More" />}
      insideTabs
      onRefresh={more.refresh}
      refreshing={more.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            {/*
              The shared `<Avatar>`, not a local initial circle. It already
              handles the case this screen has to handle anyway — an account
              with a Google photo, one with none, and one whose photo URL exists
              but cannot be drawn — and it colours the fallback the same way the
              same person is coloured in Community.
            */}
            <Avatar name={resident?.fullName ?? account?.name} size="lg" uri={account?.image} />

            <View className="flex-1">
              <Text variant="subtitle">
                {resident?.fullName ?? account?.name ?? "Your account"}
              </Text>
              <Text variant="caption">
                {resident?.email || account?.email || resident?.phone || ""}
              </Text>
            </View>

            {resident ? <StatusPill status={resident.status} /> : null}
          </View>

          {profile?.hostel ? (
            <View className="gap-2 border-t border-border pt-3">
              <Text variant="label">{profile.hostel.name}</Text>

              {/*
                Chips rather than a joined sentence, matching the dashboard's
                hostel card — and the phone number becomes a tap-to-call, which
                is the whole reason a phone shows contact details at all.
              */}
              <View className="flex-row flex-wrap gap-2">
                <Chip
                  icon="bed-outline"
                  label={humanizeEnum(profile.accommodation.roomType)}
                />
                {resident ? (
                  <Chip
                    icon="calendar-outline"
                    label={`Since ${formatDate(resident.moveInDate)}`}
                  />
                ) : null}
                {profile.hostel.contact.phone ? (
                  <Chip
                    icon="call-outline"
                    label={profile.hostel.contact.phone}
                    onPress={() =>
                      void Linking.openURL(`tel:${profile.hostel?.contact.phone}`)
                    }
                    tone="brand"
                  />
                ) : null}
              </View>
            </View>
          ) : null}
        </Card>

        <View>
          <SectionHeader title="Your stay" />
          <Card>
            <ListRow
              icon="person-outline"
              onPress={() => router.push("/profile")}
              subtitle="Personal details, guardians, emergency contacts"
              title="Profile"
            />
            <RowDivider inset />
            <ListRow
              icon="moon-outline"
              onPress={() => router.push("/night-status")}
              subtitle={
                more.data?.nightStatus
                  ? humanizeEnum(more.data.nightStatus.status)
                  : "Tell your hostel you're in for the night"
              }
              title="Night status"
            />
            <RowDivider inset />
            {/*
              Directly under Night status, because they are the same subject from
              opposite ends: what the resident *says* about their night, and what
              their phone *reported*. A resident who wonders "how does my hostel
              know?" is looking at one of these two rows when the question occurs
              to them, and the answer should be the next one down.
            */}
            <ListRow
              icon="location-outline"
              onPress={() => router.push("/attendance")}
              subtitle="What has been recorded, and switching it off"
              title="Location & attendance"
            />
            <RowDivider inset />
            {/*
              Its own row rather than only a link inside Profile. Sharing your
              record with a parent is a decision people revisit — after a fee
              goes unpaid, after an argument — and having to remember it lives
              two screens deep under "Profile" is how a resident ends up leaving
              access switched on for somebody they meant to remove.
            */}
            <ListRow
              icon="shield-outline"
              onPress={() => router.push("/guardians")}
              subtitle="Who can see your record, and exactly what they see"
              title="Guardians"
            />
            <RowDivider inset />
            <ListRow
              icon="chatbox-ellipses-outline"
              onPress={() => router.push("/complaints")}
              subtitle="Raise an issue and follow it to resolution"
              title="Complaints"
            />
            <RowDivider inset />
            <ListRow
              icon="card-outline"
              onPress={() => router.push("/id-card")}
              subtitle="Your hostel identity card"
              title="Digital ID"
            />
            <RowDivider inset />
            {/*
              Under "Your stay" rather than "Discover": the programme is
              something a resident is already in, not something to go and find.
              `/offer-program` — the public explainer — stays where it is, on the
              Profile tab, because that one is written for somebody who has not
              signed in.
            */}
            <ListRow
              icon="ribbon-outline"
              onPress={() => router.push("/offer-program/mine")}
              subtitle="Your reference codes and certified receipts"
              title="Offer Program"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="Discover" />
          <Card>
            {/*
              Discovery lives here, not in a tab (agreed 2026-08-16): someone
              who already has a bed opens the app to pay rent or read a notice.
            */}
            <ListRow
              icon="search-outline"
              onPress={() => router.push("/hostels")}
              subtitle="Browse and compare hostels across Nepal"
              title="Explore hostels"
            />
            <RowDivider inset />
            {/*
              One community for everyone — signed out, public account, resident,
              staff — which is why it is a root-stack screen rather than something
              inside a role's tabs. See `community.service.ts`.
            */}
            <ListRow
              icon="people-outline"
              onPress={() => router.push("/community")}
              // Touch-down warms the feed and the spaces rail — see
              // `prefetchCommunity`. The tab shells warm it a few seconds after
              // launch; this covers the roles that reach it by a push instead.
              onPressIn={prefetchCommunity}
              subtitle="Ask, answer and see what other residents are saying"
              title="Community"
            />
            <RowDivider inset />
            <ListRow
              icon="gift-outline"
              onPress={() => router.push("/referrals")}
              subtitle="Share your code with a friend"
              title="Refer a friend"
            />
            <RowDivider inset />
            <ListRow
              icon="star-outline"
              onPress={() => router.push("/review")}
              subtitle="Rate food, cleanliness and safety"
              title="Review your hostel"
            />
          </Card>
        </View>

        <View>
          <SectionHeader title="App" />
          <Card>
            <ListRow
              icon={preference === "dark" ? "moon-outline" : "sunny-outline"}
              onPress={() => dispatch(setThemePreference(nextTheme))}
              subtitle={`Currently ${preference}`}
              title="Theme"
              value={`Switch to ${nextTheme}`}
            />
            <RowDivider inset />
            {/*
              Three rows, three destinations.

              This block used to be two rows that both pushed a bare
              `/settings` — two subtitles promising two different things, and one
              screen delivering whichever half happened to be scrolled to. Worse,
              the row *called* "Notifications" went to the preferences screen,
              so the notification **feed** had no entry point in this group at
              all; see the bell in this screen's app bar.

              So: the feed is its own row, and the two settings rows name their
              `section`, which is the parameter `app/settings.tsx` already reads
              to draw one half. Same fix, same reasoning as `(browse)/profile.tsx`.
            */}
            <ListRow
              icon="notifications-outline"
              onPress={() => router.push("/notifications")}
              subtitle="Everything your hostel and the platform have sent you"
              title="Notifications"
            />
            <RowDivider inset />
            <ListRow
              icon="options-outline"
              onPress={() =>
                router.push({
                  params: { section: "notifications" },
                  pathname: "/settings",
                })
              }
              // Was "…and why you cannot pick yet", which stopped being true
              // when the preference model shipped (§3.2). A row that describes
              // a screen it no longer matches is worse than no subtitle.
              subtitle="Choose what reaches you, and set quiet hours"
              title="Notification settings"
            />
            <RowDivider inset />
            <ListRow
              icon="shield-checkmark-outline"
              onPress={() =>
                router.push({
                  params: { section: "privacy" },
                  pathname: "/settings",
                })
              }
              subtitle="Your data, and closing your account"
              title="Privacy & your data"
            />
          </Card>
        </View>

        <Card>
          <ListRow
            icon="log-out-outline"
            onPress={signOut}
            right={
              <Ionicons
                color={colors.destructive}
                name={signingOut ? "hourglass-outline" : "chevron-forward"}
                size={18}
              />
            }
            title="Sign out"
          />
        </Card>
      </View>
    </Screen>
  );
}
