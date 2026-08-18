import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback } from "react";
import { Linking, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { formatDate, formatMoney, humanizeEnum } from "@/lib/format";
import { getResidentProfile, type ResidentProfile } from "@/lib/resident-api";

/**
 * Who the hostel thinks you are.
 *
 * ## Read-only, and it says so where it matters
 *
 * `GET /resident/profile` is the only route here. There is no resident-facing
 * write for any of it: not the personal details (`resident.service.ts`'s update is
 * staff-only), not the guardians (`/resident/guardians` is GET plus an *invite*,
 * which is its own flow), and not the emergency contacts — `/resident/emergency-contacts`
 * is GET-only and the sole `EmergencyContactModel.create` in the repo sits inside
 * admin resident creation. §1 of `docs/MOBILE_APP_PHASES.md` tracks both gaps.
 *
 * So no Edit button is drawn anywhere. Each section that a resident would
 * reasonably expect to edit says who can change it instead — the rule `app/sos.tsx`
 * set for the same contacts: an honest instruction beats a control the server
 * would ignore, because a silent control makes the user believe it worked.
 *
 * ## Phone numbers are tappable
 *
 * Same reasoning as the SOS screen. A number a resident has to memorise and
 * retype is a number nobody calls.
 */

export default function ProfileScreen() {
  const profile = useResource<ResidentProfile>(
    useCallback(() => getResidentProfile(), []),
  );

  const header = <AppBar showBack title="Profile" />;

  if (profile.loading) {
    return (
      <Screen header={header}>
        <LoadingState />
      </Screen>
    );
  }

  if (profile.error || !profile.data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={profile.error ?? "Your profile could not be loaded."}
          onRetry={profile.reload}
        />
      </Screen>
    );
  }

  const { accommodation, emergencyContacts, guardians, hostel, resident } =
    profile.data;

  return (
    <Screen
      header={header}
      onRefresh={profile.refresh}
      refreshing={profile.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <IdentityCard resident={resident} />

        <View>
          <SectionHeader
            subtitle="Your hostel's office keeps these up to date"
            title="Details"
          />
          <Card>
            <ListRow title="Full name" value={resident.fullName} />
            <RowDivider />
            <CallableRow label="Phone" value={resident.phone} />
            <RowDivider />
            <ListRow title="Email" value={resident.email || "—"} />
            <RowDivider />
            <ListRow title="Resident type" value={humanizeEnum(resident.residentType)} />
          </Card>
        </View>

        <View>
          <SectionHeader title="Your stay" />
          <Card>
            <ListRow title="Room type" value={humanizeEnum(accommodation.roomType)} />
            <RowDivider />
            <ListRow title="Moved in" value={formatDate(resident.moveInDate)} />
            <RowDivider />
            {/*
              The deposit is shown because a resident cannot otherwise find out
              what the hostel is holding — the finance screens are about invoices
              and the deposit is not one. `depositAmount` is on the resident row.
            */}
            <ListRow title="Deposit held" value={formatMoney(resident.depositAmount)} />
          </Card>
        </View>

        {hostel ? (
          <View>
            <SectionHeader title="Your hostel" />
            <Card>
              <ListRow
                onPress={() => router.push(`/hostel/${hostel.slug}`)}
                subtitle={
                  [hostel.location.area, hostel.location.city]
                    .filter(Boolean)
                    .join(", ") || undefined
                }
                title={hostel.name}
              />
              {hostel.contact.phone ? (
                <>
                  <RowDivider />
                  <CallableRow label="Office" value={hostel.contact.phone} />
                </>
              ) : null}
              {hostel.contact.email ? (
                <>
                  <RowDivider />
                  <ListRow title="Office email" value={hostel.contact.email} />
                </>
              ) : null}
            </Card>
          </View>
        ) : null}

        <PeopleSection
          /*
           * A guardian is an account with its own login and permissions, so the
           * fix for a wrong one is not an edit field — it is the invite flow the
           * hostel runs. Naming that is more use than a disabled Edit button.
           */
          emptyBody="Nobody is linked to your account. Your hostel can invite a parent or guardian, which gives them their own sign-in."
          emptyTitle="No guardians linked"
          footnote="Guardians are invited by your hostel and manage their own accounts."
          people={guardians.map((guardian) => ({
            id: guardian.id,
            isPrimary: guardian.isPrimary,
            name: `${guardian.firstName} ${guardian.lastName}`.trim(),
            phone: guardian.phone,
            relation: guardian.relation,
            subtitle: guardian.email || undefined,
          }))}
          title="Guardians"
        />

        <PeopleSection
          /* Same wording as `app/sos.tsx` — one gap, one explanation. */
          emptyBody="Your hostel records these when you move in. Ask the office to add someone — they can't be added from the app yet."
          emptyTitle="No contacts on file"
          footnote="These are who your hostel rings in an emergency. Only the office can change them."
          people={emergencyContacts.map((contact) => ({
            id: contact.id,
            isPrimary: contact.isPrimary,
            name: contact.name,
            phone: contact.phone,
            relation: contact.relation,
          }))}
          title="Emergency contacts"
        />
      </View>
    </Screen>
  );
}

function IdentityCard({ resident }: { resident: ResidentProfile["resident"] }) {
  const { colors } = useAppTheme();

  return (
    <Card className="flex-row items-center gap-3">
      <View
        className="h-16 w-16 items-center justify-center rounded-full"
        style={{ backgroundColor: colors.brandSoft }}
      >
        <Text className="text-2xl font-semibold" style={{ color: colors.primary }}>
          {resident.firstName.charAt(0).toUpperCase()}
        </Text>
      </View>

      <View className="flex-1 gap-1">
        <Text variant="subtitle">{resident.fullName}</Text>
        <Text variant="caption">{resident.email || resident.phone}</Text>
      </View>

      <StatusPill status={resident.status} />
    </Card>
  );
}

/** A row whose value dials it. */
function CallableRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();

  if (!value) {
    return <ListRow title={label} value="—" />;
  }

  return (
    <ListRow
      onPress={() => void Linking.openURL(`tel:${value}`)}
      right={
        <View className="flex-row items-center gap-1.5">
          <Text variant="muted">{value}</Text>
          <Ionicons color={colors.primary} name="call-outline" size={16} />
        </View>
      }
      title={label}
    />
  );
}

