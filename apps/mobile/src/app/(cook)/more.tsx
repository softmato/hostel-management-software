import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { endSession } from "@/lib/auth-session";
import { collectDeviceInfo } from "@/lib/device-info";
import { setThemePreference } from "@/store/slices/uiSlice";

/**
 * The kitchen's account settings, and the one thing a shared login has to be
 * honest about.
 *
 * ## This device, named
 *
 * `provisionCookAccount` creates **one account per hostel** — kitchen staff
 * share a phone and a password, and per-announcement attribution comes from
 * `FoodReadyLog.deviceInfo` rather than separate logins (PHASES.md §3.1). So
 * "signed in as" is not a person, and showing an account name here would imply
 * an accountability the system does not have. What is true, and useful, is
 * which handset this is: it is the value stamped on every announcement sent
 * from here.
 *
 * There is no cook-side device registration endpoint to call — the fingerprint
 * is written by the first announcement — so this reads the same
 * `collectDeviceInfo()` the announce call sends rather than fetching anything.
 */
export default function CookMoreScreen() {
  const account = useAppSelector((state) => state.auth.account);
  const preference = useAppSelector((state) => state.ui.themePreference);
  const dispatch = useAppDispatch();
  const { colors } = useAppTheme();
  const [device, setDevice] = useState<Record<string, unknown> | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void collectDeviceInfo().then((info) => {
      if (!cancelled) {
        setDevice(info);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(() => {
    Alert.alert(
      "Sign out?",
      "This login is shared by the whole kitchen. You'll need the hostel's cook password to get back in.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            setSigningOut(true);
            void endSession().finally(() => router.replace("/(public)"));
          },
          style: "destructive",
          text: "Sign out",
        },
      ],
    );
  }, []);

  const nextTheme = preference === "dark" ? "light" : "dark";
  const deviceName = [device?.brand, device?.model].filter(Boolean).join(" ");
  const fingerprint = typeof device?.fingerprint === "string" ? device.fingerprint : "";

  return (
    <Screen header={<AppBar title="More" />} insideTabs scroll>
      <View className="gap-5 pt-1">
        <Card className="gap-1">
          <Text variant="subtitle">{account?.name ?? "Kitchen"}</Text>
          <Text variant="caption">
            This login is shared by the whole kitchen. Announcements are traced to the
            device that sent them, not to a person.
          </Text>
        </Card>

        <View>
          <SectionHeader
            subtitle="Stamped on every announcement sent from here"
            title="This device"
          />
          <Card>
            <ListRow title="Handset" value={deviceName || "Unknown"} />
            <RowDivider />
            <ListRow
              title="Fingerprint"
              value={fingerprint ? `${fingerprint.slice(0, 8)}…` : "Not available"}
            />
            <RowDivider />
            <ListRow
              title="App version"
              value={String(device?.appVersion ?? "—")}
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
              subtitle="Everything the platform has sent this account"
              title="Notifications"
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
