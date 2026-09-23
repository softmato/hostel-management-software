import { cssInterop } from "nativewind";
import Animated from "react-native-reanimated";

/**
 * On the phone, `className` on Reanimated's `Animated.View` reaches its style;
 * in the browser it is dropped unless the component is registered, and every
 * view styled that way loses its layout — the tab bar fell into a vertical
 * stack. Registering it here, for the web bundle only, is the whole fix.
 */
cssInterop(Animated.View, { className: "style" });
