import { DotLottie } from "@lottiefiles/dotlottie-react-native";
import type { ComponentProps } from "react";
import { useReducedMotion } from "react-native-reanimated";

/**
 * A `.lottie` animation, square, sized in dp.
 *
 * The one place animations are mounted, so reduce-motion is honoured
 * everywhere: with it on, the first frame is shown and nothing plays.
 * The native view needs a rebuild after install — it is not in Expo Go.
 */
export function Lottie({
  loop = true,
  size = 120,
  source,
}: {
  loop?: boolean;
  size?: number;
  source: ComponentProps<typeof DotLottie>["source"];
}) {
  const reduced = useReducedMotion();

  return (
    <DotLottie
      autoplay={!reduced}
      loop={loop && !reduced}
      source={source}
      style={{ height: size, width: size }}
    />
  );
}
