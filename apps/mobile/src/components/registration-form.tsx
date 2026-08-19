import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";

/**
 * The parts both public registration wizards are built from.
 *
 * Two applications — a hostel and a tradesperson — with nothing in common in
 * their fields and everything in common in their *shape*: a tracker along the
 * top, one short screen of inputs, a Back/Next pair pinned to the bottom, and a
 * handful of chips and file rows in between. Written once here so the two feel
 * like one flow, since a person can plausibly file both.
 *
 * ## Why a wizard rather than the long form the website uses
 *
 * The website's hostel form is five sections on one page, and that works because
 * a desktop shows about a section and a half at a time with a sidebar telling you
 * where you are. On a 360dp screen the same markup is roughly forty inputs in a
 * single column, with the submit button somewhere past the bottom of a
 * twelve-screen scroll and no indication of how much is left. That is the form
 * people abandon, and abandoning it is why the app used to hand the whole job to
 * a browser tab.
 */

/* -------------------------------------------------------------------------- */
/* The tracker                                                                */
/* -------------------------------------------------------------------------- */

export type WizardStep = { key: string; label: string };

/**
 * Where you are, how far there is to go, and what is already done.
 *
 * ## Not the website's five numbered circles
 *
 * That stepper is 640dp wide with a horizontal scrollbar under it. Five circles
 * and five labels on a phone means either 60dp of touch target each or text
 * shrunk to the point where the labels stop being read — and a stepper whose
 * labels are not read is a decorative progress bar with extra steps.
 *
 * So the *current* step is named in words, and the rest are a row of bars. A tick
 * on a bar means that step validates; the current bar is the brand colour whether
 * it validates or not, because "you are here" is the more useful thing to say
 * about it.
 *
 * **Completed steps are tappable, later ones are not.** Going back to fix
 * something is the reason anyone looks at a tracker; jumping forward past a step
 * you have not filled in is how you arrive at a review screen listing four
 * missing fields.
 */
