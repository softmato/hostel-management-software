import { Ionicons } from "@expo/vector-icons";
import { useCallback } from "react";
import { Linking, View } from "react-native";

import { GuardianNotShared, GuardianWardCard } from "@/components/guardian-ward-card";
import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { canSee } from "@/lib/guardian";
import { type GuardianDashboard, getGuardianDashboard } from "@/lib/guardian-api";

/**
 * Night status, and the promise that comes with it.
 *
 * ## Two things this screen deliberately does not show
 *
 * **A time.** `safety.asOf` is a date because the serializer truncates it —
 * PHASES.md §4.1 treats the exact minute a resident was checked as
 * surveillance, not reassurance. The web page rendered `new Date(...)
 * .toLocaleString()` off a field that did not exist and printed "Invalid Date";
 * neither the bug nor the intent survives here.
 *
 * **An all-clear.** The web drew an "Emergency Status: Normal — no active
 * alerts" tile, and the guardian payload contains no SOS field of any kind, so
 * it printed "Normal" whether or not an alert was live. Telling a parent there
 * is no emergency without having asked is the one thing this screen must never
 * do, so the tile is gone rather than reworded.
 *
 * ## One contact card, not the web's two (§5.2)
 *
 * The web has a "Warden / Hostel In-charge" section and a "Hostel Emergency
 * Contact" section, and both render the **same** `hostel.contact.phone` — there
 * is no warden field in the guardian payload. Two cards offering one number
 * reads as two escalation routes and is one, so this screen keeps a single card
 * and adds the address and email the payload also carries.
 */
export default function GuardianSafetyScreen() {
  const { colors } = useAppTheme();
  const guardian = useResource<GuardianDashboard>(
    useCallback(() => getGuardianDashboard(), []),
    { topics: [REALTIME_TOPIC.SAFETY, REALTIME_TOPIC.COMPLAINTS, REALTIME_TOPIC.NOTICES] },
  );

  const header = <AppBar title="Safety" />;

  if (guardian.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading safety summary" />
      </Screen>
    );
  }

  if (guardian.error || !guardian.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={guardian.error ?? "The safety summary could not be loaded."}
          onRetry={guardian.reload}
        />
      </Screen>
    );
  }

  const dashboard = guardian.data;
  const phone = dashboard.hostel?.contact.phone ?? "";
  const email = dashboard.hostel?.contact.email ?? "";
  const address = [
    dashboard.hostel?.location.address,
    dashboard.hostel?.location.area,
    dashboard.hostel?.location.city,
  ]
    .filter(Boolean)
    .join(", ");
  const safety = canSee(dashboard, "canViewSafety") ? dashboard.safety : null;

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={guardian.refresh}
      refreshing={guardian.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <GuardianWardCard dashboard={dashboard} showCall={false} />

        {safety ? (
          <Card className="gap-3">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="label">Current status</Text>
              <StatusPill status={safety.status} />
            </View>
            <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
              <Text variant="muted">Last update</Text>
              {/* Day only. Never derive a time from this. */}
              <Text variant="label">{safety.asOf ?? "Not verified"}</Text>
            </View>
            <Text variant="caption">Marked by the hostel. Day only, never a time.</Text>
          </Card>
        ) : (
          <GuardianNotShared
            subject="night status"
            wardName={dashboard.resident.fullName}
          />
        )}

        {/*
          The privacy promise, kept from the web page word for word: it is the
          single most-read paragraph on a guardian screen and the reason the
          product can offer this tab at all.
        */}
        <Card className="gap-2">
          <View className="flex-row items-center gap-2">
            <Ionicons color={colors.warning} name="lock-closed-outline" size={18} />
            <Text variant="label">No GPS tracking. No location history.</Text>
          </View>
          <Text variant="muted">
            We do not track or share live location. Status is updated only by hostel
            staff, and shown to you as a day rather than a time.
          </Text>
        </Card>

        <View>
          <SectionHeader
            subtitle="For anything urgent, call the office"
            title="Hostel contact"
          />
          <Card className="gap-3">
            <View className="gap-1">
              <Text variant="label">{dashboard.hostel?.name ?? "Hostel office"}</Text>
              <Text variant="caption">{phone || "No number on file"}</Text>
            </View>

            {/*
              The address and the email, which the payload carries and this card
              did not show. A parent whose child is not answering wants to know
              where the building is, and that is exactly the moment they should
              not have to go looking for it.
            */}
            {address || email ? (
              <View className="flex-row flex-wrap gap-2">
                {address ? <Chip icon="location-outline" label={address} /> : null}
                {email ? (
                  <Chip
                    icon="mail-outline"
                    label={email}
                    onPress={() => void Linking.openURL(`mailto:${email}`)}
                  />
                ) : null}
              </View>
            ) : null}

            {phone ? (
              <View className="flex-row gap-2">
                <Button
                  className="flex-1"
                  label="Call"
                  onPress={() => void Linking.openURL(`tel:${phone}`)}
                />
                <Button
                  className="flex-1"
                  label="Message"
                  onPress={() => void Linking.openURL(`sms:${phone}`)}
                  variant="outline"
                />
              </View>
            ) : null}
          </Card>
        </View>

        {canSee(dashboard, "canViewComplaintStatus") ? (
          <View>
            <SectionHeader
              subtitle="Status only — never what they wrote"
              title="Open with the hostel"
            />
            <Card>
              {dashboard.complaints.length === 0 ? (
                <EmptyState
                  description={`${dashboard.resident.fullName} has not raised anything.`}
                  title="Nothing open"
                />
              ) : (
                dashboard.complaints.map((complaint, index) => (
                  <View key={complaint.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={<StatusPill status={complaint.status} />}
                      title={complaint.title}
                    />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}

        {canSee(dashboard, "canViewNotices") ? (
          <View>
            <SectionHeader title="Guardian-visible notices" />
            <Card>
              {dashboard.notices.length === 0 ? (
                <EmptyState
                  description="Notices addressed to guardians appear here."
                  title="No notices"
                />
              ) : (
                dashboard.notices.map((notice, index) => (
                  <View key={notice.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      right={
                        notice.isUrgent ? <Badge label="Urgent" tone="danger" /> : undefined
                      }
                      subtitle={notice.content}
                      title={notice.title}
                    />
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
