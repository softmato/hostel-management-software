import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { readableRole } from "@/constants/roles";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import { endSession } from "@/lib/auth-session";
import { absoluteMediaUrl } from "@/lib/media";
import { toastInfo } from "@/lib/toast";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Profile, for someone who has an account but not a bed yet.
 *
 * Deliberately thin. There is no favourites collection and no inquiry history
 * endpoint for a public account on the server, so the rows that would fill this
 * screen out are the rows that would open onto a permanent empty state. What is
 * here is what exists: who you are signed in as, the app's own settings, and the
 * way out.
 *
 * Structure mirrors `(resident)/more.tsx` on purpose: one card per group, a
 * `ListRow` per entry, sign-out alone at the bottom in the destructive colour.
 *
 * ## Two rows here were lying (§5.6)
 *
 * **Saved hostels** toasted "it lands in the next release" — while `lib/saved-
 * hostels.ts` was already storing them and the Home tab was already rendering
 * the row. The feature shipped and this screen never found out.
 *
 * **Notifications** and **Privacy** did the same, and `/settings` has held real
 * per-category preferences and quiet hours since §3.2. Its routes take
 * `requireApiPrincipal`, not a resident principal, so a browsing account reaches
 * them exactly like anybody else.
 *
 * `soon()` survives for **Inquiries** alone, which genuinely has no endpoint:
 * `/public/inquiries` is a POST and nothing lists what you have sent.
 */
export default function BrowseProfileScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const saved = useAppSelector((state) => state.saved.items);
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
            {/* The shared component, which also handles a Google photo and a
                photo URL that exists but cannot be drawn. */}
            <Avatar
              name={account?.name}
              size="lg"
              uri={absoluteMediaUrl(account?.image, API_BASE_URL)}
            />

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
              Saved hostels are real and **device-local** — the subtitle says so,
              because a shortlist that does not follow you to another phone is
              worth knowing about before you build one. Home is where they are
              rendered; there is no separate screen to send anyone to, and one
              holding the same list twice is a second place for it to go stale.
            */}
            <ListRow
              icon="bookmark-outline"
              onPress={() => router.push("/(browse)")}
              right={
                saved.length > 0 ? (
                  <Badge label={String(saved.length)} tone="success" />
                ) : undefined
              }
              subtitle={
                saved.length > 0
                  ? "Kept on this device — shown on Home"
                  : "Tap the heart on a hostel to shortlist it"
              }
              title="Saved hostels"
            />
            <RowDivider inset />
            {/*
              The one honest "not yet" left. `/public/inquiries` is a POST and
              nothing lists what you have sent, so this row would open onto a
              permanent empty state.
            */}
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
            {/*
              Both reach the real screen. They toasted "coming soon" for months
              after §3.2 shipped the preference model — the settings routes take
              `requireApiPrincipal`, so a browsing account has always been able
              to use them.
            */}
            <ListRow
              icon="notifications-outline"
              onPress={() => router.push("/settings")}
              subtitle="Choose what reaches you, and set quiet hours"
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
