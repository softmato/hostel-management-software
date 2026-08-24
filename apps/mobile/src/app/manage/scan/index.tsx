import { Ionicons } from "@expo/vector-icons";
import {
  type BarcodeScanningResult,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useSystemInsets } from "@/hooks/use-system-insets";
import {
  formatResidentIdInput,
  normalizeResidentId,
  residentIdError,
} from "@/lib/resident-id";

/**
 * The viewfinder — hold a resident's card up and read who they are.
 *
 * ## One job, and nothing else on the screen
 *
 * `ebl-01` and `esewa-01` both put a QR scanner behind the one circular button
 * in the middle of the tab bar, and `NOTES.md` §10 records that we did not adopt
 * the FAB because no single admin action earned it. Scanning a resident is that
 * action for a hostel owner standing in a corridor, and this is what it opens:
 * a camera, an aiming frame, and a way in for the card whose QR will not read.
 * There is deliberately no menu, no tabs and no second thing to do here.
 *
 * ## It rises from the bottom, and that is a claim about what it is
 *
 * Registered `slide_from_bottom` in `app/_layout.tsx`, alongside `sos`,
 * `complaints/new` and `id-card/edit`. Every other push in this app fades,
 * because a fade reads as *the destination resolving where you already are*.
 * This one is the other shape — a thing you open, use once, and dismiss — and
 * rising from the edge is what tells a thumb it can be thrown away again. The
 * chevron in the corner points **down** for the same reason.
 *
 * ## The sweep is not decoration
 *
 * A camera preview with a static frame on it gives no evidence it is running:
 * point it at a wall and a frozen feed looks identical to a live one. The bar
 * travelling the window is the only thing on screen that says "still looking",
 * which is exactly what somebody holding a card at arm's length needs to know
 * before they decide the app is broken. It is a Reanimated shared value, so it
 * keeps moving on the UI thread while JS is busy parsing the lookup it just
 * fired — the moment a spinner would freeze.
 *
 * ## Nothing is posted until the payload is ours
 *
 * `onBarcodeScanned` fires on **every frame** a code is in view. Without a local
 * parse, a warden pointing this at a bus ticket would post several lookups a
 * second at a rate-limited endpoint and get an error toast for a QR that was
 * never ours. `normalizeResidentId` is the same parse the server runs, mirrored
 * on the phone precisely so the request never leaves — see `lib/resident-id.ts`.
 *
 * The card's QR encodes a **link** (`<site>/resident-id/HH-…`), not the id, so a
 * screen that trusted the decoded string would send a URL and get a 422.
 */
