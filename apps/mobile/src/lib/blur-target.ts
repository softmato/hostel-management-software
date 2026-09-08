import { createRef } from "react";
import type { View } from "react-native";

/**
 * The app's content, as something Android's blur can actually read.
 *
 * ## Why this exists
 *
 * `expo-blur@57` changed how Android blurs. `blurMethod="dimezisBlurView"` on
 * its own now does **nothing**: the library logs
 *
 * > the `blurTarget` prop has not been configured … will fallback to "none"
 *
 * and renders a flat tint. Android has no equivalent of the iOS backdrop
 * material that samples whatever happens to be behind a layer, so the view to be
 * blurred has to be named — it is drawn once into an offscreen buffer, and the
 * `BlurView` blurs *that*. iOS ignores the prop entirely and keeps sampling its
 * own backdrop.
 *
 * ## Why a module-level ref rather than a context
 *
 * There is exactly one thing worth blurring — the app — and exactly one place
 * that blurs it, the confirm dialog at the root. A context for a value that is
 * created once and never changes is ceremony; this is the same reasoning that
 * keeps `lib/asset-viewer.ts` and `lib/confirm.ts` off Redux.
 *
 * ## What must sit inside it, and what must not
 *
 * `<BlurTargetView ref={appBlurTarget}>` wraps the navigator and the in-window
 * overlays in `app/_layout.tsx`. The blurring view **cannot be inside its own
 * target** — that is a view drawing itself — so the confirm dialog is mounted as
 * a sibling after it, which is also what puts it on top.
 *
 * `Modal`-based overlays (`<AssetViewer />`) are their own window and are never
 * captured wherever they are placed. That is the same limitation that stopped
 * the dialog being a modal in the first place; see `ui/confirm-dialog.tsx`.
 */
export const appBlurTarget = createRef<View>();
