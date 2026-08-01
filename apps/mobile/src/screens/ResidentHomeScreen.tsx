import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  getResidentDashboard,
  logout,
  type ResidentDashboard,
} from "../api/client";
import { clearSession } from "../auth/token-store";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { screenStyles } from "./styles";

type Props = NativeStackScreenProps<RootStackParamList, "ResidentHome">;

function money(value: number) {
  return `NPR ${value.toLocaleString()}`;
}

export function ResidentHomeScreen({ navigation, route }: Props) {
  const { session } = route.params;
  const [dashboard, setDashboard] = useState<ResidentDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await getResidentDashboard(session.accessToken);

      setDashboard(data.dashboard);
    } catch (error) {
      Alert.alert(
        "Could not load dashboard",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleLogout() {
    try {
      await logout(session.refreshToken);
    } catch {
      Alert.alert(
        "Logged out locally",
        "The server session could not be reached.",
      );
    } finally {
      await clearSession();
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    }
  }

  return (
    <ScrollView contentContainerStyle={screenStyles.scrollContent}>
      <View>
        <Text style={screenStyles.title}>Resident dashboard</Text>
        <Text style={screenStyles.body}>Signed in as {session.user.name}.</Text>
      </View>

      {isLoading ? <ActivityIndicator color="#10b981" /> : null}

      {dashboard ? (
        <>
          <View style={screenStyles.card}>
            <Text style={screenStyles.sectionTitle}>
              {dashboard.hostel?.name ?? "Hostel"}
            </Text>
            <Text style={screenStyles.body}>
              Room {dashboard.roomBed.room?.roomNumber ?? "-"} / Bed{" "}
              {dashboard.roomBed.bed?.bedNumber ?? "-"}
            </Text>
            <Text style={screenStyles.meta}>
              {dashboard.hostel?.location?.area}{" "}
              {dashboard.hostel?.location?.city}
            </Text>
          </View>

          <View style={screenStyles.card}>
            <View style={screenStyles.row}>
              <Text style={screenStyles.sectionTitle}>Fee status</Text>
              <Text style={screenStyles.chip}>
                {dashboard.feeStatus.unpaidCount} due
              </Text>
            </View>
            <Text style={screenStyles.body}>
              Outstanding {money(dashboard.feeStatus.dueAmount)}
            </Text>
            <Text style={screenStyles.meta}>
              Pending proofs: {dashboard.feeStatus.pendingProofs}
            </Text>
          </View>

          <View style={screenStyles.card}>
            <Text style={screenStyles.sectionTitle}>Today's menu</Text>
            {dashboard.foodMenu.length === 0 ? (
              <Text style={screenStyles.body}>No menu posted.</Text>
            ) : (
              dashboard.foodMenu.slice(0, 3).map((meal) => (
                <Text key={meal.mealType} style={screenStyles.body}>
                  {meal.mealType}: {meal.items.join(", ")}
                </Text>
              ))
            )}
          </View>

          <View style={screenStyles.card}>
            <Text style={screenStyles.sectionTitle}>Recent notices</Text>
            {dashboard.notices.length === 0 ? (
              <Text style={screenStyles.body}>No notices.</Text>
            ) : (
              dashboard.notices.slice(0, 3).map((notice) => (
                <Text key={notice.id} style={screenStyles.body}>
                  {notice.title}
                </Text>
              ))
            )}
          </View>
        </>
      ) : null}

      <View style={screenStyles.filterRow}>
        {[
          ["ResidentProfile", "Profile"],
          ["ResidentPayments", "Payments"],
          ["ResidentFood", "Food"],
          ["ResidentNotices", "Notices"],
          ["ResidentComplaints", "Complaints"],
          ["ResidentNightStatus", "Status"],
          ["ResidentSOS", "SOS"],
          ["ResidentReviews", "Reviews"],
          ["ResidentReferral", "Referral"],
          ["ResidentNotifications", "Alerts"],
        ].map(([screen, label]) => (
          <TouchableOpacity
            key={screen}
            onPress={() => {
              if (screen === "ResidentProfile") {
                navigation.navigate("ResidentProfile", { session });
              }

              if (screen === "ResidentPayments") {
                navigation.navigate("ResidentPayments", { session });
              }

              if (screen === "ResidentFood") {
                navigation.navigate("ResidentFood", { session });
              }

              if (screen === "ResidentNotices") {
                navigation.navigate("ResidentNotices", { session });
              }

              if (screen === "ResidentComplaints") {
                navigation.navigate("ResidentComplaints", { session });
              }

              if (screen === "ResidentNightStatus") {
                navigation.navigate("ResidentNightStatus", { session });
              }

              if (screen === "ResidentSOS") {
                navigation.navigate("ResidentSOS", { session });
              }

              if (screen === "ResidentReviews") {
                navigation.navigate("ResidentReviews", { session });
              }

              if (screen === "ResidentReferral") {
                navigation.navigate("ResidentReferral", { session });
              }

              if (screen === "ResidentNotifications") {
                navigation.navigate("ResidentNotifications", { session });
              }
            }}
            style={[screenStyles.button, { flex: 1, minHeight: 44 }]}
          >
            <Text style={screenStyles.buttonText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        onPress={handleLogout}
        style={[screenStyles.button, screenStyles.buttonSecondary]}
      >
        <Text style={screenStyles.buttonTextSecondary}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
