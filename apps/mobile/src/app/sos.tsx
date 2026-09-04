import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { Linking, Pressable, Switch, View } from "react-native";

import { SosOverlay } from "@/components/sos-overlay";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { useSos } from "@/hooks/use-sos";
import { type EmergencyContact, getEmergencyContacts } from "@/lib/safety-api";
import {
  SOS_COUNTDOWN_SECONDS,
  SOS_MESSAGE_MAX,
  sosMessagePayload,
  validateSosMessage,
} from "@/lib/sos";

/**
 * The considered half of SOS: a note, who hears about it, and the numbers to
 * ring. The floating button's long press is the other half and skips all of it.
 *
 * ## The phone numbers are the point of this screen
 *
 * They are listed first, above the alert control, and they are tappable. An app
 * alert depends on someone else's phone being charged, unlocked and in a
 * signal; a phone call does not. If this screen only ever gets someone to a
 * number faster, it has done its job.
 *
 * ## Contacts are read-only, and that is the server's shape
 *
 * `GET /resident/emergency-contacts` has no sibling POST or DELETE — the only
 * `EmergencyContactModel.create` in the repo is inside admin resident creation.
 * So there is no Add button here. Drawing one would be a control the server
 * ignores, and the resident would believe a number was saved that was not.
 */

function ContactRow({ contact }: { contact: EmergencyContact }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityHint={`Calls ${contact.phone}`}
      accessibilityLabel={`Call ${contact.name}`}
      accessibilityRole="button"
      className="min-h-14 flex-row items-center gap-3 py-3 active:opacity-70"
      onPress={() => {
        void Linking.openURL(`tel:${contact.phone}`);
      }}
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: `${colors.destructive}1A` }}
      >
        <Ionicons color={colors.destructive} name="call" size={18} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text variant="label">{contact.name}</Text>
          {contact.isPrimary ? (
            <View className="rounded-full bg-muted px-2 py-0.5">
              <Text variant="caption">Primary</Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption">
          {[contact.relation, contact.phone].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <Ionicons color={colors.destructive} name="chevron-forward" size={18} />
    </Pressable>
  );
}

export default function SosScreen() {
  const { colors } = useAppTheme();
  const sos = useSos();
  // The numbers on this screen are maintained by the hostel, so `safety` is the
  // only way they change while a resident is looking at them.
  const contacts = useResource(useCallback(() => getEmergencyContacts(), []), {
    topics: [REALTIME_TOPIC.SAFETY],
  });

  const [message, setMessage] = useState("");
  const [alertGuardians, setAlertGuardians] = useState(true);

  const messageError = validateSosMessage(message);
  const rows = contacts.data?.contacts ?? [];

  return (
    <Screen
      header={<AppBar showBack title="Emergency" />}
      onRefresh={contacts.refresh}
      refreshing={contacts.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle="Tap to call. A phone call does not need their app to be open."
            title="Your emergency contacts"
          />

          <Card>
            {contacts.loading ? (
              <LoadingState />
            ) : contacts.error ? (
              <ErrorState message={contacts.error} onRetry={contacts.reload} />
            ) : rows.length === 0 ? (
              /*
                Not an `EmptyState` with an Add button: there is no endpoint to
                add one. The honest instruction is who to ask.
              */
              <View className="gap-1 py-2">
                <Text variant="label">No contacts on file</Text>
                <Text variant="caption">
                  Your hostel records these when you move in. Ask the office to
                  add someone — they can&apos;t be added from the app yet.
                </Text>
              </View>
            ) : (
              rows.map((contact, index) => (
                <View key={contact.id}>
                  {index > 0 ? <RowDivider inset /> : null}
                  <ContactRow contact={contact} />
                </View>
              ))
            )}
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="Alerts hostel staff straight away, with your name and room."
            title="Send an alert"
          />

          <Card className="gap-4">
            <Input
              hint={`Optional. ${SOS_MESSAGE_MAX - message.trim().length} characters left.`}
              error={messageError}
              multiline
              numberOfLines={3}
              onChangeText={setMessage}
              placeholder="What's happening? (optional)"
              style={{ height: 76, textAlignVertical: "top" }}
              value={message}
            />

            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text variant="label">Also alert my guardians</Text>
                <Text variant="caption">
                  {/*
                    Named honestly: guardians are only reachable if the hostel
                    has registered one with contact details, and the fan-out
                    reports afterwards how many were actually told.
                  */}
                  Anyone your hostel has registered as a guardian for you.
                </Text>
              </View>

              <Switch
                onValueChange={setAlertGuardians}
                thumbColor={colors.background}
                trackColor={{ false: colors.border, true: colors.destructive }}
                value={alertGuardians}
              />
            </View>

            <Button
              disabled={Boolean(messageError)}
              haptic={false}
              label="Send emergency alert"
              onPress={() =>
                sos.arm({
                  guardianAlertEnabled: alertGuardians,
                  message: sosMessagePayload(message),
                })
              }
              size="lg"
              variant="danger"
            />

            <Text className="text-center" variant="caption">
              {`You'll get ${SOS_COUNTDOWN_SECONDS} seconds to cancel. Once it's sent, only hostel staff can close it.`}
            </Text>
          </Card>
        </View>
      </View>

      <SosOverlay sos={sos} />
    </Screen>
  );
}
