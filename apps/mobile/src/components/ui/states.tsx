import type { ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";

/**
 * The states every list and detail view has to handle — DESIGN.md §5.
 *
 * They live together so it is obvious when a screen has only implemented two of
 * them. An empty list and a failed request look identical to a user if you let
 * them both render as nothing.
 */

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-1 items-center justify-center gap-3 py-16">
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text variant="muted">{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  action,
  compact = false,
  description,
  title,
}: {
  action?: ReactNode;
  /**
   * For an empty state *inside a card*, rather than one holding a whole screen.
   *
   * The full-screen version is `flex-1` and generously padded, which is right
   * when it is the only thing on the page and wrong the moment it is a section:
   * `<Screen scroll>` gives its content container `grow`, so a `flex-1` empty
   * state inside a short page stretches to eat the leftover height, and "Nothing
   * to verify" came out as a 400-point box on a screen with four other sections
   * on it. Compact takes its natural height and pads like a row.
   */
  compact?: boolean;
  description?: string;
  title: string;
}) {
  return (
    <View
      className={`items-center justify-center gap-2 px-8 ${
        compact ? "py-6" : "flex-1 py-16"
      }`}
    >
      <Text className="text-center" variant="subtitle">
        {title}
      </Text>
      {description ? (
        <Text className="text-center" variant="muted">
          {description}
        </Text>
      ) : null}
      {action ? <View className="mt-3">{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8 py-16">
      <Text className="text-center" variant="subtitle">
        That didn&apos;t load
      </Text>
      <Text className="text-center" variant="muted">
        {message}
      </Text>
      {onRetry ? (
        <Button className="mt-2" label="Try again" onPress={onRetry} variant="outline" />
      ) : null}
    </View>
  );
}

/**
 * A section with nothing in it — the card and the compact empty state together.
 *
 * The pair was written out longhand at every call site, and drifted the way
 * repeated pairs do: `(admin)/today` alone had a section wrapping `EmptyState`
 * in a `Card`, a second one switching the card's padding on the row count so
 * the same `EmptyState` sat in a different inset, and two more explaining
 * emptiness in loose `<Text variant="muted">` prose with no title at all. Four
 * treatments of one idea on one screen.
 *
 * Callers with rows to draw still pass `padding="px-4 py-1"` to their own
 * `Card`, because a card of rows genuinely wants a narrower vertical inset than
 * a card of prose. What has gone is the *conditional* — the empty branch is a
 * different component now, not the same one with different padding.
 */
export function EmptyCard({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <Card>
      <EmptyState action={action} compact description={description} title={title} />
    </Card>
  );
}

/**
 * A section this account is not allowed to see.
 *
 * Deliberately **not** an `EmptyCard`. "No open requests" and "you may not look
 * at the open requests" are different facts, and rendering the second as the
 * first tells a warden their hostel has nothing pending when what actually
 * happened is that somebody did not tick a box in Warden Management. That is
 * the lie this codebase keeps having to un-tell, and it is worth its own
 * component so no screen has to remember to phrase it.
 *
 * The closing sentence matches `DeniedNotice`'s, which says the same thing for
 * a whole queue rather than for one section.
 */
export function PermissionCard({
  capability,
  feature,
}: {
  /** As a person would say it: "night status", "food", "maintenance". */
  capability: string;
  /** The section, capitalised for the start of a sentence: "The roll call". */
  feature: string;
}) {
  return (
    <Card className="gap-1">
      <Text variant="label">{`${feature} is not yours to see`}</Text>
      <Text variant="muted">
        {`It needs the ${capability} permission, which this account does not have. Ask your hostel admin if that looks wrong.`}
      </Text>
    </Card>
  );
}
