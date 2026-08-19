import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { endSession } from "@/lib/auth-session";
import { formatDate } from "@/lib/format";
import {
  GUARDIAN_PERMISSION_LABELS,
  permissionsOf,
  sharedSections,
} from "@/lib/guardian";
import { type GuardianDashboard, getGuardianDashboard } from "@/lib/guardian-api";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * The guardian's own account, and — the reason this tab is worth a slot — an
 * itemised list of what they can and cannot see.
 *
 * A guardian who does not know a section exists reads its absence as the app
 * being thin. A guardian who is told "night status is not shared" knows to ask
 * their ward rather than the hostel. That list belongs here, on the account
 * screen, and nowhere else: repeating it beside each hidden section would turn
 * the resident's private choices into six prompts to argue about.
 */
export default function GuardianMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const guardian = useResource<GuardianDashboard>(
    useCallback(() => getGuardianDashboard(), []),
  );
  const [signingOut, setSigningOut] = useState(false);

  const dashboard = guardian.data;
  const permissions = permissionsOf(dashboard);
  const granted = sharedSections(dashboard);
  const keys = Object.keys(GUARDIAN_PERMISSION_LABELS) as (keyof typeof permissions)[];

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
      header={<AppBar title="More" />}
      insideTabs
      onRefresh={guardian.refresh}
      refreshing={guardian.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-1">
          <Text variant="subtitle">
            {dashboard?.guardian.name ?? account?.name ?? "Your account"}
          </Text>
          <Text variant="caption">
            {[dashboard?.guardian.relation, dashboard?.guardian.phone ?? account?.email]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {dashboard?.hostel ? (
            <Text className="pt-2" variant="caption">
              {`Guardian at ${dashboard.hostel.name}`}
            </Text>
          ) : null}
        </Card>

        <View>
          <SectionHeader
            subtitle={`${granted.length} of ${keys.length} shared by ${
              dashboard?.resident.fullName ?? "your ward"
            }`}
            title="What you can see"
          />
          <Card>
            {keys.map((key, index) => (
              <View key={key}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  right={
                    <Badge
                      label={permissions[key] ? "Shared" : "Private"}
                      tone={permissions[key] ? "success" : "neutral"}
                    />
                  }
                  title={GUARDIAN_PERMISSION_LABELS[key]}
                />
              </View>
            ))}
          </Card>
          <Text className="px-1 pt-2" variant="caption">
            Only the resident can change these, from their own portal. The hostel cannot
            grant them on your behalf.
          </Text>
        </View>

        {dashboard?.access ? (
          <View>
            <SectionHeader title="Your access" />
            <Card>
              <ListRow title="Access code" value={dashboard.access.accessCode} />
              <RowDivider />
              {/*
                Guardian access is time-boxed by the hostel, and the expiry is
                the one thing that will silently end this account. Better read
                here than discovered at a locked screen.
              */}
              <ListRow
                title="Expires"
                value={formatDate(dashboard.access.expiresAt)}
              />
            </Card>
          </View>
        ) : null}

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
