import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import type { ReactionTally, ReactionType } from "@/lib/community-api";
import { compactCount, REACTIONS } from "@/lib/community";
import { playReactionPop } from "@/lib/sound-effects";

/**
 * The row of six reactions under a post, with the tally beside each one.
 *
 * Split out of `community-post-card.tsx` rather than added to it: the card was
 * already the longest component in the app, and every emoji here is now an
 * animated node with its own shared values — that is a component, not a `.map()`
 * inside another component's render.
 *
 * ## Counts come from the server, and absent is not zero
 *
 * `reactionCounts` keys only the types somebody actually chose. A type with no
 * count draws its emoji alone, dimmed: a row reading `👍 0 ❤️ 0 😄 0 😢 0 😠 0
 * 🤝 0` under every fresh post is six pieces of furniture saying nothing, and it
 * makes the one post that *does* have a reaction harder to spot, not easier.
 *
 * ## The tray, not six loose glyphs
 *
 * The emoji sit on a filled rounded tray, which is what separates "these are
 * controls" from "the author typed some emoji". It is also what gives the active
 * reaction something to be highlighted *against* — a brand-tinted pill inside a
 * neutral tray reads as chosen; the same pill floating on the card reads as a
 * button nobody else has.
 */

/** The tap animation, in the order it plays. */
const POP_MS = 120;
const SHAKE_MS = 55;
const SETTLE_MS = 150;

/** How far the emoji grows at the top of the pop. */
const POP_SCALE = 1.45;

/** The shake's swing, in degrees, decaying to nothing. */
const SWING = [-14, 12, -7, 0];

export function ReactionBar({
  counts,
  onReact,
  viewerReaction,
}: {
  counts: ReactionTally;
  /** Fires on every tap, including the one that clears the viewer's reaction. */
  onReact: (type: ReactionType) => void;
  viewerReaction: ReactionType | null;
}) {
  const { colors } = useAppTheme();

  return (
    <View
      className="flex-row items-center justify-between rounded-2xl px-1.5 py-1"
      style={{ backgroundColor: colors.muted }}
    >
      {REACTIONS.map(({ emoji, label, type }) => (
        <ReactionChip
          active={viewerReaction === type}
          count={counts[type] ?? 0}
          emoji={emoji}
          key={type}
          label={label}
          onPress={() => onReact(type)}
        />
      ))}
    </View>
  );
}

/**
 * One emoji: expand, shake, settle — and the pop sound underneath it.
 *
 * ## Why the emoji moves and the pill does not
 *
 * The animated node is the glyph itself, inside a static pressable. Animating
 * the pill would move its background and its count with it, which at 1.45×
 * overlaps the neighbouring chip and makes the whole row wobble for one tap. The
 * glyph scaling out of a still pill is the gesture people already read as "that
 * landed" — and because the pill's box never changes, nothing reflows.
 *
 * ## Sound fires on press, not on animation end
 *
 * The pop *is* the feedback; hearing it 400ms after the finger lands reads as
 * lag, not as a flourish. It plays on the same frame the animation starts, and
 * it plays even when the tap is the one that **removes** a reaction — that is
 * still a thing the tap did, and silence there would read as a missed press.
 *
 * ## Reduced motion takes the motion, not the reaction
 *
 * `useReducedMotion` is on for people who get sick watching things spring
 * around. With it set the glyph never moves; the tap still reacts, still pops,
 * still recolours the pill. The setting asks for less movement, not for a
 * different feature.
 */
function ReactionChip({
  active,
  count,
  emoji,
  label,
  onPress,
}: {
  active: boolean;
  count: number;
  emoji: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();

  const scale = useSharedValue(1);
  const spin = useSharedValue(0);

  /*
   * Declared **above** `useAnimatedStyle`, and as a plain function rather than a
   * `useCallback`. Both are the React Compiler's requirements, not preferences,
   * and neither is guessable from the error it gives:
   *
   * - The compiler cannot tell a `SharedValue` from an ordinary object, so it
   *   freezes one the moment it is captured by something handed to a hook — the
   *   closure passed to `useAnimatedStyle` is exactly that. Every write **after**
   *   that point is "This value cannot be modified", which is why the style hook
   *   now sits at the bottom of this component and the writes sit above it.
   * - A `useCallback` would put `scale` and `spin` in a dependency array, which
   *   freezes them the same way. `BottomChromeProvider` writes this rule down
   *   after hitting the same wall.
   */
  function press() {
    playReactionPop();

    if (!reducedMotion) {
      /*
       * Grown before the shake starts and held there through it, so the swing
       * happens at full size and is actually visible; the settle then brings
       * scale and angle home together. `Easing.out(Easing.back(2))` is what
       * makes the growth overshoot slightly rather than ramp — the difference
       * between a pop and a zoom.
       */
      scale.value = withSequence(
        withTiming(POP_SCALE, { duration: POP_MS, easing: Easing.out(Easing.back(2)) }),
        withTiming(POP_SCALE, { duration: SHAKE_MS * (SWING.length - 1) }),
        withTiming(1, { duration: SETTLE_MS, easing: Easing.out(Easing.quad) }),
      );

      spin.value = withSequence(
        withTiming(SWING[0], { duration: POP_MS, easing: Easing.out(Easing.quad) }),
        ...SWING.slice(1).map((angle) => withTiming(angle, { duration: SHAKE_MS })),
        withTiming(0, { duration: SETTLE_MS, easing: Easing.out(Easing.quad) }),
      );
    }

    onPress();
  }

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${spin.value}deg` }],
  }));

  return (
    <Pressable
      accessibilityLabel={count > 0 ? `${label}, ${count}` : label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="flex-row items-center gap-1 rounded-xl px-2 py-1.5 active:opacity-70"
      hitSlop={4}
      onPress={press}
      style={active ? { backgroundColor: colors.brandSoft } : undefined}
    >
      {/*
        A fixed line height on the glyph, because the transform is applied to
        this node: without it the emoji's own ascent decides the box height, and
        the six differ by a point or two — enough that the tray's chips sit at
        slightly different heights.
      */}
      <Animated.Text
        style={[{ fontSize: 16, lineHeight: 20 }, glyphStyle]}
        // The count beside it already carries the meaning for a screen reader,
        // and an emoji read aloud mid-row ("thumbs up sign") is noise.
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {emoji}
      </Animated.Text>

      {count > 0 ? (
        <Text
          style={{
            color: active ? colors.primary : colors.mutedForeground,
            fontSize: 12,
            fontWeight: active ? "700" : "600",
          }}
        >
          {compactCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}
