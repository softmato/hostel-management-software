import { Text } from "@/components/ui/text";
import { formatMoney } from "@/lib/format";

/**
 * How much smaller the `NPR` is than the digits it prefixes.
 *
 * Every banking app our users already have does this — see
 * `ui_inspiration_folder/app_recordings/NOTES.md` §4. The reason it matters is
 * that the currency is the one part of the string that is **the same on every
 * row**: at equal weight it is pure repetition competing with the figures, and
 * shrinking it lets a column of amounts be scanned by their digits alone.
 *
 * A ratio rather than a fixed size, because this renders at four scales from an
 * inline row to a 30-point display figure — and exported, because the painted
 * surfaces cannot use this component (its tone classes resolve to
 * `text-foreground`, which is near-black on the accent) and must not re-decide
 * the ratio. See `<PaintedAmount>`.
 */
export const CURRENCY_SCALE = 0.72;

const SIZES = {
  display: "text-3xl font-semibold tracking-tight",
  inline: "text-base",
  large: "text-2xl font-semibold tracking-tight",
} as const;

/**
 * The point size each class in `SIZES` actually resolves to.
 *
 * Duplicated from Tailwind's scale because the currency prefix is sized as a
 * *fraction* of its parent, and a class name carries no number to take a
 * fraction of. If a size above is changed, change it here too — they are one
 * fact written twice, which is the trade for not hard-coding four more classes.
 */
const SIZE_PT: Record<keyof typeof SIZES, number> = {
  display: 30,
  inline: 16,
  large: 24,
};

/**
 * An amount, rendered the one way the app renders amounts.
 *
 * The tone rule is the reason this is a component rather than a call to
 * `formatMoney`: an outstanding balance is the number the screen exists to
 * communicate, and it should be the loudest thing on it, while a zero balance
 * should be quiet — "NPR 0" in red is a false alarm. `owed` colours by the
 * value, so no screen has to decide.
 */
export function Money({
  className = "",
  owed = false,
  size = "inline",
  value,
}: {
  className?: string;
  /** Colour by whether anything is actually outstanding. */
  owed?: boolean;
  size?: keyof typeof SIZES;
  value: number | null | undefined;
}) {
  const tone = owed
    ? (value ?? 0) > 0
      ? "text-destructive"
      : "text-success"
    : "text-foreground";

  const text = formatMoney(value);

  /*
   * A dash is not an amount — it is the absence of one — so it keeps the plain
   * treatment. Splitting on the first space would otherwise give it a `NPR`
   * prefix it never had and a nested `Text` with nothing in it.
   */
  const prefix = text.startsWith("NPR ") ? "NPR" : null;

  return (
    <Text className={`${SIZES[size]} ${tone} ${className}`}>
      {prefix ? (
        <>
          {/*
            Nested `Text`, which on React Native inherits the parent's colour and
            weight and overrides only what it names — so the currency stays the
            same tone as its digits and only the size changes. `fontSize` has to
            be a style: the parent's size comes from a class, so there is no
            number here to write a class against.
          */}
          <Text style={{ fontSize: SIZE_PT[size] * CURRENCY_SCALE }}>{prefix} </Text>
          {text.slice(4)}
        </>
      ) : (
        text
      )}
    </Text>
  );
}
