import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { type AdminResident, listAdminResidents } from "@/lib/admin-api";
import { formatDate, humanizeEnum } from "@/lib/format";

/**
 * The roster, read-only, with one useful action: call them.
 *
 * ## Why the search is client-side
 *
 * `residentListQuerySchema` takes a `q`, so a server search exists — but the
 * page this screen already holds is 50 rows, which is most hostels in full, and
 * a keystroke-per-request search over a hostel LAN feels worse than filtering
 * what is already in hand. A hostel large enough to page is a hostel whose
 * admin is at a desk; that is what the web portal link on More is for.
 *
 * ## No edit affordances
 *
 * Registering, moving in, moving out, changing status and issuing an activation
 * code are all real routes, and all of them want documents, a deposit figure or
 * a room assignment in front of you. A phone-sized version of any of them is a
 * way to make a mistake quickly.
 */
export default function AdminResidentsScreen() {
  const residents = useResource<AdminResident[]>(
    useCallback(() => listAdminResidents(), []),
    { topics: [REALTIME_TOPIC.RESIDENTS] },
  );

  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = residents.data ?? [];

    if (!needle) {
      return rows;
    }

    return rows.filter((resident) =>
      [resident.firstName, resident.lastName, resident.phone, resident.roomType]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, residents.data]);

  const header = <AppBar title="Residents" />;

  if (residents.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading the roster" />
      </Screen>
    );
  }

  if (residents.error || !residents.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={residents.error ?? "The resident list could not be loaded."}
          onRetry={residents.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={residents.refresh}
      refreshing={residents.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Input
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search by name, phone or room"
          value={query}
        />

        <View>
          <SectionHeader
            subtitle="Tap a row to call"
            title={`${visible.length} of ${residents.data.length}`}
          />
          <Card>
            {visible.length === 0 ? (
              <EmptyState
                description={
                  query
                    ? "No resident matches that."
                    : "Residents appear here once they are registered."
                }
                title="Nobody to show"
              />
            ) : (
              visible.map((resident, index) => (
                <View key={resident.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    onPress={
                      resident.phone
                        ? () => void Linking.openURL(`tel:${resident.phone}`)
                        : undefined
                    }
                    right={<StatusPill status={resident.status} />}
                    subtitle={[
                      humanizeEnum(resident.roomType),
                      resident.phone,
                      `Since ${formatDate(resident.moveInDate)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    title={`${resident.firstName} ${resident.lastName}`.trim()}
                  />
                </View>
              ))
            )}
          </Card>
        </View>

        <Text className="px-1" variant="caption">
          Registering, moving someone in or out, and issuing activation codes are done
          from the web portal — see the More tab.
        </Text>
      </View>
    </Screen>
  );
}
