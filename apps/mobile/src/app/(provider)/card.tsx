import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { formatDate, humanizeEnum } from "@/lib/format";
import { getOwnProvider, type ProviderApplication } from "@/lib/provider-api";

/**
 * The provider's own record, and the door to their platform ID card.
 *
 * ## Two different cards, and only one of them lives here
 *
 * The *platform* ID card — the printable document with the QR, shared by
 * residents, owners and providers alike — is `app/id-card/`, and it already
 * renders the `SERVICE_PROVIDER` variant off `identity.cardType`. Rebuilding it
 * here would be a second renderer for the same document, which is how the two
 * drift apart. So this screen shows the *application*: what the platform holds
 * about this provider and whether it has been approved, with a row through to
 * the card itself.
 *
 * ## The status tag is the point of the screen
 *
 * `PENDING_APPROVAL` is not a soft state: an unapproved provider gets an empty
 * job list from the server, because `listOwnServiceProviderJobs` filters on an
 * APPROVED record. Without this tag, "no jobs yet" and "your application has
 * not been reviewed" look identical — the same empty-versus-denied confusion
 * the guardian screens are built to avoid.
 */
const STATUS_TONE = {
  APPROVED: "success",
  HIDDEN: "neutral",
  INACTIVE: "neutral",
  PENDING_APPROVAL: "warning",
  REJECTED: "danger",
} as const;

const STATUS_NOTE: Record<ProviderApplication["status"], string> = {
  APPROVED: "Hostels can find you and assign you work.",
  HIDDEN: "Your listing is hidden from hostels. Contact support to restore it.",
  INACTIVE: "Your listing is inactive, so no new work will be assigned.",
  PENDING_APPROVAL:
    "The platform is reviewing your application. Jobs cannot be assigned to you until it is approved, so an empty Jobs tab is expected until then.",
  REJECTED: "Your application was not approved.",
};

export default function ProviderCardScreen() {
  const provider = useResource<ProviderApplication | null>(
    useCallback(() => getOwnProvider(), []),
  );

  const header = <AppBar title="My card" />;

  if (provider.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading your record" />
      </Screen>
    );
  }

  if (provider.error) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState message={provider.error} onRetry={provider.reload} />
      </Screen>
    );
  }

  const record = provider.data;

  if (!record) {
    return (
      <Screen header={header} insideTabs scroll>
        <Card>
          <EmptyState
            description="This account has no service provider application on file. Apply from the website to be listed."
            title="Not registered as a provider"
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={provider.refresh}
      refreshing={provider.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text variant="subtitle">{record.fullName}</Text>
              <Text variant="caption">
                {[humanizeEnum(record.category), record.area, record.city]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Badge
              label={humanizeEnum(record.status)}
              tone={STATUS_TONE[record.status]}
            />
          </View>

          <Text variant="muted">{STATUS_NOTE[record.status]}</Text>

          {record.status === "REJECTED" && record.rejectionReason ? (
            <View className="border-t border-border pt-3">
              <Text variant="label">Why</Text>
              <Text variant="muted">{record.rejectionReason}</Text>
            </View>
          ) : null}
        </Card>

        <View>
          <SectionHeader title="What the platform holds" />
          <Card>
            <ListRow title="Phone" value={record.phone} />
            <RowDivider />
            <ListRow title="Email" value={record.email || "—"} />
            <RowDivider />
            <ListRow
              title="Services"
              value={record.categories.map(humanizeEnum).join(", ") || "—"}
            />
            <RowDivider />
            <ListRow title="Availability" value={record.availability || "—"} />
            <RowDivider />
            <ListRow title="Experience" value={record.experience || "—"} />
            <RowDivider />
            <ListRow title="Documents on file" value={String(record.documentCount)} />
            {record.submittedAt ? (
              <>
                <RowDivider />
                <ListRow title="Applied" value={formatDate(record.submittedAt)} />
              </>
            ) : null}
          </Card>
          <Text className="px-1 pt-2" variant="caption">
            Changing any of this is done from the website — the application is a
            reviewed document, not a profile you edit in place.
          </Text>
        </View>

        <Card>
          <ListRow
            icon="card-outline"
            onPress={() => router.push("/id-card")}
            subtitle="The printable card with your QR, shared across the platform"
            title="Your ID card"
          />
        </Card>
      </View>
    </Screen>
  );
}
