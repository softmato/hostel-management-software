import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { cellWidth, columnsThatFit } from "@/lib/responsive";

/**
 * The pieces every screen arranges itself out of, sized to the phone in hand.
 *
 * Not web responsive design — there is no desktop layout here and nothing turns
 * into a sidebar. What these solve is the handset range: a 320dp phone is 28%
 * narrower than a 430dp one, and a tile row hardcoded to four columns truncates
 * its labels on the small end while leaving a hole on the large one. `<Grid>`
 * measures the space it was actually given and fits what fits.
 *
 * The arithmetic is in `lib/responsive.ts`, where it is tested; this file holds
 * only what has to touch React Native.
 */

/**
 * A row of equal cells that wraps, sized from the width it is measured at.
 *
 * ## Why measured rather than `flex: 1` on the children
 *
 * Flex alone cannot answer "how many". A four-item row of `flex-1` cells stays
 * four items at any width — it squeezes them until the labels ellipsize instead
 * of dropping to three. And percentage widths with a gap overflow by a fraction
 * of a pixel and wrap the last cell onto its own line, on one screen width and
 * no other.
 *
 * So the container measures itself once, `columnsThatFit` decides the count from
 * `minCellWidth`, and every cell gets an exact pixel width. Nothing renders
 * before the measurement, which costs one frame and is the difference between a
 * grid that settles and one that visibly reflows on every open.
 */
export function Grid({
  children,
  className = "",
  gap = 12,
  maxColumns = 4,
  minCellWidth = 96,
}: {
  children: ReactNode[];
  className?: string;
  gap?: number;
  /** The cap, for when the container is wide enough to spread things too thin. */
  maxColumns?: number;
  /** Below this a cell's content stops fitting. The number that decides the count. */
  minCellWidth?: number;
}) {
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;

    // Guarded: `onLayout` fires on every rotation and keyboard resize, and an
    // unconditional `setState` here is a render loop on some Android devices.
    setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };

  const items = children.filter(Boolean);
  const columns = columnsThatFit(width, minCellWidth, gap, maxColumns);
  const cell = cellWidth(width, columns, gap);

  return (
    <View
      className={`flex-row flex-wrap ${className}`}
      onLayout={onLayout}
      style={{ gap }}
    >
      {width === 0
        ? null
        : items.map((child, index) => (
            // Positional keys are correct here: a cell *is* its position in the
            // row, and the children are a fixed list from the call site.
            <View key={index} style={{ width: cell }}>
              {child}
            </View>
          ))}
    </View>
  );
}

const TILE_TONES = {
  brand: { icon: "text-primary", surface: "bg-brand-soft" },
  danger: { icon: "text-destructive", surface: "bg-destructive/10" },
  neutral: { icon: "text-muted-foreground", surface: "bg-muted" },
  success: { icon: "text-success", surface: "bg-success-soft" },
  warning: { icon: "text-warning", surface: "bg-warning-soft" },
} as const;

export type TileTone = keyof typeof TILE_TONES;

const TONE_COLOR: Record<TileTone, "destructive" | "mutedForeground" | "primary" | "success" | "warning"> = {
  brand: "primary",
  danger: "destructive",
  neutral: "mutedForeground",
  success: "success",
  warning: "warning",
};

/**
 * An icon over a label, in a bordered cell — the facilities/quick-action tile.
 *
 * Two lines of text at most: a **label** (what it is) and an optional
 * **caption** (the detail, e.g. "24/7" under "Hot water"). Both wrap rather than
 * truncate, because `<Grid>` has already guaranteed the cell is wide enough for
 * the text at this screen size, and a wrapped second line is readable where an
 * ellipsis is not.
 */
export function InfoTile({
  caption,
  icon,
  label,
  onPress,
  tone = "brand",
}: {
  caption?: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: TileTone;
}) {
  const { colors } = useAppTheme();
  const palette = TILE_TONES[tone];

  const body = (
    <View className="min-h-[92px] flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-2 py-3">
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${palette.surface}`}>
        <Ionicons color={colors[TONE_COLOR[tone]]} name={icon} size={19} />
      </View>

      <View className="items-center gap-0.5">
        <Text className="text-center text-xs font-semibold text-foreground">{label}</Text>
        {caption ? (
          <Text className="text-center text-[11px] text-muted-foreground">{caption}</Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      accessibilityLabel={caption ? `${label}, ${caption}` : label}
      accessibilityRole="button"
      className="flex-1 active:opacity-70"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      {body}
    </Pressable>
  );
}

/**
 * A number with a name — the metric box that runs across the top of a dashboard.
 *
 * Distinct from `<InfoTile>` on purpose: this one leads with a **value**, so the
 * value is the largest thing in it and is left-aligned for scanning down a
 * column of them. A tile that leads with an icon and a tile that leads with a
 * number should not be the same component with a flag.
 */
export function StatTile({
  icon,
  label,
  onPress,
  tone = "neutral",
  trend,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: TileTone;
  /** The line under the value: what it means, or where it is going. */
  trend?: string;
  value: string;
}) {
  const { colors } = useAppTheme();
  const palette = TILE_TONES[tone];

  const body = (
    <View className="flex-1 gap-2 rounded-2xl border border-border bg-card p-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Text>
        <View className={`h-7 w-7 items-center justify-center rounded-lg ${palette.surface}`}>
          <Ionicons color={colors[TONE_COLOR[tone]]} name={icon} size={14} />
        </View>
      </View>

      <Text className="text-lg font-semibold tracking-tight text-foreground" numberOfLines={1}>
        {value}
      </Text>

      {trend ? (
        <Text numberOfLines={1} variant="caption">
          {trend}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      className="flex-1 active:opacity-70"
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/**
 * A small bordered pill: a fact, or a tap target for one.
 *
 * The mockup's phone/email/link row. On a phone these are worth more than they
 * are on the web — a phone number in a chip is one tap to a call, where the web
 * version is a number to memorise — so `onPress` is the common case rather than
 * the exception.
 */
export function Chip({
  icon,
  label,
  onPress,
  tone = "neutral",
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: "brand" | "neutral";
}) {
  const { colors } = useAppTheme();
  const brand = tone === "brand";

  const body = (
    <View
      className={`max-w-full flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
        brand ? "border-primary/30 bg-brand-soft" : "border-border bg-card"
      }`}
    >
      {icon ? (
        <Ionicons color={brand ? colors.primary : colors.mutedForeground} name={icon} size={13} />
      ) : null}
      <Text
        className={`shrink text-xs font-semibold ${brand ? "text-primary" : "text-foreground"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="button"
      className="shrink active:opacity-70"
      hitSlop={4}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

/**
 * A label on the left, a value on the right — the "Hostel information" table.
 *
 * The value is allowed to wrap onto its own line rather than being squeezed:
 * two columns on a 320dp screen leave about 150dp for the value, and a warden's
 * full name does not fit in it. `<ListRow>` is the pressable, icon-led sibling;
 * this one is for dense read-only facts.
 */
export function FactRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-2.5">
      <Text className="shrink-0 text-sm text-muted-foreground">{label}</Text>
      <View className="flex-1 items-end">
        {typeof value === "string" ? (
          <Text className="text-right text-sm font-medium text-foreground">{value}</Text>
        ) : (
          value
        )}
      </View>
    </View>
  );
}
