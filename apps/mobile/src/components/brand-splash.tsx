import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { APP_NAME, POWERED_BY, logo } from "@/constants/branding";

/**
 * The JS splash, shown over the app while the boot gate decides where to go.
 *
 * It is drawn to match the *native* splash in app.json — same brand-green
 * ground, same centred mark — so the handover between the two is invisible.
 * The native splash covers the milliseconds before React mounts; this one
 * covers the token read. If they looked different you would see a flicker at
 * the seam, which is the exact thing the boot contract is about.
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
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={["#0a8a4b", "#088043", "#066636"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View className="flex-1 items-center justify-center px-8">
        <Animated.View className="items-center" style={markStyle}>
          <Image
            contentFit="contain"
            source={logo.markLight}
            style={{ height: 108, width: 108 }}
            transition={0}
          />
          <Text className="mt-5 text-3xl font-semibold tracking-tight text-white">
            {APP_NAME}
          </Text>
        </Animated.View>
      </View>

      <Animated.View className="items-center pb-14" style={tailStyle}>
        {message ? (
          <View className="mb-5 flex-row items-center gap-2">
            <ActivityIndicator color="rgba(255,255,255,0.85)" size="small" />
            <Text className="text-sm text-white/80">{message}</Text>
          </View>
        ) : null}

        <Text className="text-xs font-medium uppercase tracking-[2px] text-white/70">
          {POWERED_BY}
        </Text>
      </Animated.View>
    </View>
  );
}
