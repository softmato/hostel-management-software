import { View } from "react-native";

import { CURRENCY_SCALE } from "@/components/ui/money";
import { Text } from "@/components/ui/text";
import { adminHero } from "@/constants/theme";
import { useAppTheme } from "@/hooks/use-app-theme";
import type { NightChip } from "@/lib/admin-home";

/**
 * The pieces more than one admin screen draws.
 *
 * ## What this file used to be, and why it shrank
 *
 * It began as `admin-chrome.tsx`: a painted app bar and a painted band of
 * figures, applied to Money, Residents, Today, Alerts and More so the group
 * would feel like one product. It did the opposite. Five tabs whose top two
 * hundred points were identical stopped saying *where you are* — sameness at the
 * top of a screen is not a design system, it is a missing signpost — and the
 * owner's reaction to seeing it on a device was immediate and correct.
 *
 * So the shared *layout* went and the shared *language* stayed. Each tab now has
 * its own shape, chosen from what the screen is for:
 *
 * - **Home** — a full-bleed hero with the hostel's photograph behind it. The
 *   front door, so it names the app and the building.
 * - **Money** — a card inset on all four sides with a shadow under it. A
 *   statement is an object you hold, not a surface you stand on.
 * - **Residents** — search in the bar. A directory is something you look into.
 * - **Alerts** — filter tabs first. An inbox is something you triage.
 * - **Today** — the date in the bar, a progress card under it. A shift.
 * - **More** — no coloured object at all. A list of doors should not shout.
 *
 * What is left here is what genuinely recurs: the lift under a floating card,
 * the paint's colour pair, a frosted figure tile and the night chips. Anything
 * that only one screen uses now lives with that screen.
 */

/**
 * Lift for a card that floats over paint or over a list.
 *
 * Both halves are needed and neither is optional: `elevation` is the only thing
 * Android draws, and the `shadow*` trio is the only thing iOS reads. A card
 * overlapping a saturated ground with no shadow does not read as floating above
 * it — it reads as a hole cut in it.
 */
export const FLOAT_SHADOW = {
  elevation: 8,
  shadowColor: "#000000",
  shadowOffset: { height: 6, width: 0 },
  shadowOpacity: 0.13,
  shadowRadius: 16,
} as const;

/**
 * The admin paint, resolved for the active scheme.
 *
 * Two screens use it and they use it in different shapes — Home bleeds it to the
 * edges, Money insets it into a card — which is exactly why the *colour* is
 * shared and the geometry is not.
 */
export function useAdminPaint() {
  const { isDark } = useAppTheme();

  return isDark ? adminHero.dark : adminHero.light;
}

/**
 * An amount on painted ground, with `NPR` smaller than the digits it prefixes.
 *
 * The white-on-accent counterpart to `<Money>`, and a separate component because
 * that one cannot be used here: its tone classes resolve to `text-foreground`,
 * which is near-black in light mode and invisible on the paint.
 *
 * What the two do share is the **ratio**. `CURRENCY_SCALE` is imported rather
 * than repeated, because the currency being smaller than the figure is one
 * decision — taken from the banking apps our users already have, NOTES.md §4 —
 * and two files disagreeing about it by a hundredth is the kind of drift nobody
 * ever notices on purpose.
 *
 * Sized in points rather than by class: every caller computes its size from the
 * string it is about to draw (`heroAmountSize`), and a class name carries no
 * number to take a fraction of.
 *
 * `lineHeight` is not optional, and 1.25 was nowhere near enough of it — see
 * `LINE_HEIGHT`.
 */
/**
 * How much taller than the font the line box has to be.
 *
 * On a device this was clipping the figure at **both** ends: the zeros came back
 * with flat tops and the thousands comma came back as a full stop, its tail cut
 * off below the baseline. That is a line box shorter than the glyphs it is being
 * asked to hold.
 *
 * Two things were wrong and only one of them was the multiplier.
 *
 * No font is bundled with this app, so every phone renders these figures in
 * whatever face its OS ships, and OEM Android skins ship rounded display faces
 * whose ascent and descent run past the Roboto metrics 1.25 quietly assumes.
 *
 * The larger cause was the **nested** currency span. On Android a `Text` whose
 * children carry different font sizes takes its line box from the smaller span,
 * so a 34-point figure was being laid out in a box measured for its own
 * 24-point `NPR` — which is why the two-up at 16 was perfect while the headline
 * above it lost the tops of its zeros and the tail of its comma. The prefix now
 * carries the parent's `lineHeight` explicitly, which is the whole fix; the
 * multiplier only has to cover the font.
 */
const LINE_HEIGHT = 1.45;

export function PaintedAmount({
  className = "font-semibold tracking-tight text-white",
  size,
  value,
}: {
  className?: string;
  /** Point size of the digits. `NPR` is drawn at `CURRENCY_SCALE` of it. */
  size: number;
  /** Already formatted — `formatMoney`, so a missing figure arrives as `—`. */
  value: string;
}) {
  const lineHeight = Math.round(size * LINE_HEIGHT);

  return (
    <Text className={className} numberOfLines={1} style={{ fontSize: size, lineHeight }}>
      {/*
        A dash is not an amount, it is the absence of one, so it keeps the plain
        treatment rather than being given an `NPR` prefix it never had.
      */}
      {value.startsWith("NPR ") ? (
        <>
          {/*
            `text-white` is not redundant, and leaving it off is what shipped a
            card with a near-black `NPR` in front of white digits. React Native
            would inherit the parent's colour — but the parent here is our own
            `<Text>`, which defaults to `variant="body"`, and that variant paints
            `text-foreground` on every instance that does not override it. The
            nested one overrides nothing, so it takes the themed foreground:
            correct by the token, invisible on the paint.
          */}
          <Text
            className="text-white"
            style={{ fontSize: Math.round(size * CURRENCY_SCALE), lineHeight }}
          >
            NPR{" "}
          </Text>
          {value.slice(4)}
        </>
      ) : (
        value
      )}
    </Text>
  );
}

