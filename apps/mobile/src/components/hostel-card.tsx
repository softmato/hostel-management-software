import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { API_BASE_URL } from "@/lib/api";
import {
  campusDistanceLabel,
  coverPhoto,
  formatDistance,
  locationLabel,
  priceRange,
  ratingDisplay,
  vacancyLabel,
} from "@/lib/hostel-display";
import { absoluteMediaUrl } from "@/lib/media";
import type { PublicHostel } from "@/lib/public-api";

/**
 * One hostel, as every discovery surface draws it.
 *
 * Two widths, one component: `carousel` for the horizontally-scrolling rows on
 * the home screen, `list` for the full-width browse results. A second component
 * for the second width is how the two drift — the verified chip ends up in a
 * different corner, and the price loses its `/month` on one of them.
 *
 * ## The rating is the interesting part
 *
 * An unreviewed hostel shows **"New"**, not zero stars. Every average comes
 * back `0` for a hostel nobody has reviewed, so rendering the number would put
 * a one-star badge on every hostel that just joined — a visitor filters it out
 * and it never gets its first review. See `ratingDisplay`.
 */

const FACILITY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  AC: "snow-outline",
  "Attached bathroom": "water-outline",
  CCTV: "videocam-outline",
  Gym: "barbell-outline",
  "Hot water": "thermometer-outline",
  Laundry: "shirt-outline",
  Parking: "car-outline",
  "Power backup": "flash-outline",
  "Study table": "book-outline",
  WiFi: "wifi-outline",
};

export function facilityIcon(facility: string): keyof typeof Ionicons.glyphMap {
  return FACILITY_ICONS[facility] ?? "checkmark-circle-outline";
}

/**
 * The heart, shared by the cards and the home showcase so the two cannot end up
 * with different icons for the same state.
 *
 * Green when saved rather than red: the palette is white, black and one green
 * accent (docs/DESIGN.md), and a red heart is the only warm colour on the screen
 * — it reads as a warning next to a `destructive` token that means exactly that.
 *
 * No haptic here. `useSavedHostels().toggle` already fires one, and two on a
 * single tap is a stutter.
 */
