import * as Haptics from "expo-haptics";
import { Pressable, ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";

/**
 * A row of mutually exclusive views — pick one, the list below changes.
 *
 * ## Why this and not filter chips
 *
 * Material 3 draws the line at *how many* and *how exclusive*: segmented buttons
 * are for a small set, two to five, where the options exclude each other and the
 * change happens instantly; filter chips are for refining and exploring, where
 * more than one can be on and there may be a dozen of them. Every use of this in
 * the app is "show me one of these four lists", which is squarely the first case
 * — and chips would imply the wrong thing, that you could tick two.
 *
 * Five is the cap and it is a real one, not a style note: the track is the
 * screen's width, so a sixth segment takes each label under the width its text
 * needs and the row starts ellipsing. `count` is where to add a filter sheet
 * instead, not a sixth segment.
 *
 * ## Counts on the labels
 *
 * A segment that says how many rows it holds answers "is it worth tapping"
 * before it is tapped, which is most of what these are for on a queue screen.
 * They are part of the label rather than a badge because a badge on a segment
 * this size is a dot nobody can read, and the number is the point.
 *
 * ## It scrolls, but only as an escape hatch
 *
 * A phone at the largest system font size takes about 40% more width per label,
 * and four segments that fit at the default size do not fit there. The track
 * scrolls horizontally rather than shrinking the text below legibility — the
 * layout stays wrong-but-usable instead of becoming unreadable, which is the
 * trade accessibility settings should always get.
 */
export function Segmented<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  /** Two to five. See the note above about the cap. */
  options: readonly { count?: number; label: string; value: T }[];
  value: T;
}) {
  return (
    <ScrollView
      contentContainerClassName="grow"
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      <View className="flex-1 flex-row gap-1 rounded-full border border-border bg-muted p-1">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <Pressable
              accessibilityLabel={
                option.count === undefined
                  ? option.label
                  : `${option.label}, ${option.count}`
              }
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className={`flex-1 items-center justify-center rounded-full px-3 py-2 ${
                active ? "bg-card" : ""
              }`}
              key={option.value}
              onPress={() => {
                if (active) {
                  return;
                }

                void Haptics.selectionAsync();
                onChange(option.value);
              }}
              style={
                active
                  ? {
                      elevation: 2,
                      shadowColor: "#000000",
                      shadowOffset: { height: 1, width: 0 },
                      shadowOpacity: 0.1,
                      shadowRadius: 3,
                    }
                  : undefined
              }
            >
              <Text
                className={`text-center text-xs ${
                  active ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
                }`}
                numberOfLines={1}
              >
                {option.count === undefined ? option.label : `${option.label} ${option.count}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
