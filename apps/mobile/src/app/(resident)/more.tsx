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
import { toastInfo } from "@/lib/toast";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Everything that is not a tab.
 *
 * ## Entries whose screens do not exist yet say so
 *
 * Complaints, SOS, the digital ID card, referrals, reviews and community are
 * M5. They are listed here — a resident should be able to see the product has
 * them — but tapping one says which release it lands in rather than opening a
 * blank screen. A row that navigates nowhere is indistinguishable from a bug;
 * a row that explains itself is a roadmap.
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

  const soon = useCallback((what: string) => {
    toastInfo(`${what} is coming`, "It lands in the next release.");
  }, []);

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
              onPress={() => soon("Your profile")}
              subtitle="Personal details, guardians, emergency contacts"
              title="Profile"
            />
            <RowDivider inset />
            <ListRow
              icon="moon-outline"
              onPress={() => soon("Night status")}
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
              onPress={() => soon("Complaints")}
              subtitle="Raise an issue and follow it to resolution"
              title="Complaints"
            />
            <RowDivider inset />
            <ListRow
              icon="card-outline"
              onPress={() => soon("Your ID card")}
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
            <ListRow
              icon="gift-outline"
              onPress={() => soon("Referrals")}
              subtitle="Share your code with a friend"
              title="Refer a friend"
            />
            <RowDivider inset />
            <ListRow
              icon="star-outline"
              onPress={() => soon("Reviews")}
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
            <ListRow
              icon="notifications-outline"
              onPress={() => soon("Notification settings")}
              subtitle="Choose what buzzes your phone"
              title="Notifications"
            />
            <RowDivider inset />
            <ListRow
              icon="shield-checkmark-outline"
              onPress={() => soon("Privacy & account settings")}
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
