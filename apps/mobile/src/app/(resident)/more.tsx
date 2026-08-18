import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { endSession } from "@/lib/auth-session";
import { formatDate, humanizeEnum } from "@/lib/format";
import {
  getResidentNightStatus,
  type NightStatus,
  type ResidentProfile,
  getResidentProfile,
} from "@/lib/resident-api";
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

type MoreData = {
  nightStatus: NightStatus | null;
  profile: ResidentProfile;
};

async function loadMore(): Promise<MoreData> {
  const [profile, nightStatus] = await Promise.all([
    getResidentProfile(),
    getResidentNightStatus().catch(() => null),
  ]);

  return { nightStatus, profile };
}

export default function ResidentMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const more = useResource<MoreData>(useCallback(() => loadMore(), []));
  const [signingOut, setSigningOut] = useState(false);

  const profile = more.data?.profile;
  const resident = profile?.resident;

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your password to get back in.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          setSigningOut(true);
          void endSession().finally(() => router.replace("/(public)"));
        },
        style: "destructive",
        text: "Sign out",
      },
    ]);
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";

  return (
    <Screen
      header={<AppBar title="More" />}
      insideTabs
      onRefresh={more.refresh}
      refreshing={more.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <View
              className="h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.brandSoft }}
            >
              <Text className="text-xl font-semibold" style={{ color: colors.primary }}>
                {(resident?.firstName ?? account?.name ?? "?").charAt(0).toUpperCase()}
              </Text>
            </View>

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
            <View className="gap-1 border-t border-border pt-3">
              <Text variant="label">{profile.hostel.name}</Text>
              <Text variant="caption">
                {[
                  humanizeEnum(profile.accommodation.roomType),
                  resident ? `Since ${formatDate(resident.moveInDate)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
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
              onPress={() => router.push("/(public)/hostels")}
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
              One Settings screen holds theme, the notification position and the
              privacy/deletion panel, so both of these rows lead there rather than
              splitting one short screen in two.
            */}
            <ListRow
              icon="notifications-outline"
              onPress={() => router.push("/settings")}
              subtitle="What we send, and why you cannot pick yet"
              title="Notifications"
            />
            <RowDivider inset />
            <ListRow
              icon="shield-checkmark-outline"
              onPress={() => router.push("/settings")}
              subtitle="Privacy policy and account deletion"
              title="Privacy & account"
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
