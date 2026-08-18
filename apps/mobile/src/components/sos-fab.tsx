import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Pressable } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { useBottomChrome } from "@/components/bottom-chrome";
import { SosOverlay } from "@/components/sos-overlay";
import { TAB_BAR_HEIGHT } from "@/components/tab-bar";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSos } from "@/hooks/use-sos";
import { useSystemInsets } from "@/hooks/use-system-insets";

/**
 * The SOS control, on every resident screen.
 *
 * Rendered once by `(resident)/_layout.tsx` beside the tab navigator rather
 * than by each screen, so there is exactly one of it and no screen can forget
 * it. It is not a tab (§M5): a tab would spend a fifth of the bar on something
 * pressed once a year, and would put an emergency control somewhere it can be
 * *browsed to* by accident.
 *
 * ## Two gestures, because they are two different situations
 *
 * - **Tap** opens `/sos`: add a note, choose whether guardians hear about it,
 *   and see the numbers to call. "Something is wrong and I have a moment."
 * - **Long press** arms the countdown straight away, guardians included. The
 *   panic path, and deliberately a sustained press — a button that alerts a
 *   whole hostel on one tap alerts it from inside a pocket.
 *
 * ## It hides on scroll, with the rest of the bottom chrome
 *
 * Per the shell contract in `MOBILE_APP_PHASES.md` §0, which names this button
 * specifically. It costs little in reachability: six pixels of upward scroll
 * bring it back, against sixteen to hide it.
 */

const FAB_SIZE = 56;

export function SosFab() {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();
  const chrome = useBottomChrome();
  const sos = useSos();

  const fabStyle = useAnimatedStyle(() => {
    const progress = chrome?.progress.value ?? 0;

    return {
      opacity: 1 - progress,
      transform: [{ translateY: progress * (FAB_SIZE + insets.bottom + 24) }],
    };
  });

  return (
    <>
      <Animated.View
        className="absolute right-5"
        pointerEvents="box-none"
        style={[{ bottom: TAB_BAR_HEIGHT + insets.bottom + 16 }, fabStyle]}
      >
        <Pressable
          accessibilityHint="Opens emergency options. Press and hold to send an alert straight away."
          accessibilityLabel="Emergency SOS"
          accessibilityRole="button"
          className="items-center justify-center rounded-full active:opacity-85"
          delayLongPress={600}
          onLongPress={() => sos.arm({ guardianAlertEnabled: true })}
          onPress={() => {
            void Haptics.selectionAsync();
            router.push("/sos");
          }}
          style={{
            backgroundColor: colors.destructive,
            elevation: 8,
            height: FAB_SIZE,
            shadowColor: "#000",
            shadowOffset: { height: 4, width: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 10,
            width: FAB_SIZE,
          }}
        >
          <Text className="text-sm font-bold tracking-wide text-white">SOS</Text>
        </Pressable>
      </Animated.View>

      <SosOverlay
        onSeeContacts={() => {
          sos.close();
          router.push("/sos");
        }}
        sos={sos}
      />
    </>
  );
}
