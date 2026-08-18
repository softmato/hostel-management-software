import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Modal, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import type { useSos } from "@/hooks/use-sos";

/**
 * The countdown, the spinner and the outcome — everything `useSos` has to say.
 *
 * Presentational: it owns no timers and sends nothing, so the floating button
 * and the SOS screen can both render it over whatever they already have on
 * screen without either of them being able to fire a second alert.
 *
 * A `Modal` rather than an absolutely-positioned view, so it covers the tab bar
 * and the app bar too. A countdown that a stray tap on a tab can navigate away
 * from is not a countdown.
 */

export function SosOverlay({
  onSeeContacts,
  sos,
}: {
  /** Omitted on the SOS screen itself — the contacts are already behind it. */
  onSeeContacts?: () => void;
  sos: ReturnType<typeof useSos>;
}) {
  const { colors } = useAppTheme();
  const { cancel, close, error, outcome, phase, remaining } = sos;

  const failed = Boolean(error) || outcome?.tone === "unreached";
  const partial = !failed && outcome?.tone === "partial";

  return (
    <Modal
      animationType="fade"
      // Android's back button lands here. It must cancel, never dismiss
      // silently — a countdown still running behind a closed sheet is the worst
      // possible reading of a back press.
      onRequestClose={phase === "armed" ? cancel : close}
      statusBarTranslucent
      transparent
      visible={phase !== "idle"}
    >
      <View className="flex-1 items-center justify-center bg-black/80 px-8">
        {phase === "armed" ? (
          <View className="w-full items-center gap-6">
            <View
              className="h-36 w-36 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.destructive }}
            >
              <Text
                accessibilityLabel={`Sending in ${remaining} seconds`}
                className="text-6xl font-bold text-white"
              >
                {remaining}
              </Text>
            </View>

            <View className="gap-2">
              <Text className="text-center text-2xl font-semibold text-white">
                Sending an emergency alert
              </Text>
              <Text className="text-center text-base text-white/70">
                Hostel staff will be told immediately. You can&apos;t undo this
                once it goes.
              </Text>
            </View>

            {/*
              Full width and the only control on screen: cancelling has to be
              the easiest thing here, because the common reason for this overlay
              appearing at all is that nobody meant it to.
            */}
            <Button
              className="w-full"
              haptic={false}
              label="Cancel"
              onPress={cancel}
              size="lg"
              variant="secondary"
            />
          </View>
        ) : null}

        {phase === "sending" ? (
          <View className="items-center gap-4">
            <ActivityIndicator color="#ffffff" size="large" />
            <Text className="text-lg text-white">Sending your alert…</Text>
          </View>
        ) : null}

        {phase === "done" ? (
          <View className="w-full items-center gap-5">
            <Ionicons
              color={
                failed ? colors.destructive : partial ? colors.warning : colors.success
              }
              name={failed ? "alert-circle" : partial ? "warning" : "checkmark-circle"}
              size={56}
            />

            <View className="gap-2">
              <Text className="text-center text-2xl font-semibold text-white">
                {error ? "The alert didn't send" : (outcome?.title ?? "Alert sent")}
              </Text>
              <Text className="text-center text-base text-white/70">
                {error ?? outcome?.detail}
              </Text>
              {outcome?.callToAction ? (
                <Text className="mt-1 text-center text-base font-semibold text-white">
                  {outcome.callToAction}
                </Text>
              ) : null}
            </View>

            <View className="w-full gap-2">
              {/*
                Offered whenever the fan-out did not clearly work — those are
                exactly the moments a phone number beats another button.
              */}
              {onSeeContacts && outcome?.tone !== "reached" ? (
                <Button
                  className="w-full"
                  label="Emergency contacts"
                  onPress={onSeeContacts}
                  size="lg"
                  variant="danger"
                />
              ) : null}

              <Button
                className="w-full"
                label="Close"
                onPress={close}
                size="lg"
                variant="secondary"
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
