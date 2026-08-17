import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { readableRole } from "@/constants/roles";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { endSession } from "@/lib/auth-session";
import { toastInfo } from "@/lib/toast";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Profile, for someone who has an account but not a bed yet.
 *
 * Deliberately thin. There is no favourites collection, no saved-search
 * endpoint and no inquiry history endpoint for a public account on the server —
 * so the rows that would fill this screen out are the rows that would open onto
 * a permanent empty state. What is here is what exists: who you are signed in
 * as, the app's own settings, and the way out.
 *
 * Structure mirrors `(resident)/more.tsx` on purpose: one card per group, a
 * `ListRow` per entry, sign-out alone at the bottom in the destructive colour.
 */
export default function BrowseProfileScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const [signingOut, setSigningOut] = useState(false);

  const soon = useCallback((what: string) => {
    toastInfo(`${what} is coming`, "It lands in the next release.");
  }, []);

  const signOut = useCallback(() => {
    Alert.alert("Sign out?", "You'll need your password to get back in.", [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          setSigningOut(true);
          // Back to the signed-out stack, which is a different navigator — so
          // `replace`, not `back`.
          void endSession().finally(() => router.replace("/(public)"));
        },
        style: "destructive",
        text: "Sign out",
      },
    ]);
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";

  return (
    <Screen header={<AppBar title="Profile" />} insideTabs scroll>
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <View
              className="h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.brandSoft }}
            >
              <Text className="text-xl font-semibold" style={{ color: colors.primary }}>
                {(account?.name ?? "?").charAt(0).toUpperCase()}
              </Text>
            </View>

            <View className="flex-1">
              <Text variant="subtitle">{account?.name ?? "Your account"}</Text>
              <Text variant="caption">
                {account?.email || account?.phone || ""}
              </Text>
            </View>
          </View>

          <View className="border-t border-border pt-3">
            <Text variant="caption">
              {account
                ? `${readableRole(account.role)} account — you're browsing, not living in a hostel yet.`
                : "Signed out."}
            </Text>
          </View>
        </Card>

        <View>
          <SectionHeader title="Your search" />
          <Card>
            {/*
              Both of these are honest "not yet" rows rather than absent ones:
              the server has no favourites collection and no saved-search
              endpoint, and someone who cannot find them assumes the app lost
              their shortlist rather than never having had one.
            */}
            <ListRow
              icon="bookmark-outline"
              onPress={() => soon("Saved hostels")}
              subtitle="Shortlist hostels to come back to"
              title="Saved hostels"
            />
            <RowDivider inset />
            <ListRow
              icon="mail-outline"
              onPress={() => soon("Your inquiries")}
              subtitle="The hostels you've messaged"
              title="Inquiries"
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
