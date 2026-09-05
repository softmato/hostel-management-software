import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

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
  /**
   * Full-bleed body: the children run to the sheet's own edges instead of
   * sitting inside the gutter. Only `SheetRow` lists want this — a row is meant
   * to be edge-to-edge so its press area reaches the sides, and it carries the
   * gutter in its own padding. Anything else — a form, a paragraph, a stack of
   * buttons — must not set it.
   */
  bare?: boolean;
  children: ReactNode;
  /** Pinned under the scrolling content — an Apply button, usually. */
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  /**
   * Open at nearly the full screen instead of at the usual floor.
   *
   * For the handful of sheets that are a **workspace** rather than a question —
   * `manage/statements`' reconciliation results is the one this was added for:
   * a summary grid, a filter, a second filter and a list of decisions, which at
   * two thirds arrived with the first row of actual work below the fold. A
   * sheet the caller has to scroll before it has said anything is a screen
   * wearing a sheet's clothes, and this is the cheaper of the two fixes.
   *
   * Not the default, because it is wrong for every other sheet in the app: a
   * `<Select>`'s three options at 90% of the screen is a wall of white with a
   * list along the top.
   */
  tall?: boolean;
  title?: string;
};

/**
 * The sheet's gutter, in points — the same 20 the title and footer rows use as
 * `px-5`, and the same as `SheetRow`'s own padding, so a row list and a form
 * line up down both edges.
 *
 * It lives on the container rather than on each caller's wrapper `<View>`.
 * Every caller wrote `className="gap-3 pb-2"` and two of nineteen remembered to
 * add `px-5`, so seventeen sheets rendered their labels against the left edge
 * and their inputs bleeding off both — the "Edit details" form on the resident
 * record being the worst of them. A default that has to be re-typed per screen
 * to be correct is not a default.
 */
const GUTTER = 20;

/**
 * The least of the window a sheet's body may occupy, as a fraction.
 *
 * Dynamic sizing alone measures the content and stops there, which is right for
 * a long form and wrong for everything else: a two-line confirmation opened as a
 * 140-point strip along the bottom edge, far enough from the thumb's reach to
 * read as a toast that had gone wrong rather than as a surface asking a
 * question. A floor puts every sheet at about half the screen, so they all
 * arrive at the same height and the content grows downward from a known place —
 * and anything taller than the floor still measures itself as before, up to the
 * `topInset` cap.
 */
const MIN_BODY_FRACTION = 0.45;

/**
 * The floor for a sheet that pins a button under its body.
 *
 * A footer is a sibling of the scroll view, not part of what dynamic sizing
 * measures, so it takes its height *out* of the body rather than adding to the
 * sheet — the fee panel opened with its "Why" field half-covered by "Set this
 * fee", which reads as a broken layout rather than as a list that scrolls. A
 * taller floor gives the footer its room back and then some: a sheet with a
 * button is a sheet that is asking for input, and those are the ones worth
 * opening at two thirds rather than at a half.
 */
const MIN_BODY_FRACTION_WITH_FOOTER = 0.66;

/** The floor for {@link SheetProps.tall}. Just short of the `topInset` cap. */
const MIN_BODY_FRACTION_TALL = 0.88;

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

export function Sheet({
  bare = false,
  children,
  footer,
  onClose,
  open,
  tall = false,
  title,
}: SheetProps) {
  const { colors } = useAppTheme();
  const insets = useSystemInsets();
  /* The floor under `MIN_BODY_FRACTION` is a fraction of *this* window, not of a
     constant: the same app runs on a 5-inch phone and a tablet in split view. */
  const window = useWindowDimensions();
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
       * The sheet only drags on a *vertical* finger, and gives up on a
       * horizontal one.
       *
       * gorhom wraps its content in an unconstrained `Gesture.Pan()`, which
       * activates on movement in any direction. It declares itself simultaneous
       * only with scrollables it created (`BottomSheetScrollView` and friends
       * register a native gesture with it), so **any other nested scroller is
       * silently dead**: the pan claims the touch and the child never sees it.
       *
       * That is what made the service deck on `manage/maintenance` render
       * perfectly and refuse to move — a horizontal `ScrollView` inside a sheet,
       * with the sheet eating every swipe.
       *
       * `activeOffsetY` makes the sheet wait for 8px of vertical intent before
       * it starts dragging; `failOffsetX` makes it stand down entirely once the
       * finger has travelled 12px sideways. Asymmetric on purpose: giving up is
       * cheaper to get wrong than taking over, because a sheet that failed to
       * drag can be dragged again, and a sheet that stole a swipe has already
       * ruined the gesture. Vertical drag-to-dismiss and the handle are
       * unaffected.
       */
      activeOffsetY={[-8, 8]}
      failOffsetX={[-12, 12]}
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
      /*
       * `push`, not gorhom's default `switch` — and this is a bug fix, not a
       * preference.
       *
       * A `<Select>` inside a sheet is itself a sheet, and it is rendered *in the
       * parent sheet's own children*. Under `switch`, presenting it minimizes the
       * parent, which fires the parent's `onDismiss` — so the caller's `open`
       * flips to false, the parent unmounts, and the option list unmounts with it
       * because it was living inside the subtree that just went away. Tapping
       * "Active" on the Status sheet therefore closed the whole thing and offered
       * nothing: no options, no sheet, back to the record.
       *
       * `push` mounts the new sheet on top and leaves the one underneath
       * presented, which is also the right reading of the gesture — the option
       * list is a step *into* the sheet, not a replacement for it.
       */
      stackBehavior="push"
      // Dynamic sizing measures the content and caps at the space above this,
      // so a long option list stops short of the status bar and scrolls inside
      // the sheet instead of running under the clock.
      topInset={insets.top}
    >
      {title ? (
        /*
         * The title row carries an explicit close.
         *
         * The sheet has always been draggable and that is still its main exit —
         * but "drag the panel down" is knowledge, not an affordance, and the
         * people this app is for do not have it. Every caller already passes
         * `onClose`, so the button costs nothing and no sheet has to opt in.
         */
        <View className="flex-row items-start gap-3 border-b border-border px-5 pb-3">
          <View className="flex-1">
            <Text variant="subtitle">{title}</Text>
          </View>

          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            className="-mt-1 h-8 w-8 items-center justify-center rounded-full bg-muted active:opacity-70"
            hitSlop={8}
            onPress={onClose}
          >
            <Ionicons color={colors.mutedForeground} name="close" size={18} />
          </Pressable>
        </View>
      ) : null}

      <BottomSheetScrollView
        contentContainerStyle={{
          minHeight:
            window.height *
            (tall
              ? MIN_BODY_FRACTION_TALL
              : footer
                ? MIN_BODY_FRACTION_WITH_FOOTER
                : MIN_BODY_FRACTION),
          // 16, not 8: the last field ends clear of the footer's hairline rather
          // than against it once a long form does scroll.
          paddingBottom: footer ? 16 : Math.max(insets.bottom, 16),
          paddingHorizontal: bare ? 0 : GUTTER,
          // A title draws its own hairline; without one the content would
          // otherwise start against the drag handle.
          paddingTop: bare ? 0 : title ? 12 : 4,
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
  leading,
  onPress,
  selected = false,
  subtitle,
  trailing,
}: {
  label: string;
  /**
   * Ahead of the label — an avatar, a logo tile.
   *
   * Added for the claim form's "How did you pay?" list, where six wallet names
   * in identical grey type is exactly the list a brand mark is for. Optional and
   * unset everywhere else, so the nineteen existing sheets are unchanged.
   */
  leading?: ReactNode;
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
      {leading}
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