/*
 * A `BannerStat` — a frosted tile carrying a 10pt small-caps label, a glyph and
 * a figure — stood here, and Home's hero drew three of them along its bottom
 * edge: residents, vacant beds, occupancy.
 *
 * They went when the hero was taken to the shape of the account card in
 * `ebl-01`, and the reason is worth keeping. That card has **no such tiles**: a
 * balance, the name it belongs to as a quiet line, and one row of two figures.
 * Ours had six figures in four containers under a seventh in a fifth, which is
 * how a card stops being read at a glance and starts being studied. The three
 * counts are context, never a tap target, so they became one line of text under
 * the headline — `occupancyLine` — and the frosted-object treatment stayed
 * where it earns itself, on `GlassPanel` and the identity row.
 *
 * Its one hard-won rule is not tile-specific and still applies to anything set
 * in that 10pt small-caps: about **eleven characters** fit at three-up on a
 * 320dp phone. Twelve came back as `NOT MOVED…` on a device — pick a shorter
 * word rather than a truer one.
 */

/*
 * A `BannerFacts` pair — two figures split by a hairline — lived here and was
 * drawn once, by Home's hero, where it printed "This month" and "Still to
 * collect" directly above a Money section carrying the same two numbers. The
 * shape later came back to the hero as `Since opening` / `This month` — a
 * lifetime total against the month, which is a comparison rather than the
 * subtraction the Money section was already doing — but inline, on the hero's
 * own paint, so this stayed deleted.
 *
 * Its lesson outlived it and is worth keeping written down: **give each half a
 * fixed fraction of the row, never size the chips to their content.** The first
 * cut wrapped `shrink` chips, and every chip gave up width to its neighbours
 * until all of them ellipsed — `NPR 74,000 this month` came back as
 * `NPR 74,0…`, so the figures the card existed to show were the first thing
 * lost. `AdminMoneyCard` draws the surviving instance of the pattern, on paint
 * of its own, and carries that note with it.
 */

/*
 * An `AttentionRow` lived here — a tinted glyph, a title, a sentence of plain
 * English, a filled count pill and a chevron — and Home drew five of them in one
 * bordered card under the heading "Waiting for you".
 *
 * It was replaced by a two-column grid of `<InfoTile>`s, and the reason is worth
 * keeping: the row was optimised for *reading* and the question it answered was
 * a *looking* question. "Is anything waiting, and roughly how much" is a shape,
 * and five stacked sentences is the slowest possible way to draw a shape. The
 * tiles keep everything the row had that mattered — the tone, the count, the
 * plain-English gloss as a caption — in a quarter of the vertical space.
 *
 * Two of its rules moved into `<InfoTile>` intact and must not be dropped there:
 * **a zero count goes grey whatever the tone**, and **a destination carries no
 * count at all**. Both exist because a screen that shows five coloured pills
 * reading `0` teaches people to ignore the colour on the day one of them is not.
 */

/* -------------------------------------------------------------------------- */
/* Tonight                                                                    */
/* -------------------------------------------------------------------------- */

const CHIP_TONES: Record<NightChip["tone"], { dot: string; text: string; wrap: string }> = {
  danger: {
    dot: "bg-destructive",
    text: "text-destructive",
    wrap: "border-destructive/25 bg-destructive/10",
  },
  neutral: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    wrap: "border-border bg-muted",
  },
  success: { dot: "bg-success", text: "text-success", wrap: "border-success/25 bg-success-soft" },
  warning: { dot: "bg-warning", text: "text-warning", wrap: "border-warning/25 bg-warning-soft" },
};

/**
 * Tonight's roster as a wrapped strip of chips.
 *
 * The stack of label/value rows this replaces spent five lines of screen telling
 * a hostel where everyone is accounted for that everyone is accounted for. A
 * chip strip is one line most nights and grows only when something is wrong —
 * and the ordering does the rest of the work: `nightChips` sorts by how much a
 * status needs a person, so an SOS or an unverified resident is the leftmost
 * chip rather than being alphabetised under the thirty-nine who are safely in.
 *
 * Home's summary of the roster; the Today tab draws the same data as a progress
 * card instead, because there it is the thing being worked through rather than a
 * thing being glanced at.
 */
export function NightStrip({ chips }: { chips: readonly NightChip[] }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {chips.map((chip) => {
        const palette = CHIP_TONES[chip.tone];

        return (
          <View
            className={`flex-row items-center gap-2 rounded-full border px-3 py-1.5 ${palette.wrap}`}
            key={chip.key}
          >
            <View className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
            <Text className={`text-xs font-medium ${palette.text}`}>{chip.label}</Text>
            <Text className={`text-xs font-bold ${palette.text}`}>{chip.count}</Text>
          </View>
        );
      })}
    </View>
  );
}