export default function ScanResidentScreen() {
  const insets = useSystemInsets();
  const window = useWindowDimensions();

  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);

  /*
   * A ref, not state. The scanner fires several times before React has
   * re-rendered with a "handled" flag, and each of those would be a second
   * push onto the stack — the dossier screen opening two or three times deep,
   * so backing out of it lands on itself.
   */
  const handled = useRef(false);

  /*
   * Lowered on *focus*, not on mount. Pushing the dossier leaves this screen
   * mounted underneath, so a guard cleared in an empty-deps effect would never
   * run again and the second scan of the session would do nothing at all.
   */
  useFocusEffect(
    useCallback(() => {
      handled.current = false;
    }, []),
  );

  /** A square, capped so the frame does not swallow a tall phone whole. */
  const windowSize = Math.min(window.width - 48, 320);

  function open(residentId: string) {
    handled.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push(`/manage/scan/${residentId}`);
  }

  function onScan({ data }: BarcodeScanningResult) {
    if (handled.current) {
      return;
    }

    const residentId = normalizeResidentId(data);

    if (!residentId) {
      // A constant string, so the frames that follow bail out of re-rendering
      // rather than thrashing while the wrong code is held up to the lens.
      setHint("That is not a HostelHub ID card.");
      return;
    }

    setHint(null);
    open(residentId);
  }

  function submitTyped() {
    const problem = residentIdError(typed);

    if (problem) {
      setTypedError(problem);
      return;
    }

    setManualOpen(false);
    open(normalizeResidentId(typed) as string);
  }

  return (
    <View className="flex-1 bg-black">
      {/*
        The camera fills the screen and everything else floats over it. A
        preview boxed inside a card is what `activate.tsx` does, and it is right
        there — that screen is a form with a scanner on it. This screen *is* the
        scanner, and a viewfinder that does not fill the glass reads as a widget
        rather than as a camera.
      */}
      {permission?.granted ? (
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          enableTorch={torch}
          facing="back"
          onBarcodeScanned={onScan}
          style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
        />
      ) : null}

      <View
        className="flex-1 justify-between"
        style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 8 }}
      >
        <View className="gap-6 px-5">
          <View className="flex-row items-center justify-between">
            <GlassButton
              icon="chevron-down"
              label="Close the scanner"
              onPress={() => router.back()}
            />

            {permission?.granted ? (
              <GlassButton
                active={torch}
                icon={torch ? "flashlight" : "flashlight-outline"}
                label={torch ? "Turn off the torch" : "Turn on the torch"}
                onPress={() => setTorch((current) => !current)}
              />
            ) : null}
          </View>

          <View className="gap-1">
            <Text className="text-2xl font-bold text-white">Scan a resident</Text>
            <Text className="text-sm text-white/70">
              Hold the QR on their HostelHub ID card inside the frame.
            </Text>
          </View>
        </View>

        <View className="items-center gap-5 px-5">
          <ScanWindow
            live={Boolean(permission?.granted)}
            message={hint}
            size={windowSize}
          />

          {permission && !permission.granted ? (
            <View className="w-full max-w-sm items-center gap-3 rounded-3xl bg-white/10 px-5 py-6">
              <Ionicons color="#ffffff" name="camera-outline" size={26} />
              <Text className="text-center text-sm text-white/80">
                {permission.canAskAgain
                  ? "Allow the camera to read their card, or type the ID underneath it."
                  : "Camera access is off for HostelHub. Turn it on in Settings, or type the ID printed under the QR."}
              </Text>
              <Button
                label={permission.canAskAgain ? "Allow camera" : "Open settings"}
                onPress={
                  permission.canAskAgain
                    ? requestPermission
                    : () => void Linking.openSettings()
                }
                size="sm"
              />
            </View>
          ) : null}
        </View>

        <View className="gap-3 px-5">
          {/*
            Not a fallback for a broken camera so much as the other half of the
            feature. A cracked screen, a card photocopied small, a permission
            refused months ago with "don't ask again", and an ID read out over
            the phone all end here — and it is ten characters to type.
          */}
          <Pressable
            accessibilityLabel="Type the resident ID instead"
            accessibilityRole="button"
            className="flex-row items-center justify-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 active:opacity-70"
            onPress={() => {
              setTypedError(null);
              setManualOpen(true);
            }}
          >
            <Ionicons color="#ffffff" name="keypad-outline" size={18} />
            <Text className="text-base font-semibold text-white">
              Type the ID instead
            </Text>
          </Pressable>

          <View className="flex-row items-start justify-center gap-2">
            <Ionicons
              color="rgba(255,255,255,0.55)"
              name="lock-closed-outline"
              size={13}
              style={{ marginTop: 2 }}
            />
            <Text className="text-xs text-white/55">
              The camera only reads the code. Nothing is recorded or uploaded.
            </Text>
          </View>
        </View>
      </View>

      <Sheet
        footer={<Button label="Look them up" onPress={submitTyped} />}
        onClose={() => setManualOpen(false)}
        open={manualOpen}
        title="Resident ID"
      >
        <View className="gap-4">
          <Text variant="muted">
            It is printed under the QR on their card, and reads like HH-4K7M-9XQ2.
          </Text>
          <Input
            autoCapitalize="characters"
            autoCorrect={false}
            error={typedError}
            label="ID on the card"
            maxLength={16}
            onChangeText={(value) => {
              setTyped(formatResidentIdInput(value));

              if (typedError) {
                setTypedError(null);
              }
            }}
            onSubmitEditing={submitTyped}
            placeholder="HH-4K7M-9XQ2"
            returnKeyType="go"
            value={typed}
          />
        </View>
      </Sheet>

      {/*
        Fixed black rather than a token, and this is the one screen where that
        is right: the strip sits over a camera feed, not over a themed surface,
        so `bg-background` would paint a white band across the top of a black
        screen in light mode.
      */}
      <View
        className="absolute inset-x-0 top-0 bg-black/35"
        pointerEvents="none"
        style={{ height: insets.top }}
      />
    </View>
  );
}

/** A round control on glass, for chrome that sits over a camera feed. */
function GlassButton({
  active = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`h-11 w-11 items-center justify-center rounded-full active:opacity-70 ${
        active ? "bg-white" : "bg-black/45"
      }`}
      hitSlop={8}
      onPress={onPress}
    >
      <Ionicons color={active ? "#000000" : "#ffffff"} name={icon} size={20} />
    </Pressable>
  );
}

const SWEEP_MS = 2200;

/**
 * The aiming window: four corner brackets and a bar travelling between them.
 *
 * The brackets are a **guide, not a boundary** — `CameraView` reads the whole
 * frame, and a viewfinder people believe is a hard edge makes them fight to fit
 * the code inside it. Corners rather than a full square say "roughly here"
 * where an unbroken outline says "exactly here"; the reference apps draw them
 * the same way for the same reason.
 */
function ScanWindow({
  live,
  message,
  size,
}: {
  live: boolean;
  /** Why the last read was ignored, printed over the frame it was read in. */
  message: string | null;
  size: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!live) {
      return;
    }

    progress.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.ease) }),
      // -1 is forever; `true` reverses, so the bar travels back rather than
      // snapping to the top — a snap reads as a dropped frame.
      -1,
      true,
    );
  }, [live, progress]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * (size - 2) }],
  }));

  const bracket = "absolute h-9 w-9 border-white";

  return (
    <View style={{ height: size, width: size }}>
      {/* Clipped, so the bar cannot travel out past the brackets. */}
      <View className="overflow-hidden rounded-3xl" style={{ height: size, width: size }}>
        {live ? (
          <Animated.View
            className="absolute inset-x-2 h-0.5 rounded-full bg-primary"
            style={sweep}
          />
        ) : null}
      </View>

      <View className={`${bracket} left-0 top-0 rounded-tl-3xl border-l-4 border-t-4`} />
      <View className={`${bracket} right-0 top-0 rounded-tr-3xl border-r-4 border-t-4`} />
      <View className={`${bracket} bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4`} />
      <View className={`${bracket} bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4`} />

      {message ? (
        <View className="absolute inset-x-0 -bottom-12 items-center">
          <View className="rounded-full bg-black/70 px-4 py-2">
            <Text className="text-xs font-medium text-white">{message}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
