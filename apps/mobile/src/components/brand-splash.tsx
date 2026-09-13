import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { APP_NAME, APP_NAME_PARTS, POWERED_BY, logo } from "@/constants/branding";
import { palette } from "@/constants/theme";

/** How long the cold-start cover holds, so the "Powered by" line is actually read. */
const BOOT_COVER_MS = 1600;

/**
 * Laid over the whole app once, on cold start, for `BOOT_COVER_MS`.
 *
 * Boot is usually faster than a person can read — the gate's `BrandSplash` is
 * gone in a few frames — so without this the Softmato line never showed. The app
 * boots underneath; if boot outlasts the cover, the gate's own `BrandSplash` is
 * already fully drawn below it, so lifting the cover changes nothing visible.
 */
export function BootSplashCover() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), BOOT_COVER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View exiting={FadeOut.duration(220)} style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}>
      <BrandSplash />
    </Animated.View>
  );
}

/**
 * The JS splash, shown over the app while the boot gate decides where to go.
 *
 * It is drawn to match the *native* splash in app.json — same white ground,
 * same centred green mark at the same size — so the handover between the two is
 * invisible. The native splash covers the milliseconds before React mounts;
 * this one covers the token read. If they looked different you would see a
 * flicker at the seam, which is the exact thing the boot contract is about.
 *
 * It is also the only one of the two that can draw *words*: an Android splash
 * is one image on one colour and nothing else, so `APP_NAME` and the
 * "Powered by" line can only come from here. That is why `_layout.tsx` uncovers
 * the native splash as soon as React has painted rather than holding it to the
 * end of boot — otherwise this screen is never seen at all.
 *
 * The mark fades and lifts slightly rather than appearing hard, and the
 * "Powered by" line trails it — enough motion to feel deliberate, not so much
 * that a fast boot looks like it is waiting for the animation.
 */
export function BrandSplash({ message }: { message?: string }) {
  const markOpacity = useSharedValue(0);
  const markLift = useSharedValue(12);
  const tailOpacity = useSharedValue(0);

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    markLift.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });
    tailOpacity.value = withDelay(220, withTiming(1, { duration: 420 }));
  }, [markLift, markOpacity, tailOpacity]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ translateY: markLift.value }],
  }));

  const tailStyle = useAnimatedStyle(() => ({ opacity: tailOpacity.value }));

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.light.background }]}>
      <View className="flex-1 items-center justify-center px-8">
        <Animated.View className="items-center" style={markStyle}>
          <Image
            contentFit="contain"
            source={logo.mark}
            style={{ height: 140, width: 140 }}
            transition={0}
          />
          <Text
            accessibilityLabel={APP_NAME}
            className="mt-5 text-3xl font-bold tracking-tight"
            style={{ color: palette.light.foreground }}
          >
            {APP_NAME_PARTS.head}
            <Text style={{ color: palette.light.brand }}>{APP_NAME_PARTS.tail}</Text>
          </Text>
        </Animated.View>
      </View>

      <Animated.View className="items-center pb-12" style={tailStyle}>
        {message ? (
          <View className="mb-5 flex-row items-center gap-2">
            <ActivityIndicator color={palette.light.brand} size="small" />
            <Text className="text-muted-foreground text-sm">{message}</Text>
          </View>
        ) : null}

        <View accessibilityLabel={POWERED_BY} className="flex-row items-center gap-2.5">
          <Text className="text-sm italic" style={{ color: palette.light.mutedForeground }}>
            Powered by
          </Text>
          <Image
            contentFit="contain"
            source={logo.softmato}
            style={{ height: 62, width: 82 }}
            transition={0}
          />
        </View>
      </Animated.View>
    </View>
  );
}
