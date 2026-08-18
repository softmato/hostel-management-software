import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

import { SaveButton } from "@/components/hostel-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import { coverPhoto, locationLabel, priceRange, ratingDisplay } from "@/lib/hostel-display";
import { absoluteMediaUrl } from "@/lib/media";
import { HOSTEL_TYPE_LABELS, type PublicHostel } from "@/lib/public-api";

/**
 * The top of the home screen: real listings, sliding on their own.
 *
 * ## What this replaced, and why
 *
 * A full-width green card with a headline, a search field and three trust chips
 * — the mockup's hero. It filled the first screenful with copy nobody reads and
 * one photo, on a screen whose entire job is showing hostels. This puts the
 * hostels there instead, at the size a photo is actually worth looking at, and
 * the search field moved up into the header where it is reachable without
 * scrolling.
 *
 * ## Auto-advance, and how it stops
 *
 * It slides every few seconds and then **yields to the user permanently**: the
 * first drag cancels the timer for the life of the screen. A carousel that
 * resumes after a delay takes the card away from under the thumb of the person
 * reading it, which is the one thing an auto-slider must not do — and "resume
 * after N seconds" is a race with how long someone spends reading.
 *
 * Three other things switch it off, all for the same underlying reason — an
 * animation nobody is watching is a battery and a vestibular problem, not a
 * feature:
 *
 * - **Reduce Motion.** Honoured, and re-read live: this is an unprompted,
 *   repeating, horizontal movement, which is exactly what the setting exists for.
 * - **Blur.** `useFocusEffect` stops the timer when the screen is not on top, so
 *   a phone left on the notifications screen is not animating a list behind it.
 * - **One card.** Nothing to advance to; the dots are hidden too.
 *
 * ## Widths are measured, not assumed
 *
 * The card width comes from `useWindowDimensions`, so it follows a rotation and
 * a foldable rather than baking in a phone-sized constant. `snapToInterval` does
 * the paging instead of `pagingEnabled`, because a gap between cards means one
 * page is *not* one screen width and `pagingEnabled` would drift a little
 * further out of alignment on every swipe.
 */

const SLIDE_MS = 4_500;
const CARD_GAP = 12;
/** `Screen`'s `px-5` on both sides — the card is inset, not full-bleed. */
const PAGE_INSET = 40;
const IMAGE_HEIGHT = 200;

export type HostelShowcaseProps = {
  hostels: PublicHostel[];
  /** True on the very first load, when there is nothing to draw yet. */
  loading?: boolean;
  onToggleSave: (hostel: PublicHostel) => void;
  savedIds: Set<string>;
};

export function HostelShowcase({
  hostels,
  loading = false,
  onToggleSave,
  savedIds,
}: HostelShowcaseProps) {
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  /*
   * The live index lives in a ref, and only the dots read state. Putting it in
   * state alone would list `index` as a dependency of the interval effect, which
   * tears down and rebuilds the timer on every advance — so the interval would
   * restart mid-cycle and the slide would arrive early.
   */
  const index = useRef(0);
  const [dot, setDot] = useState(0);
  const [surrendered, setSurrendered] = useState(false);
  const [focused, setFocused] = useState(true);
  const reduceMotion = useReduceMotion();

  const cardWidth = Math.max(1, width - PAGE_INSET);
  const step = cardWidth + CARD_GAP;
  const count = hostels.length;
  const sliding = focused && !surrendered && !reduceMotion && count > 1;

  useFocusEffect(
    useCallback(() => {
      setFocused(true);

      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    if (!sliding) {
      return;
    }

    const timer = setInterval(() => {
      const next = (index.current + 1) % count;

      index.current = next;
      setDot(next);
      scroller.current?.scrollTo({ animated: true, x: next * step });
    }, SLIDE_MS);

    return () => clearInterval(timer);
  }, [count, sliding, step]);

  /*
   * A shrinking list can leave the scroller parked past its own end — the
   * catalogue is refetched on every focus, and a hostel can be delisted between
   * two of those. Rewinding to the first card is the only position guaranteed to
   * exist.
   */
  useEffect(() => {
    if (index.current >= count) {
      index.current = 0;
      setDot(0);
      scroller.current?.scrollTo({ animated: false, x: 0 });
    }
  }, [count]);

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const landed = Math.round(event.nativeEvent.contentOffset.x / step);

      index.current = Math.max(0, Math.min(landed, count - 1));
      setDot(index.current);
    },
    [count, step],
  );

  if (loading && count === 0) {
    return <Skeleton height={IMAGE_HEIGHT + 76} radius={24} />;
  }

  // No hostel with a usable photo. The rows below still work, and an empty
  // 200px frame at the top of the screen reads as a broken app.
  if (count === 0) {
    return null;
  }

  return (
    <View className="gap-3">
      <ScrollView
        contentContainerStyle={{ gap: CARD_GAP }}
        decelerationRate="fast"
        horizontal
        onMomentumScrollEnd={onMomentumEnd}
        // The first drag is the handover. See the note above.
        onScrollBeginDrag={() => setSurrendered(true)}
        ref={scroller}
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={step}
      >
        {hostels.map((hostel) => (
          <ShowcaseCard
            hostel={hostel}
            key={hostel.id}
            onToggleSave={onToggleSave}
            saved={savedIds.has(hostel.id)}
            width={cardWidth}
          />
        ))}
      </ScrollView>

      {count > 1 ? <Dots active={dot} count={count} /> : null}
    </View>
  );
}

