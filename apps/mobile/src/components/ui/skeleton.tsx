import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * The shape of the content, pulsing, while the content loads.
 *
 * ## When to use this instead of `LoadingState`
 *
 * `LoadingState` is a centred spinner: right when the screen has nothing to
 * show and no idea what shape it will be. A skeleton is right when the layout
 * is already known — a list of invoice rows, a profile header — because it
 * keeps the page from jumping when the data lands, and a jump is what makes an
 * app feel slower than it is even when it is faster.
 *
 * Never use it for a refresh. `use-resource.ts` deliberately keeps the previous
 * data on screen while revalidating; swapping a list somebody is reading for
 * grey blocks throws away what they were reading to tell them nothing.
 *
 * ## On the UI thread
 *
 * The pulse is a Reanimated shared value, so it keeps animating while JS is
 * busy parsing the very response it is waiting for. An `Animated.loop` from
 * React Native's own API stalls exactly then — a loading indicator that freezes
 * during the load is worse than no indicator.
 */

const PULSE_MS = 900;

export function Skeleton({
  className = "",
  height = 16,
  radius = 8,
  width,
}: {
  className?: string;
  height?: number;
  radius?: number;
  /** Omit to fill the parent — the usual case inside a column. */
  width?: ViewStyle["width"];
}) {
  const opacity = useSharedValue(0.45);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      // -1 repeats forever; `true` reverses, so it breathes rather than
      // snapping back to dim every cycle.
      -1,
      true,
    );
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      // `accessibilityElementsHidden`/`importantForAccessibility` keep a screen
      // reader from announcing a column of meaningless blocks.
      accessibilityElementsHidden
      className={`bg-muted ${className}`}
      importantForAccessibility="no-hide-descendants"
      style={[{ borderRadius: radius, height, width: width ?? "100%" }, style]}
    />
  );
}

/** A few lines of body text. The last one is short, the way real text is. */
export function SkeletonText({
  className = "",
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <View className={`gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          height={12}
          key={index}
          width={index === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </View>
  );
}

/**
 * The placeholder for a `Card` of rows — the shape most lists in this app load
 * into.
 */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card p-4">
      <Skeleton height={18} width="45%" />
      {Array.from({ length: rows }, (_, index) => (
        <View className="flex-row items-center gap-3" key={index}>
          <Skeleton height={36} radius={18} width={36} />
          <View className="flex-1 gap-1.5">
            <Skeleton height={12} width="70%" />
            <Skeleton height={10} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The placeholder for a stack of `CardRow`s — the shape the admin lists load
 * into now that a menu of destinations is separate cards rather than one card of
 * rows.
 *
 * Distinct from `SkeletonCard` in the thing that actually matters about a
 * skeleton: **the gaps**. `SkeletonCard` draws one bordered box with rows inside
 * it, so its placeholder is continuous; this draws N boxes with 12 points of
 * page showing between them. Use the one that matches what will replace it, or
 * the page jumps on load — which is the whole reason to prefer a skeleton over a
 * spinner in the first place.
 */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <View className="gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <View
          className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3"
          key={index}
        >
          <Skeleton height={40} radius={12} width={40} />
          <View className="flex-1 gap-1.5">
            <Skeleton height={13} width="60%" />
            <Skeleton height={10} width="85%" />
          </View>
        </View>
      ))}
    </View>
  );
}
