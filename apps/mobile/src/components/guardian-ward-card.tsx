import { Linking, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { humanizeEnum } from "@/lib/format";
import type { GuardianDashboard } from "@/lib/guardian-api";

/**
 * Who the guardian is looking at, and how to reach the hostel about them.
 *
 * Shared by Home and Safety because it is the same block on both — the web's
 * two pages each draw their own copy of it, which is why the ward's name was
 * rendered wrong in two places at once.
 *
 * **Everything here is ungated.** Name, room, status, hostel and the office's
 * phone number are what a guardian account is *for*; the six permission flags
 * govern the sections below it, not this. See `lib/guardian.ts`.
 */
export function GuardianWardCard({
  dashboard,
  showCall = true,
}: {
  dashboard: GuardianDashboard;
  showCall?: boolean;
}) {
  const phone = dashboard.hostel?.contact.phone ?? "";

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-3">
        <Avatar name={dashboard.resident.fullName} size="lg" />

        <View className="flex-1 gap-0.5">
          <Text variant="subtitle">{dashboard.resident.fullName}</Text>
          <Text variant="caption">
            {[dashboard.hostel?.name, humanizeEnum(dashboard.resident.roomType)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text variant="caption">
            {`You are their ${dashboard.guardian.relation.toLowerCase()}`}
          </Text>
        </View>

        <StatusPill status={dashboard.resident.status} />
      </View>

      {/*
        Only when a number exists. The web drew a "24/7 Emergency Helpline"
        headline over a button that dialled nobody; a hostel that never filled
        in its contact details gets no button at all rather than a dead one.
      */}
      {showCall && phone ? (
        <View className="border-t border-border pt-3">
          <Button
            label={`Call ${dashboard.hostel?.name ?? "the hostel"}`}
            onPress={() => void Linking.openURL(`tel:${phone}`)}
            variant="outline"
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Stands in for a section the resident has not shared.
 *
 * Used **once per screen at most**, never per section: the point of gating is
 * that an ungranted section is absent, so a list of six "not shared" cards
 * would reinstate exactly the leak the gating prevents — it tells the guardian
 * what exists behind each flag and invites them to press the resident about it.
 * A screen whose entire subject is ungranted says so, plainly, and stops.
 */
export function GuardianNotShared({
  subject,
  wardName,
}: {
  /** Lower-case noun phrase: "fees and dues", "night status". */
  subject: string;
  wardName: string;
}) {
  return (
    <Card className="gap-2">
      <Text variant="subtitle">Not shared with you</Text>
      <Text variant="muted">
        {`${wardName} has not shared ${subject} with this guardian account. They can change that from their own portal.`}
      </Text>
    </Card>
  );
}