function ShowcaseCard({
  hostel,
  onToggleSave,
  saved,
  width,
}: {
  hostel: PublicHostel;
  onToggleSave: (hostel: PublicHostel) => void;
  saved: boolean;
  width: number;
}) {
  const { colors } = useAppTheme();

  const cover = coverPhoto(hostel.photos);
  const uri = absoluteMediaUrl(cover?.url, API_BASE_URL);
  const rating = ratingDisplay(hostel.ratingSummary);

  return (
    <Pressable
      accessibilityLabel={`${hostel.name}, ${locationLabel(hostel.location)}`}
      accessibilityRole="button"
      className="overflow-hidden rounded-3xl border border-border bg-card active:opacity-90"
      onPress={() => router.push(`/hostel/${hostel.slug}`)}
      style={{ width }}
    >
      <View>
        {uri ? (
          <Image
            accessibilityLabel={cover?.alt || hostel.name}
            contentFit="cover"
            source={{ uri }}
            style={{ backgroundColor: colors.muted, height: IMAGE_HEIGHT, width: "100%" }}
            transition={150}
          />
        ) : (
          <View
            className="items-center justify-center"
            style={{ backgroundColor: colors.muted, height: IMAGE_HEIGHT }}
          >
            <Ionicons color={colors.mutedForeground} name="image-outline" size={32} />
          </View>
        )}

        {/*
          One pill, not two. The mockup draws a single category tag here, and the
          verified tick belongs inside it — a separate Verified chip alongside
          leaves two floating labels fighting for the same corner.
        */}
        <View className="absolute left-4 top-4 flex-row items-center gap-1.5 rounded-full bg-primary px-3 py-1.5">
          {hostel.verificationStatus === "VERIFIED" ? (
            <Ionicons color={colors.primaryForeground} name="shield-checkmark" size={12} />
          ) : null}
          <Text className="text-[11px] font-bold uppercase tracking-wide text-primary-foreground">
            {HOSTEL_TYPE_LABELS[hostel.hostelType]}
          </Text>
        </View>

        <View className="absolute right-4 top-4">
          <SaveButton hostel={hostel} onToggle={onToggleSave} saved={saved} />
        </View>
      </View>

      <View className="gap-1 p-4">
        <View className="flex-row items-baseline gap-2">
          <Text className="flex-1 font-semibold" numberOfLines={1} variant="subtitle">
            {hostel.name}
          </Text>
          <Text className="font-semibold text-primary">{priceRange(hostel.pricing)}</Text>
          <Text variant="caption">/mo</Text>
        </View>

        <View className="flex-row items-center gap-2">
          <Ionicons color={colors.mutedForeground} name="location-outline" size={13} />
          <Text className="flex-1" numberOfLines={1} variant="caption">
            {locationLabel(hostel.location) || "Location not published"}
          </Text>

          {/* "New" rather than 0 ★ for an unreviewed hostel — see ratingDisplay. */}
          {rating.kind === "rated" ? (
            <View className="flex-row items-center gap-1">
              <Ionicons color={colors.warning} name="star" size={12} />
              <Text className="text-xs font-semibold">{rating.value}</Text>
              <Text variant="caption">{`(${rating.count})`}</Text>
            </View>
          ) : (
            <Text variant="caption">New</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Position, not navigation. The dots are not tappable: at six cards they are
 * 6px targets, well under the 44px minimum, and the carousel is already
 * swipeable in both directions.
 */
function Dots({ active, count }: { active: number; count: number }) {
  return (
    <View
      accessibilityElementsHidden
      className="flex-row items-center justify-center gap-1.5"
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: count }, (_, position) => (
        <View
          className={`h-1.5 rounded-full ${
            position === active ? "w-5 bg-primary" : "w-1.5 bg-border"
          }`}
          key={position}
        />
      ))}
    </View>
  );
}

/**
 * The OS "Reduce Motion" switch, read once and then watched.
 *
 * Watched rather than read on mount because the setting is a shortcut on both
 * platforms — someone turning it on mid-session is doing it *because* something
 * is moving, and this is the thing that is moving.
 */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduce;
}
