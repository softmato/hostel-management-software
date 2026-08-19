import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";

/**
 * The bottom sheet every "pick one of these" and "confirm this" surface uses.
 *
 * ## Why gorhom and not a plain `<Modal>`
 *
 * `hostel-browser.tsx`'s filter panel is a full-screen `Modal`, which is right
 * for a panel with its own header and footer. A sheet is the other shape: it
 * sits over the screen you came from, it is shorter than the screen, and people
 * expect to **drag it away**. A `Modal` cannot be dragged, so its only exit is a
 * close button — and a sheet with no drag reads as broken rather than as a
 * different component. `BottomSheetModalProvider` was already mounted at the
 * root for exactly this.
 *
 * ## Declarative, because every caller already has the boolean
 *
 * gorhom's API is imperative (`present()` / `dismiss()` on a ref). Screens here
 * hold `const [open, setOpen] = useState(false)`, so the ref is kept private and
 * driven from the prop. `onDismiss` fires for *every* close — the drag, the
 * backdrop tap, and our own `dismiss()` — so `onClose` must be idempotent; every
 * caller's is, because it sets the same boolean to false.
 *
 * ## `presented` is not bookkeeping — it is the bug fix
 *
 * Bridging a boolean to two imperative methods invites writing the effect as
 * `open ? present() : dismiss()`, and that is what this was. It meant every
 * sheet in the app called `dismiss()` once on mount, on a modal that had never
 * been presented — and **that call silently killed the sheet for the rest of the
 * screen's life**.
 *
 * The path through `@gorhom/bottom-sheet@5`, which is worth writing down because
 * nothing about it is visible from the outside:
 *
 * 1. A fresh modal's internal status is `INITIAL`.
 * 2. `dismiss()` early-exits only for `CLOSED` and `MINIMIZED`. `INITIAL` is
 *    neither, so it falls through, sets the status to `DISMISSING` and calls
 *    `forceClose()` on a sheet ref that is still `null` — a no-op.
 * 3. Nothing ever clears `DISMISSING`: the status only advances to `DISMISSED`
 *    from the sheet's own `onClose`, and there is no sheet to fire it.
 * 4. `present()` then mounts the portal — and the portal's own render callback
 *    begins `if (status === DISMISSING) return`.
 *
 * So the tap ran, the state flipped, the modal "mounted", and **nothing was
 * drawn**: no sheet, no backdrop, not even a dimmed screen. Every caller looked
 * like a dead button — the ID card prompt in the discovery header, every
 * `<Select>`, the complaint and community sheets.
 *
 * The fix is to make the imperative calls match reality rather than the prop:
 * present only when it is not already up, dismiss only when it is. The ref is
 * cleared in `onDismiss` too, because a drag or a backdrop tap closes the sheet
 * *inside* gorhom and then tells us — without that, the `open → false` this
 * causes would send a second `dismiss()` into a modal that had just reset itself
 * to `INITIAL`, poisoning it exactly as the mount call did.
 *
 * ## Insets
 *
 * The sheet is the bottom-most thing on screen while it is open, so it is the
 * one that reserves `insets.bottom` (§0 of MOBILE_APP_PHASES.md: exactly one,
 * never two). Under three-button navigation that is ~48dp of opaque buttons,
 * which without this lands on top of the last option in the list.
 */

type SheetProps = {
  children: ReactNode;
  /** Pinned under the scrolling content — an Apply button, usually. */
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
};

function renderBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      // Tapping outside closes it. `-1` is the closed index, so animating out to
      // it is what makes the backdrop fade rather than disappear in one frame.
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  );
}

export function Sheet({ children, footer, onClose, open, title }: SheetProps) {
  const { colors } = useAppTheme();
  const insets = useSystemInsets();
  const ref = useRef<BottomSheetModal>(null);

  /** Whether the sheet is up *in gorhom* — not what the prop currently says. */
  const presented = useRef(false);

  useEffect(() => {
    if (open) {
      if (!presented.current) {
        presented.current = true;
        ref.current?.present();
      }

      return;
    }

    if (presented.current) {
      presented.current = false;
      ref.current?.dismiss();
    }
  }, [open]);

  /*
   * Every close funnels through here — the drag, the backdrop, and our own
   * `dismiss()` above — so this is the one place that can say the sheet is
   * really down before `onClose` flips the caller's boolean.
   */
  const handleDismiss = useCallback(() => {
    presented.current = false;
    onClose();
  }, [onClose]);

  return (
    <BottomSheetModal
      /*
       * Android's window resizes with the keyboard now
       * (`softwareKeyboardLayoutMode: "resize"` in app.json), so the sheet is told
       * to expect that rather than to pan itself — `adjustPan` was what made a
       * sheet with a text field jump or clip. The confirm-a-complaint sheet is the
       * one that actually holds a multiline field.
       */
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.card }}
      enableDynamicSizing
      /*
       * `interactive` follows the keyboard as it animates instead of snapping
       * once it has finished, which is what keeps the field the thumb is aimed at
       * under the thumb.
       */
      keyboardBehavior="interactive"
      // The sheet stays put when the keyboard closes; dismissing it as well would
      // throw away a half-typed note on a stray tap outside the field.
      keyboardBlurBehavior="none"
      enablePanDownToClose
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      onDismiss={handleDismiss}
      ref={ref}
      // Dynamic sizing measures the content and caps at the space above this,
      // so a long option list stops short of the status bar and scrolls inside
      // the sheet instead of running under the clock.
      topInset={insets.top}
    >
      {title ? (
        <View className="border-b border-border px-5 pb-3">
          <Text variant="subtitle">{title}</Text>
        </View>
      ) : null}

      <BottomSheetScrollView
        contentContainerStyle={{
          paddingBottom: footer ? 8 : Math.max(insets.bottom, 16),
        }}
      >
        {children}
      </BottomSheetScrollView>

      {footer ? (
        <View
          className="border-t border-border px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {footer}
        </View>
      ) : null}
    </BottomSheetModal>
  );
}

/**
 * One tappable row inside a sheet.
 *
 * Kept here rather than in `list-row.tsx` because a sheet row is edge-to-edge
 * and 52dp tall — the sheet is often reached one-handed with a thumb, and the
 * list row's denser padding is a miss target in that position.
 */
export function SheetRow({
  label,
  onPress,
  selected = false,
  subtitle,
  trailing,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  subtitle?: string;
  trailing?: ReactNode;
}) {
  const handlePress = useCallback(() => onPress(), [onPress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="flex-row items-center gap-3 px-5 py-3.5 active:bg-muted"
      onPress={handlePress}
    >
      <View className="flex-1">
        <Text className={selected ? "text-primary" : undefined} variant="subtitle">
          {label}
        </Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}
