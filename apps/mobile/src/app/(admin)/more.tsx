import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { type AdminHostel, getAdminHostel } from "@/lib/admin-api";
import { API_BASE_URL } from "@/lib/api";
import { endSession } from "@/lib/auth-session";
import { readableRole } from "@/constants/roles";
import { toastError } from "@/lib/toast";
import { webPortalUrl, type WebPortalKey } from "@/lib/web-portal";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * Where admin-lite stops and the desktop portal takes over.
 *
 * The rows below are not "coming soon" — every one of them is a screen that
 * exists and works on the web, and each is here because it wants a keyboard, a
 * wide table or a document in front of you. Opening the real thing in a browser
 * is a better answer than a cramped native re-implementation that can do two of
 * its nine columns.
 *
 * ## The URLs are tenant-scoped
 *
 * `/{slug}/admin/...`, built by `lib/web-portal.ts`. The hostel's slug comes
 * from `GET /hostel-admin/profile`; a warden scoped to more than one hostel
 * cannot resolve one without being asked which, so the links are hidden rather
 * than pointed at a guess.
 */
const PORTAL_ROWS: {
  icon: keyof typeof Ionicons.glyphMap;
  key: WebPortalKey;
  subtitle: string;
  title: string;
}[] = [
  {
    icon: "cash-outline",
    key: "finance",
    subtitle: "Invoices, fee schedules, billing runs and reconciliation",
    title: "Finance",
  },
  {
    icon: "people-outline",
    key: "residents",
    subtitle: "Register, move in and out, activation codes",
    title: "Residents",
  },
  {
    icon: "bed-outline",
    key: "rooms",
    subtitle: "Room types, capacity and occupancy",
    title: "Rooms",
  },
  {
    icon: "megaphone-outline",
    key: "notices",
    subtitle: "Publish a notice to residents or guardians",
    title: "Notices",
  },
  {
    icon: "restaurant-outline",
    key: "foodRoutine",
    subtitle: "The weekly menu and the cook portal",
    title: "Food",
  },
  {
    icon: "construct-outline",
    key: "maintenance",
    subtitle: "Requests, assignment and service providers",
    title: "Maintenance",
  },
  {
    icon: "bar-chart-outline",
    key: "reports",
    subtitle: "Payments, complaints, attendance and food reports",
    title: "Reports",
  },
  {
    icon: "settings-outline",
    key: "settings",
    subtitle: "Hostel profile, wardens and payment setup",
    title: "Settings",
  },
];

export default function AdminMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const hostel = useResource<AdminHostel | null>(
    useCallback(() => getAdminHostel().catch(() => null), []),
  );
  const [signingOut, setSigningOut] = useState(false);

  const slug = hostel.data?.slug ?? "";

  const openPortal = useCallback(
    async (key: WebPortalKey) => {
      if (!slug) {
        toastError(
          "No hostel selected",
          "This account covers more than one hostel, so the portal link cannot be resolved here.",
        );
        return;
      }

      await WebBrowser.openBrowserAsync(webPortalUrl(API_BASE_URL, slug, key));
    },
    [slug],
  );

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
      onRefresh={hostel.refresh}
      refreshing={hostel.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-1">
          <Text variant="subtitle">{hostel.data?.name ?? account?.name ?? "Your hostel"}</Text>
          <Text variant="caption">
            {[account ? readableRole(account.role) : null, account?.email]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {hostel.data?.location.city ? (
            <Text variant="caption">
              {[hostel.data.location.area, hostel.data.location.city]
                .filter(Boolean)
                .join(", ")}
            </Text>
          ) : null}
        </Card>

        <View>
          <SectionHeader
            subtitle="Opens the full portal in your browser"
            title="Manage on the web"
          />
          <Card>
            {PORTAL_ROWS.map((row, index) => (
              <View key={row.key}>
                {index > 0 ? <RowDivider inset /> : null}
                <ListRow
                  icon={row.icon}
                  onPress={() => void openPortal(row.key)}
                  subtitle={row.subtitle}
                  title={row.title}
                />
              </View>
            ))}
          </Card>
          {!slug ? (
            <Text className="px-1 pt-2" variant="caption">
              These links need a single hostel to open. Your account covers more than
              one, so open the portal from a browser and pick there.
            </Text>
          ) : null}
        </View>

        <View>
          <SectionHeader title="Discover" />
          <Card>
            <ListRow
              icon="search-outline"
              onPress={() => router.push("/(public)/hostels")}
              subtitle="See your listing the way a student does"
              title="Browse hostels"
            />
            <RowDivider inset />
            <ListRow
              icon="people-outline"
              onPress={() => router.push("/community")}
              subtitle="What residents are saying, platform-wide"
              title="Community"
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
              onPress={() => router.push("/notifications")}
              subtitle="Everything the platform has sent you"
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
