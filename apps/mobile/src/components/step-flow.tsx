import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  ReduceMotion,
  ZoomIn,
} from "react-native-reanimated";

import { AppBar } from "@/components/ui/app-bar";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The pieces of a one-question-group-at-a-time flow. Built for the ID card
 * (`app/id-card/edit.tsx`) and shared with hostel registration and the
 * service-provider application, so the three read as one app rather than
 * three forms that happen to ask similar things.
 */

/**
 * One step: a "Step n of N" bar, the step's heading, and its fields sliding in
 * from the side they came from. Keyed on the step so each mounts fresh — only
 * `entering` animates, because two stacked forms inside a scroll view is a jump
 * rather than a transition.
 */
export function StepFrame({
  actions,
  children,
  footer,
  forward,
  onBack,
  position,
  scrollEnabled,
  stepKey,
  subtitle,
  title,
  total,
}: {
  actions?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  forward: boolean;
  onBack: () => void;
  /** 1-based. */
  position: number;
  scrollEnabled?: boolean;
  stepKey: string;
  subtitle: string;
  title: string;
  total: number;
}) {
  return (
    <Screen
      footer={footer}
      header={
        <AppBar
          actions={actions}
          centerTitle
          onBack={onBack}
          showBack
          title={`Step ${position} of ${total}`}
        />
      }
      scroll
      scrollEnabled={scrollEnabled}
    >
      <Animated.View
        className="gap-6 pb-4 pt-2"
        entering={(forward ? FadeInRight : FadeInLeft)
          .duration(220)
          .reduceMotion(ReduceMotion.System)}
        key={stepKey}
      >
        <View className="gap-1">
          <Text variant="title">{title}</Text>
          <Text variant="muted">{subtitle}</Text>
        </View>
        {children}
      </Animated.View>
    </Screen>
  );
}

/** Drawn as step 1 itself while the flow loads, so arriving reads as one move. */
export function StepSkeleton({
  subtitle,
  title,
  total,
}: {
  subtitle: string;
  title: string;
  total: number;
}) {
  return (
    <Screen
      header={<AppBar centerTitle showBack title={`Step 1 of ${total}`} />}
    >
      <View className="gap-6 pt-2">
        <View className="gap-1">
          <Text variant="title">{title}</Text>
          <Text variant="muted">{subtitle}</Text>
        </View>
        {[0, 1, 2, 3].map((row) => (
          <Skeleton height={44} key={row} />
        ))}
      </View>
    </Screen>
  );
}

/**
 * A section that folds away. Closing it only hides the fields — what was typed
 * stays in the draft — and a section holding an error is held open so the red
 * line under a field can never be folded out of sight.
 */
