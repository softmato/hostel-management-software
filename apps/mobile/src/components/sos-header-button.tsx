import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { SosOverlay } from "@/components/sos-overlay";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSos } from "@/hooks/use-sos";

/**
 * The SOS control, on the resident Home bar beside the eye and the bell.
 *
 * ## It was a floating button, and the floating button is why it moved
 *
 * `<SosFab>` was a red circle above the tab bar on every resident screen. It
 * hid on scroll with the rest of the bottom chrome, it sat over whatever the
 * resident was reading, and a circle with no fixed neighbours reads as
 * decoration — a control nobody is sure is a control. Up here it is one of three
 * things in a row that never moves, never hides and is always in the same place,
 * which is what an emergency control has to be.
 *
 * The cost is honest: SOS is now on Home rather than on all five tabs. Home is
 * the tab the app opens on and one tap from any other, and a button that is
 * *found* on one screen beats a button that is missed on five.
 *
 * ## Written as a red pill, not an `<IconButton>`
 *
 * Its neighbours are 40dp bordered circles carrying a glyph. This is the same
 * height so the row still lines up, and deliberately nothing else about it is
 * the same: filled `destructive`, the word itself rather than an icon. The
 * palette rule is that red carries meaning and is never decoration — this is the
 * one control in the app where it carries the most.
 *
 * ## Two gestures, because they are two different situations
 *
 * - **Tap** opens `/sos`: add a note, choose whether guardians hear about it,
 *   and see the numbers to call. "Something is wrong and I have a moment."
 * - **Long press** arms the countdown straight away, guardians included. The
 *   panic path, and deliberately a sustained press — a button that alerts a
 *   whole hostel on one tap alerts it from inside a pocket.
 *
 * ## The overlay is mounted here, and a `Modal` is why that is safe
 *
 * `<SosOverlay>` covers the tab bar and the app bar, so the three armed seconds
 * cannot be navigated away from by a stray tap on a tab — and Android's back
 * button lands on `onRequestClose`, which cancels rather than dismissing
 * silently. Nothing about the countdown depends on this component being the one
 * that owns it; what it depends on is there being exactly one, which is why
 * `app/sos.tsx` is the only other place that may render it.
 */
export function SosHeaderButton() {
  const { colors } = useAppTheme();
  const sos = useSos();

  return (
    <>
      <Pressable
        accessibilityHint="Opens emergency options. Press and hold to send an alert straight away."
        accessibilityLabel="Emergency SOS"
        accessibilityRole="button"
        className="h-10 items-center justify-center rounded-full px-3.5 active:opacity-80"
        delayLongPress={600}
        hitSlop={6}
        onLongPress={() => sos.arm({ guardianAlertEnabled: true })}
        onPress={() => {
          void Haptics.selectionAsync();
          router.push("/sos");
        }}
        style={{ backgroundColor: colors.destructive }}
      >
        <Text
          className="text-white"
          style={{ fontSize: 13, fontWeight: "800", letterSpacing: 0.6 }}
        >
          SOS
        </Text>
      </Pressable>

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