export function StepTracker({
  current,
  isComplete,
  onSelect,
  steps,
}: {
  current: string;
  isComplete: (key: string) => boolean;
  onSelect: (key: string) => void;
  steps: readonly WizardStep[];
}) {
  const { colors } = useAppTheme();

  const index = steps.findIndex((step) => step.key === current);
  const position = index === -1 ? 0 : index;

  return (
    <View className="gap-2 border-b border-border pb-4">
      <View className="flex-row items-center justify-between">
        <Text variant="label">{steps[position]?.label}</Text>
        <Text variant="caption">{`Step ${position + 1} of ${steps.length}`}</Text>
      </View>

      <View className="flex-row gap-1.5">
        {steps.map((step, stepIndex) => {
          const done = isComplete(step.key);
          const active = stepIndex === position;
          // Reachable if it is behind you, or if everything before it is done —
          // which is what lets someone who filled step 3 out of order skip
          // forward to it again without re-walking the whole wizard.
          const reachable =
            stepIndex <= position ||
            steps.slice(0, stepIndex).every((earlier) => isComplete(earlier.key));

          return (
            <Pressable
              accessibilityLabel={`${step.label}${done ? ", done" : ""}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: !reachable, selected: active }}
              className="h-8 flex-1 justify-center"
              disabled={!reachable}
              key={step.key}
              onPress={() => onSelect(step.key)}
            >
              <View
                className={`h-1.5 rounded-full ${
                  active ? "bg-primary" : done ? "bg-primary/40" : "bg-muted"
                }`}
              />
              <View className="mt-1 h-3 items-center">
                {done && !active ? (
                  <Ionicons color={colors.primary} name="checkmark" size={12} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The pinned Back/Next pair.
 *
 * Lives in `<Screen footer>` so it stays on screen while the keyboard is up —
 * a Next button that scrolls away under a keyboard is the second most common way
 * a phone form strands someone.
 *
 * `next` is never disabled on a step with errors. It runs the check and *shows*
 * them instead: a greyed-out button with no explanation is the first most common
 * way.
 */
export function WizardFooter({
  backLabel = "Back",
  loading = false,
  nextLabel,
  onBack,
  onNext,
}: {
  backLabel?: string;
  loading?: boolean;
  nextLabel: string;
  /** Absent on the first step — nothing to go back to. */
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    /*
      The widths come from wrapper `View`s rather than from a class on the
      buttons. `flex-1` on a `<Button>` works, but the ratio this row wants — a
      narrow Back beside a wide Next — needs an arbitrary value, and NativeWind
      compiles the class list at bundle time: a name nothing else in the app uses
      can resolve to nothing and take the layout with it. `style` is not an option
      either, since `<Button>` deliberately does not forward one.
    */
    <View className="flex-row gap-3">
      {onBack ? (
        <View style={{ flex: 1 }}>
          <Button
            disabled={loading}
            label={backLabel}
            onPress={onBack}
            variant="outline"
          />
        </View>
      ) : null}
      <View style={{ flex: 2 }}>
        <Button label={nextLabel} loading={loading} onPress={onNext} />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs the wizards share                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A wrapping row of selectable pills — trades, facilities.
 *
 * `order` numbers the selection when the order carries meaning, which for the
 * provider form it does: the first trade tapped becomes the headline trade on the
 * listing, and a chip grid that does not say so is a grid where that fact is
 * invisible.
 */
export function ChipGroup<T extends string>({
  error,
  hint,
  label,
  onToggle,
  optionLabel = (value: string) => value,
  options,
  ordered = false,
  selected,
}: {
  error?: string | null;
  hint?: string;
  label?: string;
  onToggle: (value: T) => void;
  optionLabel?: (value: T) => string;
  options: readonly T[];
  ordered?: boolean;
  selected: readonly T[];
}) {
  return (
    <View className="gap-2">
      {label ? <Text variant="label">{label}</Text> : null}
      {hint ? <Text variant="caption">{hint}</Text> : null}

      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const index = selected.indexOf(option);
          const active = index !== -1;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`flex-row items-center gap-1.5 rounded-full border px-3.5 py-2 ${
                active ? "border-primary bg-primary" : "border-border bg-card"
              }`}
              key={option}
              onPress={() => onToggle(option)}
            >
              <Text
                className={active ? "text-primary-foreground" : "text-foreground"}
                variant="label"
              >
                {optionLabel(option)}
              </Text>
              {ordered && index === 0 ? (
                <Text className="text-primary-foreground/80" variant="caption">
                  main
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One attachment slot: empty and inviting, or filled and removable.
 *
 * The preview is drawn for images and skipped for anything else — a PDF has no
 * thumbnail the app can render, and a grey box with a document icon is more
 * honest than a broken `<Image>`.
 */
export function AttachmentRow({
  attachment,
  busy = false,
  error,
  hint,
  label,
  onPick,
  onRemove,
  pickLabel = "Choose file",
}: {
  attachment: { fileName: string; url: string } | null;
  busy?: boolean;
  error?: string | null;
  hint?: string;
  label: string;
  onPick: () => void;
  onRemove: () => void;
  pickLabel?: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="gap-2">
      <Text variant="label">{label}</Text>
      {hint ? <Text variant="caption">{hint}</Text> : null}

      {attachment ? (
        <View className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-3">
          <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-muted">
            <Ionicons
              color={colors.primary}
              name="checkmark-circle-outline"
              size={20}
            />
          </View>
          <Text className="flex-1" numberOfLines={1} variant="label">
            {attachment.fileName}
          </Text>
          <Pressable
            accessibilityLabel={`Remove ${label}`}
            accessibilityRole="button"
            hitSlop={10}
            onPress={onRemove}
          >
            <Ionicons color={colors.destructive} name="close-circle" size={22} />
          </Pressable>
        </View>
      ) : (
        <Button
          disabled={busy}
          label={busy ? "Uploading…" : pickLabel}
          onPress={onPick}
          variant="outline"
        />
      )}

      {error ? (
        <Text className="text-destructive" variant="caption">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A horizontal strip of uploaded photos, each removable. */
export function PhotoStrip({
  onRemove,
  photos,
}: {
  onRemove: (url: string) => void;
  photos: readonly { fileName: string; url: string }[];
}) {
  const { colors } = useAppTheme();

  if (photos.length === 0) {
    return null;
  }

  return (
    <ScrollView contentContainerClassName="gap-2" horizontal showsHorizontalScrollIndicator={false}>
      {photos.map((photo) => (
        <View className="overflow-hidden rounded-xl" key={photo.url}>
          {/*
            Resolved against the API origin, never used raw.

            `POST /public/files/upload` returns an **absolute** URL when R2 is
            configured and a **relative** `/uploads/hostel-documents/…` when it is
            not — which is every developer machine and any deploy missing its R2
            variables. A phone has no page origin to resolve that against, so the
            thumbnail fails silently and the applicant sees an empty square after
            an upload that worked. `absoluteMediaUrl` leaves an absolute URL
            alone, so the configured case is unaffected. See `lib/media.ts`.
          */}
          <Image
            accessibilityLabel={photo.fileName}
            contentFit="cover"
            source={{ uri: absoluteMediaUrl(photo.url, API_BASE_URL) ?? photo.url }}
            style={{ backgroundColor: colors.muted, height: 84, width: 84 }}
            transition={120}
          />
          {/* On a card-coloured disc, because a red glyph straight onto an
              unknown photo is invisible against half of them. */}
          <Pressable
            accessibilityLabel={`Remove ${photo.fileName}`}
            accessibilityRole="button"
            className="absolute right-1 top-1 rounded-full bg-card"
            hitSlop={8}
            onPress={() => onRemove(photo.url)}
          >
            <Ionicons color={colors.destructive} name="close-circle" size={20} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/** A titled block inside a step. Keeps the two wizards' spacing identical. */
export function FormSection({
  children,
  subtitle,
  title,
}: {
  children: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text variant="subtitle">{title}</Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A label/value pair for the review step. */
export function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3 py-2">
      <Text className="w-32" variant="caption">
        {label}
      </Text>
      <Text className="flex-1" variant="label">
        {value || "—"}
      </Text>
    </View>
  );
}
