import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";

import { facilityIcon } from "@/components/hostel-card";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FactRow, Grid, StatTile } from "@/components/ui/layout";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { API_BASE_URL } from "@/lib/api";
import { formatMoney, humanizeEnum } from "@/lib/format";
import {
  campusDistanceLabel,
  formatDistance,
  locationLabel,
  priceRange,
  ratingDisplay,
} from "@/lib/hostel-display";
import { openAssetViewer } from "@/lib/asset-viewer";
import { absoluteMediaUrl } from "@/lib/media";
import {
  getPublicHostel,
  HOSTEL_TYPE_LABELS,
  type PublicHostelDetail,
} from "@/lib/public-api";

/**
 * One hostel's public profile (docs/mockups/mobile/README.md §4).
 *
 * ## Sections appear only when the hostel filled them in
 *
 * A published hostel can have no rules, no nearby places, no room
 * configurations and no food routine. The mockup draws all of them, so
 * rendering the frame unconditionally gives every sparse listing a column of
 * empty headings — which reads as the *app* being broken rather than the
 * listing being thin. Each block below is gated on having something to say.
 *
 * The exception is price and location, which are always shown: a listing
 * without them is not worth opening, and saying "—" is information.
 */
export default function HostelDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useAppTheme();

  const hostel = useResource<PublicHostelDetail>(
    useCallback(() => getPublicHostel(slug), [slug]),
  );

  const data = hostel.data;
  const header = <AppBar showBack title={data?.name ?? "Hostel"} />;

  if (hostel.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading this hostel" />
      </Screen>
    );
  }

  if (hostel.error || !data) {
    return (
      <Screen header={header}>
        <ErrorState
          message={hostel.error ?? "This hostel could not be loaded."}
          onRetry={hostel.reload}
        />
      </Screen>
    );
  }

  const rating = ratingDisplay(data.ratingSummary);
  const campus = campusDistanceLabel(data.nearbyPlaces);
  const phone = data.contact.phone?.trim();

  return (
    <Screen
      footer={
        <View className="flex-row gap-3">
          {/* Only when there is a number. A dead "Call" button is worse than no
              call button — it fails after the tap, not before. */}
          {phone ? (
            <Button
              className="flex-1"
              label="Call hostel"
              onPress={() => void Linking.openURL(`tel:${phone}`)}
              variant="outline"
            />
          ) : null}
          <Button
            className="flex-1"
            label="Send inquiry"
            onPress={() => router.push(`/hostel/${slug}/inquiry`)}
          />
        </View>
      }
      header={header}
      onRefresh={hostel.refresh}
      padded={false}
      refreshing={hostel.refreshing}
      scroll
    >
      <Gallery hostel={data} />

      <View className="gap-6 px-5 pt-4">
        <View className="gap-2">
          <View className="flex-row items-start gap-3">
            <Text className="flex-1" variant="title">
              {data.name}
            </Text>
            {rating.kind === "rated" ? (
              <View className="flex-row items-center gap-1">
                <Ionicons color={colors.warning} name="star" size={15} />
                <Text className="font-semibold">{rating.value}</Text>
                <Text variant="caption">{`(${rating.count})`}</Text>
              </View>
            ) : (
              <Badge label="New" />
            )}
          </View>

          <View className="flex-row items-center gap-1.5">
            <Ionicons
              color={colors.mutedForeground}
              name="location-outline"
              size={14}
            />
            <Text className="flex-1" variant="caption">
              {[data.location.address, locationLabel(data.location)]
                .filter(Boolean)
                .join(", ")}
            </Text>
          </View>

          {campus ? (
            <View className="flex-row items-center gap-1.5">
              <Ionicons
                color={colors.mutedForeground}
                name="school-outline"
                size={14}
              />
              <Text variant="caption">{campus}</Text>
            </View>
          ) : null}
        </View>

        <PriceTiles hostel={data} />

        {/*
          Chips, not the mockup's icon tiles with a sub-label under each. The
          sub-labels there — "High Speed" under Wi-Fi, "24/7 Security" under
          CCTV — are drawn from nothing: `facilities` is a `string[]`, and the
          only honest caption would be blank. A grid of tiles with empty second
          lines reads as data that failed to load.
        */}
        {data.facilities.length > 0 ? (
          <View>
            <SectionHeader title="Facilities" />
            <View className="flex-row flex-wrap gap-2">
              {data.facilities.map((facility) => (
                <View
                  className="flex-row items-center gap-1.5 rounded-xl border border-border px-3 py-2"
                  key={facility}
                >
                  <Ionicons
                    color={colors.primary}
                    name={facilityIcon(facility)}
                    size={15}
                  />
                  <Text variant="caption">{facility}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {data.roomConfigurations.length > 0 ? <Rooms hostel={data} /> : null}

        {data.description ? (
          <View>
            <SectionHeader title="About" />
            <Card>
              <Text variant="muted">{data.description}</Text>
            </Card>
          </View>
        ) : null}

        {data.rules.length > 0 ? (
          <View>
            <SectionHeader title="House rules" />
            <Card>
              {data.rules.map((rule, index) => (
                <View key={rule}>
                  {index > 0 ? <RowDivider /> : null}
                  <View className="flex-row items-start gap-2 py-2.5">
                    <Ionicons
                      color={colors.mutedForeground}
                      name="ellipse"
                      size={6}
                      style={{ marginTop: 7 }}
                    />
                    <Text className="flex-1" variant="muted">
                      {rule}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <FoodBlock hostel={data} />

        <HostelFacts hostel={data} />

        {data.nearbyPlaces.length > 0 ? <Nearby hostel={data} /> : null}
      </View>
    </Screen>
  );
}

/** Horizontal gallery with a counter — the server already sorts exterior-first. */
function Gallery({ hostel }: { hostel: PublicHostelDetail }) {
  const { colors } = useAppTheme();
  /*
   * The page width, which is the whole point.
   *
   * These images were a hardcoded `width: 400` inside a `pagingEnabled`
   * ScrollView — and paging snaps to the **viewport**, not to the child. So on
   * a 393dp phone every swipe left a 7dp sliver of the next photo, drifting
   * further out of alignment with each page; on a 430dp phone it stopped 30dp
   * short. It only looked right on a device exactly 400dp wide, and nobody has
   * one. Reading the real width also follows a rotation for free.
   */
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  /*
   * Resolved against the API origin before anything is drawn: the stored URLs
   * are relative, and a phone has no page origin to resolve them against (see
   * lib/media.ts). Filtering on the resolved value also drops a photo row whose
   * URL is blank, which the gallery would otherwise render as a grey panel the
   * user can swipe to.
   */
  const photos = hostel.photos
    .map((photo) => ({
      ...photo,
      uri: absoluteMediaUrl(photo.url, API_BASE_URL),
    }))
    .filter(
      (photo): photo is typeof photo & { uri: string } => photo.uri !== null,
    );

  if (photos.length === 0) {
    return (
      <View
        className="items-center justify-center"
        style={{ backgroundColor: colors.muted, height: 240 }}
      >
        <Ionicons
          color={colors.mutedForeground}
          name="image-outline"
          size={32}
        />
        <Text variant="caption">No photos yet</Text>
      </View>
    );
  }

  return (
    <View>
      <View>
        <ScrollView
          horizontal
          onMomentumScrollEnd={(event) => {
            const page = event.nativeEvent.layoutMeasurement.width;

            setIndex(
              page > 0
                ? Math.round(event.nativeEvent.contentOffset.x / page)
                : 0,
            );
          }}
          pagingEnabled
          ref={scrollRef}
          showsHorizontalScrollIndicator={false}
        >
          {photos.map((photo, photoIndex) => (
            <Pressable
              accessibilityLabel={photo.alt || hostel.name}
              accessibilityRole="imagebutton"
              key={photo.uri}
              /*
               * The carousel is 240dp of a building. Opening it full-screen is
               * the difference between "there is a photo" and being able to see
               * the room — and it is the first thing anyone tries on a gallery.
               */
              onPress={() =>
                openAssetViewer(
                  photos.map((item) => ({
                    caption: item.alt || undefined,
                    title: hostel.name,
                    url: item.uri,
                  })),
                  photoIndex,
                )
              }
            >
              <Image
                contentFit="cover"
                source={{ uri: photo.uri }}
                style={{ backgroundColor: colors.muted, height: 240, width }}
                transition={150}
              />
            </Pressable>
          ))}
        </ScrollView>

        {hostel.verificationStatus === "VERIFIED" ? (
          <View className="absolute left-5 top-3 flex-row items-center gap-1 rounded-full bg-card/95 px-2.5 py-1">
            <Ionicons
              color={colors.success}
              name="shield-checkmark"
              size={12}
            />
            <Text className="text-xs font-semibold">Verified hostel</Text>
          </View>
        ) : null}

        {photos.length > 1 ? (
          <View className="absolute bottom-3 right-5 rounded-full bg-black/60 px-2.5 py-1">
            <Text className="text-xs font-semibold text-white">
              {`${index + 1}/${photos.length}`}
            </Text>
          </View>
        ) : null}
      </View>

      {photos.length > 1 ? (
        <Thumbnails
          active={index}
          onSelect={(next) => {
            // Drives the carousel rather than opening the viewer: the strip is
            // navigation within the hero, and a tap that jumped straight to
            // full-screen would leave no way to browse in place.
            setIndex(next);
            scrollRef.current?.scrollTo({ animated: true, x: next * width });
          }}
          photos={photos}
        />
      ) : null}
    </View>
  );
}

/**
 * The mockup's thumbnail strip, under the hero.
 *
 * Twelve photos behind a swipe is twelve swipes to find the bathroom. The strip
 * is how someone gets to the one they want, and it doubles as the honest count
 * of what the hostel has actually uploaded — a hostel with three photos looks
 * like a hostel with three photos.
 *
 * Only drawn past two, because a strip under a single photo is a control with
 * nowhere to go.
 */
function Thumbnails({
  active,
  onSelect,
  photos,
}: {
  active: number;
  onSelect: (index: number) => void;
  photos: { alt?: string; uri: string }[];
}) {
  const { colors } = useAppTheme();

  return (
    <ScrollView
      className="mt-2"
      contentContainerClassName="gap-2 px-5"
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {photos.map((photo, photoIndex) => (
        <Pressable
          accessibilityLabel={`Photo ${photoIndex + 1}`}
          accessibilityRole="imagebutton"
          accessibilityState={{ selected: photoIndex === active }}
          key={photo.uri}
          onPress={() => onSelect(photoIndex)}
        >
          <Image
            contentFit="cover"
            source={{ uri: photo.uri }}
            style={{
              backgroundColor: colors.muted,
              borderColor:
                photoIndex === active ? colors.primary : "transparent",
              borderRadius: 10,
              borderWidth: 2,
              height: 52,
              width: 68,
            }}
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * The mockup's fee strip — but only the fees this platform actually stores.
 *
 * The mockup draws "Monthly Fee · Security · Advance". `pricing` carries
 * `monthlyRentMin/Max` and `admissionFee` and **no security deposit**, so a
 * third tile would be an invented number on the screen a person decides where
 * to live from. Two tiles that are true beat three that look complete.
 *
 * `<Grid>` rather than three `flex-1` cards: "NPR 10,000 – NPR 18,000" in a
 * third of a 320dp screen is about 93dp, which truncated to "NPR 10,0…". The
 * grid drops to two columns where three will not fit.
 */
function PriceTiles({ hostel }: { hostel: PublicHostelDetail }) {
  const tiles = [
    <StatTile
      icon="cash-outline"
      key="rent"
      label="Monthly"
      tone="brand"
      trend="Per month"
      value={priceRange(hostel.pricing)}
    />,
    hostel.pricing.admissionFee ? (
      <StatTile
        icon="document-text-outline"
        key="admission"
        label="Admission"
        tone="neutral"
        trend="One-off"
        value={formatMoney(hostel.pricing.admissionFee)}
      />
    ) : null,
    <StatTile
      icon="people-outline"
      key="type"
      label="Type"
      tone="neutral"
      trend="Who it is for"
      value={HOSTEL_TYPE_LABELS[hostel.hostelType]}
    />,
  ].filter(Boolean);

  return (
    <Grid gap={10} maxColumns={3} minCellWidth={116}>
      {tiles}
    </Grid>
  );
}

function Rooms({ hostel }: { hostel: PublicHostelDetail }) {
  return (
    <View>
      <SectionHeader
        subtitle={`${hostel.roomConfigurations.length} room types`}
        title="Rooms & pricing"
      />
      <Card>
        {hostel.roomConfigurations.map((room, index) => (
          <View key={room.id ?? room.roomType}>
            {index > 0 ? <RowDivider /> : null}
            <ListRow
              icon="bed-outline"
              subtitle={[
                `${room.bedsPerRoom} ${room.bedsPerRoom === 1 ? "bed" : "beds"}`,
                room.mealInclusion === "Included"
                  ? "Meals included"
                  : room.mealInclusion,
                // 0 is a real answer and the one that decides a visit.
                `${room.vacantBeds} vacant`,
              ].join(" · ")}
              title={humanizeEnum(room.roomType)}
              value={formatMoney(room.monthlyRent)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

function FoodBlock({ hostel }: { hostel: PublicHostelDetail }) {
  const { food, foodRoutine } = hostel;
  const chips = [
    food.mealsPerDay ? `${food.mealsPerDay} meals a day` : null,
    food.hasVeg ? "Veg" : null,
    food.hasNonVeg ? "Non-veg" : null,
  ].filter((chip): chip is string => Boolean(chip));

  const hasRoutine = foodRoutine?.meals?.length > 0;

  if (chips.length === 0 && !hasRoutine && !food.notes) {
    return null;
  }

  return (
    <View>
      <SectionHeader title="Food" />
      <Card className="gap-3">
        {chips.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {chips.map((chip) => (
              <Badge key={chip} label={chip} tone="success" />
            ))}
          </View>
        ) : null}

        {food.notes ? <Text variant="muted">{food.notes}</Text> : null}

        {/* The full week is the resident Food tab's job. Here it is a signal
            that a routine exists at all — the thing a visitor is checking. */}
        <Text variant="caption">
          {hasRoutine
            ? "A weekly menu is published. You'll see the full routine once you move in."
            : "No weekly routine published yet."}
        </Text>
      </Card>
    </View>
  );
}

function HostelFacts({ hostel }: { hostel: PublicHostelDetail }) {
  const { capacitySummary } = hostel;
  const facts = [
    { label: "Hostel type", value: HOSTEL_TYPE_LABELS[hostel.hostelType] },
    capacitySummary.totalRooms
      ? { label: "Total rooms", value: String(capacitySummary.totalRooms) }
      : null,
    capacitySummary.totalBeds
      ? { label: "Total beds", value: String(capacitySummary.totalBeds) }
      : null,
    capacitySummary.vacantBeds === undefined
      ? null
      : { label: "Vacant beds", value: String(capacitySummary.vacantBeds) },
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <View>
      <SectionHeader title="Hostel information" />
      <Card>
        {facts.map((fact, index) => (
          <View key={fact.label}>
            {index > 0 ? <RowDivider /> : null}
            <FactRow label={fact.label} value={fact.value} />
          </View>
        ))}
      </Card>
    </View>
  );
}

function Nearby({ hostel }: { hostel: PublicHostelDetail }) {
  return (
    <View>
      <SectionHeader
        subtitle="Walking and riding distance"
        title="What's nearby"
      />
      <Card>
        {hostel.nearbyPlaces.slice(0, 8).map((place, index) => (
          <View key={`${place.name}-${place.type}`}>
            {index > 0 ? <RowDivider inset /> : null}
            <ListRow
              icon={
                place.type === "college"
                  ? "school-outline"
                  : place.type === "hospital"
                    ? "medkit-outline"
                    : place.type === "bus_stop"
                      ? "bus-outline"
                      : "location-outline"
              }
              subtitle={humanizeEnum(place.type)}
              title={place.name}
              value={formatDistance(place.distance)}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
