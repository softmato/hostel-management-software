import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * A frosted panel for a painted surface — the hero's identity block, its figures
 * and its stat tiles.
 *
 * Flat `bg-white/10` was what these were, and on a photograph that is not a
 * material: it tints whatever is behind it without softening it, so the building's
 * windows and balconies stay sharp *through* the panel and fight the text sitting
 * on it. A blur is what makes a translucent panel read as a pane of glass rather
 * than as a stain, and it is the reason every banking home this screen is modelled
 * on can put small type over artwork and get away with it.
 *
 * ## Android gets the frost without the blur, on purpose
 *
 * `BlurView` only actually blurs on Android when `experimentalBlurMethod` is
 * set, and that implementation works by having the system re-screenshot the
 * window continuously to have something to blur. On the one screen that is
 * always the first thing opened, that is a running cost paid forever for an
 * effect nobody asked for by name — and it put a LogBox warning on the device
 * the moment it was switched on.
 *
 * So the prop is deliberately absent. iOS still gets its real native blur; on
 * Android this composites down to a white wash, which is enough here because of
 * what is *behind* it: the hero draws the hostel's photograph at
 * `PHOTO_WEIGHT`, already faint, so a 20% white panel over it washes the
 * remaining detail out. The frost comes from the two layers together rather than
 * from a shader.
 *
 * If a future screen puts one of these over a full-strength photograph, that
 * reasoning does not carry and the panel will look like a stain again. Raise the
 * overlay there, or blur the image itself — do not reach for the experimental
 * method without measuring what it costs.
 *
 * ## The white is on top of the blur, not instead of it
 *
 * `tint="light"` alone lands somewhere between the ground and white depending on
 * how bright the ground is, which means the panel's colour would change with the
 * hostel's photograph. The explicit overlay fixes the panel's own tone so it is
 * the same object over a bright sky and over a dark stairwell.
 *
 * Kept moderate. White text sits on these, and a panel pushed much further
 * toward white takes that text below the contrast floor — the failure this
 * component is one bad number away from causing.
 */
export function GlassPanel({
  children,
  className = "",
  contentClassName = "",
  radius = 16,
}: {
  children: ReactNode;
  /** The outer box — `flex-1` for a tile in a row, margins, and so on. */
  className?: string;
  /** Padding and layout for the content inside the glass. */
  contentClassName?: string;
  /** Corner radius in points. Applied as a style: it also has to clip the blur. */
  radius?: number;
}) {
  return (
    <View
      className={`overflow-hidden border border-white/25 ${className}`}
      style={{ borderRadius: radius }}
    >
      <BlurView intensity={24} tint="light">
        <View className={`bg-white/20 ${contentClassName}`}>{children}</View>
      </BlurView>
    </View>
  );
}
