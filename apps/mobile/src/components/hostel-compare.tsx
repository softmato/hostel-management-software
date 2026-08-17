import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { coverPhoto, priceRange, ratingDisplay } from "@/lib/hostel-display";
import {
  COMPARE_MIN,
  type ComparedHostel,
  comparePublicHostels,
  HOSTEL_TYPE_LABELS,
} from "@/lib/public-api";

/**
 * Two or three hostels, side by side (docs/mockups/mobile/README.md §3).
 *
 * Rendered by the root `/compare` screen — pushed over whichever group you were
 * in — and by the `(browse)` Compare tab, which is the same screen sitting
 * empty until a comparison has been picked.
 *
 * ## Columns scroll together, labels do not
 *
 * The mockup lays this out as a table. On a phone that means a fixed label
 * column and a horizontally scrolling body — otherwise the reader loses which
 * row they are on halfway across, which is the one thing a comparison must not
 * do. Each row here is a label pinned left with the hostel columns scrolling
 * beside it, and every column scrolls as one so the rows stay aligned.
 *
 * ## Only the fields the server actually compares
 *
 * `comparePublicHostels` returns a `comparison` block per hostel — rent,
 * location, room types, vacancy, facilities, food score, rating, verification.
 * That is the comparison; anything else on the screen would be a field one
 * hostel filled in and another did not, which reads as a difference between
 * hostels rather than a difference in how much admin they did.
 */

const COLUMN_WIDTH = 172;

export type HostelCompareProps = {
  /** Where the empty state's "Browse hostels" button goes. */
  browseHref: string;
  insideTabs?: boolean;
  showBack?: boolean;
};