type Person = {
  id: string;
  isPrimary: boolean;
  name: string;
  phone: string;
  relation: string;
  subtitle?: string;
};

/**
 * Guardians and emergency contacts are the same shape on screen and the same
 * story underneath — a list the resident cannot edit — so they share a component
 * rather than two that drift.
 */
function PeopleSection({
  emptyBody,
  emptyTitle,
  footnote,
  people,
  title,
}: {
  emptyBody: string;
  emptyTitle: string;
  footnote: string;
  people: Person[];
  title: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View>
      <SectionHeader subtitle={footnote} title={title} />

      <Card>
        {people.length === 0 ? (
          // Not an `EmptyState` with an Add button: there is no endpoint to add
          // one. The honest instruction is who to ask.
          <View className="gap-1 py-2">
            <Text variant="label">{emptyTitle}</Text>
            <Text variant="caption">{emptyBody}</Text>
          </View>
        ) : (
          people.map((person, index) => (
            <View key={person.id}>
              {index > 0 ? <RowDivider /> : null}

              <Pressable
                accessibilityHint={person.phone ? `Calls ${person.phone}` : undefined}
                accessibilityLabel={
                  person.phone ? `Call ${person.name}` : person.name
                }
                accessibilityRole="button"
                className="min-h-14 flex-row items-center gap-3 py-3 active:opacity-70"
                disabled={!person.phone}
                onPress={() => void Linking.openURL(`tel:${person.phone}`)}
              >
                <View
                  className="h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: colors.muted }}
                >
                  <Ionicons
                    color={colors.mutedForeground}
                    name="person-outline"
                    size={18}
                  />
                </View>

                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text variant="label">{person.name}</Text>
                    {person.isPrimary ? <Badge label="Primary" /> : null}
                  </View>
                  <Text variant="caption">
                    {[humanizeEnum(person.relation), person.subtitle]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>

                {person.phone ? (
                  <View className="flex-row items-center gap-1.5">
                    <Text variant="muted">{person.phone}</Text>
                    <Ionicons color={colors.primary} name="call-outline" size={16} />
                  </View>
                ) : null}
              </Pressable>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