export function SaveButton({
  hostel,
  onToggle,
  saved,
}: {
  hostel: PublicHostel;
  onToggle: (hostel: PublicHostel) => void;
  saved: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={saved ? `Remove ${hostel.name} from saved` : `Save ${hostel.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected: saved }}
      className="h-9 w-9 items-center justify-center rounded-full bg-card/95 active:opacity-70"
      hitSlop={6}
      onPress={() => onToggle(hostel)}
    >
      <Ionicons
        color={saved ? colors.primary : colors.mutedForeground}
        name={saved ? "heart" : "heart-outline"}
        size={18}
      />
    </Pressable>
  );
}

export function HostelCard({
  distanceMeters,
  hostel,
  onToggleCompare,
  onToggleSave,
  saved = false,
  selectedForCompare = false,
  showCampusDistance = false,
  variant = "list",
}: {
  /**
   * Metres from the device, when the screen has a position and this hostel has
   * coordinates — see `lib/geo.ts`. `null`/absent means one of those is missing,
   * which is not the same as zero and must not render as "0 m away".
   */
  distanceMeters?: number | null;
  hostel: PublicHostel;
  /** Omitted on surfaces where comparing is not offered. */
  onToggleCompare?: (hostel: PublicHostel) => void;
  /** The heart. Omitted where saving makes no sense — inside Favourites itself. */
  onToggleSave?: (hostel: PublicHostel) => void;
  saved?: boolean;
  selectedForCompare?: boolean;
  /** Students search by campus, so the browse list leads with that distance. */
  showCampusDistance?: boolean;
  variant?: "carousel" | "list";
}) {
  const { colors } = useAppTheme();

  const cover = coverPhoto(hostel.photos);
  /*
   * Photo URLs are stored relative (`/api/v1/files/…`) so one row works on
   * every web origin. A phone has no origin to resolve them against, so
   * without this the `<Image>` fails silently and every card is a grey box.
   * Branching on the *resolved* URL means an unresolvable photo falls through
   * to the placeholder below rather than rendering a broken image.
   */
  const coverUri = absoluteMediaUrl(cover?.url, API_BASE_URL);
  const rating = ratingDisplay(hostel.ratingSummary);
  const vacancy = vacancyLabel(hostel.capacitySummary);
  const campus = showCampusDistance ? campusDistanceLabel(hostel.nearbyPlaces) : null;
  const isCarousel = variant === "carousel";

  // Distance from *you* outranks distance from a campus: it is the thing the
  // user just asked for by tapping "Near me", and the campus line is a guess at
  // what they care about.
  const place = campus ?? locationLabel(hostel.location);
  const subtitle =
    typeof distanceMeters === "number"
      ? `${formatDistance(distanceMeters)} away · ${place}`
      : place;

  return (
    <Pressable
      accessibilityRole="button"
      className={`overflow-hidden rounded-2xl border border-border bg-card active:opacity-80 ${
        isCarousel ? "w-64" : "w-full"
      }`}
      onPress={() => router.push(`/hostel/${hostel.slug}`)}
    >
      <View>
        {coverUri ? (
          <Image
            accessibilityLabel={cover?.alt || hostel.name}
            contentFit="cover"
            source={{ uri: coverUri }}
            style={{ backgroundColor: colors.muted, height: isCarousel ? 128 : 168 }}
            transition={150}
          />
        ) : (
          <View
            className="items-center justify-center"
            style={{ backgroundColor: colors.muted, height: isCarousel ? 128 : 168 }}
          >
            <Ionicons color={colors.mutedForeground} name="image-outline" size={28} />
          </View>
        )}

        {hostel.verificationStatus === "VERIFIED" ? (
          <View className="absolute left-3 top-3 flex-row items-center gap-1 rounded-full bg-card/95 px-2.5 py-1">
            <Ionicons color={colors.success} name="shield-checkmark" size={12} />
            <Text className="text-xs font-semibold">Verified</Text>
          </View>
        ) : null}

        {/* One row, so a card offering both actions cannot stack them on top of
            each other in the same corner. */}
        <View className="absolute right-3 top-3 flex-row gap-2">
          {onToggleCompare ? (
            <Pressable
              accessibilityLabel={
                selectedForCompare ? "Remove from compare" : "Add to compare"
              }
              accessibilityRole="button"
              accessibilityState={{ selected: selectedForCompare }}
              className="h-9 w-9 items-center justify-center rounded-full bg-card/95 active:opacity-70"
              hitSlop={6}
              onPress={() => {
                void Haptics.selectionAsync();
                onToggleCompare(hostel);
              }}
            >
              <Ionicons
                color={selectedForCompare ? colors.primary : colors.mutedForeground}
                name={selectedForCompare ? "git-compare" : "git-compare-outline"}
                size={17}
              />
            </Pressable>
          ) : null}

          {onToggleSave ? (
            <SaveButton hostel={hostel} onToggle={onToggleSave} saved={saved} />
          ) : null}
        </View>
      </View>

      <View className="gap-1.5 p-3">
        <View className="flex-row items-start gap-2">
          <Text className="flex-1" numberOfLines={1} variant="subtitle">
            {hostel.name}
          </Text>

          {rating.kind === "rated" ? (
            <View className="flex-row items-center gap-1">
              <Ionicons color={colors.warning} name="star" size={12} />
              <Text className="text-sm font-semibold">{rating.value}</Text>
              <Text variant="caption">{`(${rating.count})`}</Text>
            </View>
          ) : (
            /*
              "New", never "0 ★". A brand-new hostel shown as one star gets
              filtered out of every search and never earns its first review.
            */
            <View className="rounded-full bg-muted px-2 py-0.5">
              <Text variant="caption">New</Text>
            </View>
          )}
        </View>

        <Text numberOfLines={1} variant="caption">
          {subtitle}
        </Text>

        <View className="flex-row items-baseline gap-1">
          <Text className="font-semibold text-primary">{priceRange(hostel.pricing)}</Text>
          <Text variant="caption">/ month</Text>
        </View>

        <View className="mt-1 flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {vacancy ? (
            <View className="flex-row items-center gap-1">
              <Ionicons color={colors.mutedForeground} name="bed-outline" size={12} />
              <Text variant="caption">{vacancy}</Text>
            </View>
          ) : null}

          {/* Two facilities, not ten: the card is a reason to tap, not a spec
              sheet, and a wrapped block of chips pushes the price out of view. */}
          {hostel.facilities.slice(0, 2).map((facility) => (
            <View className="flex-row items-center gap-1" key={facility}>
              <Ionicons
                color={colors.mutedForeground}
                name={facilityIcon(facility)}
                size={12}
              />
              <Text variant="caption">{facility}</Text>
            </View>
          ))}

          {hostel.food?.mealsPerDay ? (
            <View className="flex-row items-center gap-1">
              <Ionicons
                color={colors.mutedForeground}
                name="restaurant-outline"
                size={12}
              />
              <Text variant="caption">{`${hostel.food.mealsPerDay} meals`}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