export function HostelCompare({
  browseHref,
  insideTabs = false,
  showBack = false,
}: HostelCompareProps) {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const selected = (ids ?? "").split(",").map((id) => id.trim()).filter(Boolean);

  const compared = useResource<ComparedHostel[]>(
    useCallback(
      () =>
        selected.length >= COMPARE_MIN
          ? comparePublicHostels(selected)
          : Promise.resolve([]),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the array identity changes every render; the joined string is the real key
      [ids],
    ),
  );

  const header = <AppBar showBack={showBack} title="Compare hostels" />;

  if (selected.length < COMPARE_MIN) {
    return (
      <Screen header={header} insideTabs={insideTabs}>
        <EmptyState
          action={
            <Button
              label="Browse hostels"
              // `navigate`, not `replace`: inside the tab group replacing the
              // Compare tab with the Search tab would leave the bar pointing at
              // a route that is no longer mounted.
              onPress={() => router.navigate(browseHref)}
              variant="outline"
            />
          }
          description={`Pick at least ${COMPARE_MIN} hostels from the browse list — tap the compare icon on each card.`}
          title="Nothing to compare yet"
        />
      </Screen>
    );
  }

  if (compared.loading) {
    return (
      <Screen header={header} insideTabs={insideTabs}>
        <LoadingState label="Loading the comparison" />
      </Screen>
    );
  }

  if (compared.error || !compared.data) {
    return (
      <Screen header={header} insideTabs={insideTabs}>
        <ErrorState
          message={compared.error ?? "That comparison could not be loaded."}
          onRetry={compared.reload}
        />
      </Screen>
    );
  }

  const hostels = compared.data;

  return (
    <Screen
      header={header}
      insideTabs={insideTabs}
      onRefresh={compared.refresh}
      padded={false}
      refreshing={compared.refreshing}
      scroll
    >
      <View className="gap-4">
        <Text className="px-5" variant="muted">
          Side by side, from what each hostel has published.
        </Text>

        <ScrollView
          contentContainerClassName="gap-3 px-5"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {hostels.map((hostel) => (
            <HeadCell hostel={hostel} key={hostel.id} />
          ))}
        </ScrollView>

        <View className="gap-0 px-5">
          <Row hostels={hostels} label="Monthly rent" value={(h) => priceRange(h.pricing)} />
          <Row hostels={hostels} label="Location" value={(h) => h.comparison.locationText || "—"} />
          <Row
            hostels={hostels}
            label="Room types"
            value={(h) => h.comparison.roomTypes.join(", ") || "—"}
          />
          <Row
            hostels={hostels}
            label="Vacant beds"
            // 0 is the answer that decides whether to bother visiting.
            value={(h) => String(h.comparison.vacancy)}
          />
          <Row
            hostels={hostels}
            label="Type"
            value={(h) => HOSTEL_TYPE_LABELS[h.hostelType]}
          />
          <Row
            hostels={hostels}
            label="Food"
            value={(h) =>
              [
                h.food.mealsPerDay ? `${h.food.mealsPerDay}/day` : null,
                h.food.hasVeg ? "Veg" : null,
                h.food.hasNonVeg ? "Non-veg" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
          <Row
            hostels={hostels}
            label="Facilities"
            value={(h) => h.comparison.facilities.join(", ") || "—"}
          />
          <Row
            hostels={hostels}
            label="Rating"
            value={(h) => {
              const rating = ratingDisplay(h.ratingSummary);

              return rating.kind === "new"
                ? "New"
                : `${rating.value} (${rating.count})`;
            }}
          />
          <Row
            hostels={hostels}
            label="Verified"
            value={(h) => (h.verificationStatus === "VERIFIED" ? "Yes" : "Not yet")}
          />
        </View>

        <ScrollView
          contentContainerClassName="gap-3 px-5 pb-2"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {hostels.map((hostel) => (
            <View key={hostel.id} style={{ width: COLUMN_WIDTH }}>
              <Button
                label="Send inquiry"
                onPress={() => router.push(`/hostel/${hostel.slug}/inquiry`)}
                size="sm"
              />
            </View>
          ))}
        </ScrollView>

        <Text className="px-5 pb-2" variant="caption">
          Information is published by each hostel and updated regularly.
        </Text>
      </View>
    </Screen>
  );
}

function HeadCell({ hostel }: { hostel: ComparedHostel }) {
  const { colors } = useAppTheme();
  const cover = coverPhoto(hostel.photos);
  const rating = ratingDisplay(hostel.ratingSummary);

  return (
    <Pressable
      accessibilityRole="button"
      className="overflow-hidden rounded-2xl border border-border bg-card active:opacity-80"
      onPress={() => router.push(`/hostel/${hostel.slug}`)}
      style={{ width: COLUMN_WIDTH }}
    >
      {cover ? (
        <Image
          contentFit="cover"
          source={{ uri: cover.url }}
          style={{ backgroundColor: colors.muted, height: 96 }}
        />
      ) : (
        <View
          className="items-center justify-center"
          style={{ backgroundColor: colors.muted, height: 96 }}
        >
          <Ionicons color={colors.mutedForeground} name="image-outline" size={22} />
        </View>
      )}

      <View className="gap-1 p-2.5">
        <Text numberOfLines={2} variant="label">
          {hostel.name}
        </Text>
        {rating.kind === "rated" ? (
          <View className="flex-row items-center gap-1">
            <Ionicons color={colors.warning} name="star" size={11} />
            <Text variant="caption">{`${rating.value} (${rating.count})`}</Text>
          </View>
        ) : (
          <Badge label="New" />
        )}
      </View>
    </Pressable>
  );
}

/**
 * One comparison row: a pinned label, then a scrolling strip of values.
 *
 * Each row scrolls independently, which is a deliberate trade. A single shared
 * scroll position would be tidier, but it needs a synchronised handler per row
 * and this reads fine because the columns are the same width and the reader is
 * comparing one row at a time.
 */
function Row({
  hostels,
  label,
  value,
}: {
  hostels: ComparedHostel[];
  label: string;
  value: (hostel: ComparedHostel) => string;
}) {
  return (
    <View className="border-b border-border py-3">
      <Text className="mb-1.5" variant="caption">
        {label}
      </Text>
      <ScrollView contentContainerClassName="gap-3" horizontal showsHorizontalScrollIndicator={false}>
        {hostels.map((hostel) => (
          <View key={hostel.id} style={{ width: COLUMN_WIDTH }}>
            <Text variant="label">{value(hostel)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