export function Accordion({
  caption,
  children,
  defaultOpen = false,
  forceOpen = false,
  title,
}: {
  caption: string;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  title: string;
}) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(defaultOpen);
  const shown = open || forceOpen;

  return (
    <View className="border-b border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        className="flex-row items-center gap-3 py-4 active:opacity-70"
        onPress={() => setOpen(!shown)}
      >
        <View className="flex-1 gap-0.5">
          <Text variant="subtitle">{title}</Text>
          <Text variant="caption">{caption}</Text>
        </View>
        <Ionicons
          color={colors.mutedForeground}
          name={shown ? "chevron-up" : "chevron-down"}
          size={20}
        />
      </Pressable>

      {shown ? (
        <Animated.View
          className="gap-6 pb-6"
          entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A titled group inside a step. */
export function StepSection({
  action,
  caption,
  children,
  title,
}: {
  /** Drawn at the end of the title line — a remove button. */
  action?: ReactNode;
  caption?: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <View className="gap-4 pt-2">
      <View className="flex-row items-center gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="subtitle">{title}</Text>
          {caption ? <Text variant="caption">{caption}</Text> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

/**
 * One step on Review, folded: done tick, title, Edit. Tapping the row opens
 * what was entered, read-only — a review that is also editable is the same
 * wall of fields the steps took apart. Edit is the only way back into a step.
 */
export function ReviewFold({
  children,
  complete,
  divider,
  onEdit,
  onToggle,
  open,
  title,
}: {
  children: ReactNode;
  complete: boolean;
  divider: boolean;
  onEdit: () => void;
  onToggle: () => void;
  open: boolean;
  title: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View>
      {divider ? <View className="mx-4 h-px bg-border/20" /> : null}
      <View className="flex-row items-center gap-3 py-3.5">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="flex-1 flex-row items-center gap-3 active:opacity-70"
          onPress={onToggle}
        >
          <Ionicons
            color={complete ? colors.primary : colors.warning}
            name={complete ? "checkmark-circle" : "alert-circle"}
            size={22}
          />
          <Text className="flex-1" variant="label">
            {title}
          </Text>
          <Ionicons
            color={colors.mutedForeground}
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
          />
        </Pressable>
        <Pressable hitSlop={10} onPress={onEdit}>
          <Text className="text-primary" variant="label">
            Edit
          </Text>
        </Pressable>
      </View>

      {open ? (
        <Animated.View
          className="gap-2.5 pb-4 pl-9"
          entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)}
        >
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Label-and-value lines inside an opened {@link ReviewFold}. */
export function FactRows({
  facts,
}: {
  facts: readonly (readonly [string, string])[];
}) {
  return (
    <>
      {facts.map(([label, value], position) => (
        <View className="flex-row gap-3" key={`${label}-${position}`}>
          <Text className="w-32" variant="caption">
            {label}
          </Text>
          <Text className="flex-1 text-foreground" variant="caption">
            {value}
          </Text>
        </View>
      ))}
    </>
  );
}

/** Under the review rows: what still needs fixing, and a tap straight to it. */
export function ReviewVerdict({
  incomplete,
  onFix,
}: {
  /** The first unfinished step's title, or `null` when everything is done. */
  incomplete: string | null;
  onFix: () => void;
}) {
  const { colors } = useAppTheme();

  return incomplete ? (
    <Pressable
      className="flex-row items-center gap-2 rounded-xl bg-warning-soft px-4 py-3 active:opacity-70"
      onPress={onFix}
    >
      <Ionicons color={colors.warning} name="alert-circle" size={18} />
      <Text className="flex-1 text-warning" variant="label">
        Some details need fixing — {incomplete}
      </Text>
    </Pressable>
  ) : (
    <View className="flex-row items-center gap-2 rounded-xl bg-brand-soft px-4 py-3">
      <Ionicons color={colors.primary} name="checkmark-circle" size={18} />
      <Text className="flex-1 text-primary" variant="label">
        All details look good!
      </Text>
    </View>
  );
}

/**
 * The consent box above a flow's final button. The button stays tappable while
 * this is unticked and answers the tap with a toast — see the callers.
 */
export function TermsAgreement({
  agreed,
  error,
  onChange,
  prefix,
}: {
  agreed: boolean;
  error?: string;
  onChange: (value: boolean) => void;
  /** Everything before "our Terms and Privacy Policy." */
  prefix: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="gap-1.5">
      <View className="flex-row items-start gap-3">
        <Pressable
          accessibilityLabel="I agree to the Terms and Privacy Policy"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          hitSlop={10}
          onPress={() => onChange(!agreed)}
        >
          <Ionicons
            color={agreed ? colors.primary : colors.mutedForeground}
            name={agreed ? "checkbox" : "square-outline"}
            size={22}
          />
        </Pressable>
        <Text
          className="flex-1"
          onPress={() => onChange(!agreed)}
          variant="caption"
        >
          {prefix} our{" "}
          <Text
            className="text-primary"
            onPress={() => router.push("/legal/terms")}
            variant="caption"
          >
            Terms
          </Text>{" "}
          and{" "}
          <Text
            className="text-primary"
            onPress={() => router.push("/legal/privacy")}
            variant="caption"
          >
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** An icon and a line, popping in after `delay` ms — the invitation screens' bullet. */
export function IconPoint({
  delay,
  icon,
  text,
}: {
  delay: number;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row gap-3">
      <Animated.View
        entering={ZoomIn.delay(delay)
          .springify()
          .reduceMotion(ReduceMotion.System)}
      >
        <Ionicons color={colors.primary} name={icon} size={18} />
      </Animated.View>
      <Text className="flex-1" variant="muted">
        {text}
      </Text>
    </View>
  );
}
