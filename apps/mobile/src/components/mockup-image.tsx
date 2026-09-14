import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import type { Mockup } from "@/lib/portal-mockups";

/**
 * One product screenshot, sized by its own aspect ratio.
 *
 * A skeleton holds the space until the file lands, so the page never shifts
 * under the reader, and the picture fades in over it. A file that fails to
 * load — an offline first launch, a website deploy that predates the mockups —
 * takes its space with it rather than leaving a grey box that looks broken.
 */
export function MockupImage({ mockup }: { mockup: Mockup }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [width, setWidth] = useState(0);

  if (state === "failed") return null;

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ aspectRatio: mockup.aspect, width: "100%" }}
    >
      {state === "loading" && width > 0 ? (
        <View className="absolute inset-0">
          <Skeleton height={Math.round(width / mockup.aspect)} radius={16} />
        </View>
      ) : null}
      <Animated.View
        className="flex-1"
        entering={FadeIn.duration(300).reduceMotion(ReduceMotion.System)}
      >
        <Image
          accessibilityLabel={mockup.alt}
          cachePolicy="memory-disk"
          contentFit="contain"
          onError={() => setState("failed")}
          onLoad={() => setState("ready")}
          source={{ uri: mockup.uri }}
          style={{ flex: 1 }}
          transition={300}
        />
      </Animated.View>
    </View>
  );
}
