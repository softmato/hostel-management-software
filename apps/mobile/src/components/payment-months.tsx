import { Pressable, ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";
import { formatPeriodBoth } from "@/lib/format";
import type { PaymentMonth } from "@/lib/payment-months";

/**
 * The month strip, and the line that names the month it selected.
 *
 * ## The chip is Gregorian, the line is both calendars
 *
 * A chip has room for `Aug` and a year and nothing else, and a chip reading
 * `Shrawan–Bhadra` would be both unreadable at that width and a lie by rounding
 * — a Gregorian month runs through two Nepali ones. So the strip is AD, which
 * is what a phone's own clock and every bank statement agree on, and the full
 * both-calendar name is spelled out underneath where there is room for it:
 * `August 2026 · Shrawan–Bhadra 2083`.
 *
 * That line is not decoration. The hostel's books are kept in BS and the
 * statement being reconciled against them is in AD, and the moment those two
 * are converted in somebody's head is the moment a payment lands in the wrong
 * month.
 *
 * ## The count sits on the chip's shoulder
 *
 * Where a phone home screen puts a notification count, for the same reason: it
 * is answering "which of these needs me" before anything has been tapped.
 * `<InfoTile>` draws its corner count the same way, so the two read as the same
 * kind of object. See `lib/payment-months.ts` for why a month with nothing
 * waiting has no badge rather than a zero.
 */
export function PaymentMonthStrip({
  months,
  onSelect,
  value,
}: {
  months: PaymentMonth[];
  onSelect: (period: string) => void;
  value: string;
}) {
  if (months.length === 0) {
    return null;
  }

  return (
    <View className="gap-2">
      <ScrollView
        /*
          `pt-2` on the container, not the chips: the badge is positioned above
          the chip's own top edge, and a scroll view clips its children — without
          the padding the count is sliced in half by the edge of the strip.
        */
        contentContainerClassName="gap-2 px-5 pt-2"
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {months.map((month) => {
          const selected = month.period === value;

          return (
            <Pressable
              accessibilityLabel={[
                formatPeriodBoth(month.period),
                month.waiting > 0 ? `${month.waiting} waiting` : null,
              ]
                .filter(Boolean)
                .join(", ")}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              className={`min-w-[64px] items-center rounded-2xl border px-3 py-2 active:opacity-70 ${
                selected
                  ? "border-primary bg-brand-soft"
                  : "border-border bg-card"
              }`}
              key={month.period}
              onPress={() => onSelect(month.period)}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? "text-primary" : "text-foreground"
                }`}
              >
                {month.label}
              </Text>
              <Text className="text-[11px] text-muted-foreground">
                {month.year}
              </Text>

              {month.waiting > 0 ? (
                <View
                  className="absolute -top-2 right-1 h-5 items-center justify-center rounded-full bg-warning px-1.5"
                  // A style rather than `min-w-[20px]`, matching `<InfoTile>`:
                  // a two-digit count must not squash into an oval.
                  style={{ minWidth: 20 }}
                >
                  <Text className="text-[11px] font-bold text-white">
                    {month.waiting}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <Text className="px-5" variant="caption">
        {formatPeriodBoth(value)}
      </Text>
    </View>
  );
}
