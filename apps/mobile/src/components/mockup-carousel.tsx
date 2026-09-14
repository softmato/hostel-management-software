import { useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";

import { MockupImage } from "@/components/mockup-image";
import { Text } from "@/components/ui/text";
import type { Mockup } from "@/lib/portal-mockups";

/** Matches the `Screen` gutter the carousel sits inside. */
const GUTTER = 20;

/**
 * The website's screenshot slideshow, as a phone does it: one screen per swipe,
 * with a label above and page dots below.
 *
 * It does not advance on its own. The website's does, but DESIGN.md §8 keeps
 * continuous motion for the SOS badge alone — and a strip that moves while
 * somebody is reading the sentence under it takes the sentence away.
 */
export function MockupCarousel({
  slides,
  title,
}: {
  slides: readonly { label: string; mockup: Mockup }[];
  title: string;
}) {
  const { width } = useWindowDimensions();
  const pageWidth = width - GUTTER * 2;
  const [index, setIndex] = useState(0);

  return (
    <View className="gap-3">
      <Text variant="subtitle">{title}</Text>
      <View className="overflow-hidden rounded-3xl border border-border bg-muted/40">
        <ScrollView
          decelerationRate="fast"
          horizontal
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / pageWidth))
          }
          pagingEnabled
          showsHorizontalScrollIndicator={false}
        >
          {slides.map((slide) => (
            <View className="gap-2 px-4 pb-4 pt-3" key={slide.label} style={{ width: pageWidth }}>
              <View className="self-center rounded-full border border-border bg-background px-3 py-1">
                <Text className="font-semibold" variant="caption">
                  {slide.label}
                </Text>
              </View>
              <MockupImage mockup={slide.mockup} />
            </View>
          ))}
        </ScrollView>
      </View>
      <View className="flex-row flex-wrap justify-center gap-1.5">
        {slides.map((slide, dot) => (
          <View
            className={`h-1.5 rounded-full ${dot === index ? "w-5 bg-primary" : "w-1.5 bg-border"}`}
            key={slide.label}
          />
        ))}
      </View>
    </View>
  );
}
