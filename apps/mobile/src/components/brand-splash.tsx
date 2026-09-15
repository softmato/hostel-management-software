import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeOut } from "react-native-reanimated";

import { APP_NAME, POWERED_BY } from "@/constants/branding";
import { palette } from "@/constants/theme";

/**
 * The JS half of the launch screen.
 *
 * The native splash draws two things: the HostelPalika lockup in the centre
 * (`windowSplashScreenAnimatedIcon`, from the `expo-splash-screen` block in
 * app.json) and the "Powered by Softmato" strip at the bottom
 * (`windowSplashScreenBrandingImage`, added by `plugins/withSplashBranding.js`).
 * This reproduces both at the same sizes and positions, so when
 * `SplashScreen.hideAsync()` runs in `_layout.tsx` nothing moves — no entrance
 * animation, no reflow. It is the only place the strip appears on Android 11
 * and below and on iOS, where the system splash has no branding slot.
 *
 * Geometry is mirrored from `scripts/gen_splash.py`; re-run it and keep these in sync:
 *   - `LOGO_WIDTH`  ← `imageWidth` in app.json
 *   - `LOGO_HEIGHT` ← the canvas ratio the script prints
 *   - `STRIP_*`     ← the dp size the drawables in `plugins/splash-branding-res` are cut for
 *   - `STRIP_BOTTOM` ← Android's fixed 60dp branding-image inset
 */

const LOGO_WIDTH = 280;
const LOGO_HEIGHT = Math.round(LOGO_WIDTH * (510 / 1024));

const STRIP_WIDTH = 136;
const STRIP_HEIGHT = 55;
const STRIP_BOTTOM = 60;

/** How long the cold-start cover holds before it starts leaving. */
const HOLD_MS = 900;
const FADE_OUT_MS = 320;

/**
 * Laid over the whole app once, on cold start, so the branded screen holds long
 * enough to be read and then fades out as one piece. The app boots underneath;
 * if boot outlasts the cover, the gate's own `BrandSplash` is already drawn
 * below it with identical pixels, so lifting the cover changes nothing visible.
 */
export function BootSplashCover() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      exiting={FadeOut.duration(FADE_OUT_MS).easing(Easing.in(Easing.quad))}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.cover]}
    >
      <BrandSplash />
    </Animated.View>
  );
}

/** The static launch screen, also shown while the boot gate decides where to go. */
export function BrandSplash() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.ground]}>
      {/* Centred on the whole screen, like the native splash; the strip is absolute so it cannot pull the logo up. */}
      <View style={styles.logoSlot}>
        <Image
          accessibilityLabel={APP_NAME}
          fadeDuration={0}
          resizeMode="contain"
          source={require("../../assets/images/splash-logo.png")}
          style={styles.logo}
        />
      </View>

      <View style={styles.stripSlot}>
        <Image
          accessibilityLabel={POWERED_BY}
          fadeDuration={0}
          resizeMode="contain"
          source={require("../../assets/images/splash-branding.png")}
          style={styles.strip}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { elevation: 9999, zIndex: 9999 },
  ground: { backgroundColor: palette.light.background },
  logo: { height: LOGO_HEIGHT, width: LOGO_WIDTH },
  logoSlot: { alignItems: "center", inset: 0, justifyContent: "center", position: "absolute" },
  strip: { height: STRIP_HEIGHT, width: STRIP_WIDTH },
  stripSlot: { alignItems: "center", bottom: STRIP_BOTTOM, left: 0, position: "absolute", right: 0 },
});
