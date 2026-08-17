import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { facilityIcon, HostelCard } from "@/components/hostel-card";
import { HostelMap } from "@/components/hostel-map";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/constants/branding";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useNearby } from "@/hooks/use-nearby";
import { useResource } from "@/hooks/use-resource";
import { API_BASE_URL } from "@/lib/api";
import { sortByDistance } from "@/lib/geo";
import { homeStats } from "@/lib/home-stats";
import { coverPhoto, priceRange, ratingDisplay } from "@/lib/hostel-display";
import { absoluteMediaUrl } from "@/lib/media";
import {
  FACILITIES,
  HOSTEL_TYPE_LABELS,
  HOSTEL_TYPES,
  type HostelType,
  listPublicHostels,
  type PublicHostel,
} from "@/lib/public-api";

/**
 * The public home — the app's landing page, signed in or out.
 *
 * ## Why this is a component and not just a screen
 *
 * Two route groups render it: `(public)`, the signed-out stack, and `(browse)`,
 * the tabs a signed-in `PUBLIC_USER` gets. expo-router cannot switch one group
 * between a stack and a tab navigator at runtime, so there have to be two
 * groups — but there must not be two heros. Copy the screen and the wording,
 * the chips and the section order drift apart within a release.
 *
 * The two groups differ only in where the browse and compare links point, and
 * whether a tab bar is reserved at the bottom. Everything else is shared.
 *
 * Follows the discovery mockup (docs/mockups/mobile/README.md §1) with three
 * departures, all recorded there:
 *
 * - **No tab bar when signed out.** The bottom belongs to the floating Log in
 *   pill until there is an account (§0 shell contract). The mockup draws tabs
 *   on screens a signed-out visitor sees; that part does not apply.
 * - **No Bookings, Messages or Saved.** There is no booking model, messaging
 *   endpoint or favourites collection on the server. A tab that opens onto a
 *   permanent empty state is the tab people stop trusting, not the feature.
 * - **NPR, and HostelHub.** The mockup's price chips use ₹ and its wordmark
 *   reads HostelDays.
 *
 * The mockup's trust band, stats band and "why students trust us" tiles are
 * marketing copy with no data behind them; the sections that survive are the
 * ones a hostel can actually fill — which is also what makes the screen worth
 * pulling to refresh.
 */

const HERO_CHIPS = [
  { icon: "shield-checkmark-outline", label: "Verified hostels" },
  { icon: "pricetag-outline", label: "No hidden fees" },
  { icon: "headset-outline", label: "Real support" },
] as const;

/** The facilities worth a shortcut. The full list lives in the filter sheet. */
const BROWSE_FACILITIES = FACILITIES.slice(0, 6);

export type PublicHomeProps = {
  /**
   * Where "View all", the search field and the shortcut tiles go. The signed-out
   * stack pushes `/(public)/hostels`; the browse tabs switch to their own
   * `search` tab, because pushing the other group's screen from inside a tab
   * navigator leaves the tab bar behind.
   */
  browseHref: string;
  /** Where the app bar's compare action goes. */
  compareHref: string;
  insideTabs?: boolean;
};

export function PublicHome({
  browseHref,
  compareHref,
  insideTabs = false,
}: PublicHomeProps) {
  const { colors } = useAppTheme();
  const account = useAppSelector((state) => state.auth.account);
  const [query, setQuery] = useState("");
  const nearby = useNearby();

  const hostels = useResource<PublicHostel[]>(
    useCallback(() => listPublicHostels(), []),
  );

  // Memoised so the hero pick and the stats below are not recomputed on every
  // keystroke in the search field: `?? []` is a fresh array each render.
  const all = useMemo(() => hostels.data ?? [], [hostels.data]);
  // The server sorts cheapest-first and caps at 60, so "popular" and "newly
  // listed" are slices of one request rather than three round trips for three
  // rows nobody has ranked differently yet.
  const featured = all.filter((hostel) => hostel.ratingSummary.total > 0).slice(0, 6);
  const popular = (featured.length > 0 ? featured : all).slice(0, 6);
  const newest = [...all].reverse().slice(0, 6);

  /*
   * The hero's photo and its floating card are a real listing, as on the web —
   * the best-rated verified hostel that actually has a picture. A stock image
   * would be the one photo on the screen that is not a hostel anyone can book,
   * and the card doubles as the first tappable result.
   */
  const heroHostel = useMemo(
    () =>
      [...all]
        .filter(
          (hostel) =>
            hostel.verificationStatus === "VERIFIED" && coverPhoto(hostel.photos) !== null,
        )
        .sort((a, b) => b.ratingSummary.averageRating - a.ratingSummary.averageRating)[0] ??
      null,
    [all],
  );

  const stats = useMemo(() => homeStats(all), [all]);

  const search = useCallback(() => {
    router.push(
      query.trim() ? `${browseHref}?q=${encodeURIComponent(query)}` : browseHref,
    );
  }, [browseHref, query]);

  return (
    <Screen
      floating={
        account ? undefined : (
          <FloatingButton
            icon="log-in-outline"
            label="Log in"
            onPress={() => router.push("/(auth)/login")}
          />
        )
      }
      header={
        <AppBar
          actions={
            <Pressable
              accessibilityLabel="Compare hostels"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.push(compareHref)}
            >
              <Ionicons
                color={colors.mutedForeground}
                name="git-compare-outline"
                size={22}
              />
            </Pressable>
          }
          subtitle="Hostels across Nepal"
          title={APP_NAME}
        />
      }
      insideTabs={insideTabs}
      onRefresh={hostels.refresh}
      refreshing={hostels.refreshing}
      scroll
    >
      <View className="gap-7 pt-1">
        <Hero
          hostel={heroHostel}
          onQueryChange={setQuery}
          onSearch={search}
          query={query}
        />

        <NearbySection hostels={all} nearby={nearby} />

        <HostelRow
          emptyLabel={
            hostels.loading ? "Loading hostels…" : "No hostels listed yet."
          }
          hostels={popular}
          onSeeAll={() => router.push(browseHref)}
          subtitle="Verified and rated by students"
          title="Popular right now"
        />

        <PremiumHostels browseHref={browseHref} hostels={all} />

        <BrowseByType browseHref={browseHref} />

        <HostelRow
          emptyLabel={hostels.loading ? "" : "Nothing new this week."}
          hostels={newest}
          onSeeAll={() => router.push(browseHref)}
          subtitle="The most recent additions"
          title="Newly listed"
        />

        <BrowseByFacility browseHref={browseHref} />

        <TrustPoints />

        <StatsBand stats={stats} />

        {/* Only for people who have no account. Someone already signed in as a
            resident reaches all of this from their own tabs. */}
        {account ? null : <ResidentsCallout />}
      </View>
    </Screen>
  );
}

/**
 * "Near you" — the distance sort, and the map once there is a position.
 *
 * ## Why the prompt is behind a tap
 *
 * Nothing here runs on mount. The permission dialogue fires from the "Near me"
 * button and nowhere else: a location request before the product has shown a
 * single hostel is the one people refuse, and on Android a refusal with "don't
 * ask again" cannot be re-asked. So the section first renders its own pitch —
 * what it does, and that the position is not kept — and the system dialogue is
 * the second thing the user sees, not the first.
 *
 * ## Every refusal leaves a working screen
 *
 * Denied, blocked, no fix: the section says which, offers the one action that
 * can help, and the rest of the home screen is untouched. `useNearby` already
 * toasts the reason; this only has to not become a dead end.
 *
 * The map is deliberately *below* the card row it belongs to and never the only
 * route to a hostel — it is a WebView over remote tiles, so it is blank without
 * a network while the sorted list beside it still works.
 */
function NearbySection({
  hostels,
  nearby,
}: {
  hostels: PublicHostel[];
  nearby: ReturnType<typeof useNearby>;
}) {
  // Only hostels that actually have coordinates: an un-geocoded listing has no
  // distance, and "0 m away" on a hostel nobody has placed is a lie the card
  // would tell confidently.
  const nearest = useMemo(() => {
    if (!nearby.coordinates) {
      return [];
    }

    return sortByDistance(hostels, nearby.coordinates)
      .filter((row) => row.distanceMeters !== null)
      .slice(0, 6);
  }, [hostels, nearby.coordinates]);

  return (
    <View>
      <SectionHeader
        action={
          nearby.isActive ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={nearby.disable}>
              <Text className="text-primary" variant="label">
                Turn off
              </Text>
            </Pressable>
          ) : undefined
        }
        subtitle={
          nearby.isActive
            ? "Sorted by how far they are from you"
            : "Sort hostels by how far they are from you"
        }
        title="Near you"
      />

      {nearby.isActive ? (
        nearest.length === 0 ? (
          <Card>
            <Text variant="muted">
              None of the listed hostels have been placed on the map yet, so there is
              no distance to show. The list below is unchanged.
            </Text>
          </Card>
        ) : (
          <View className="gap-3">
            <ScrollView
              contentContainerClassName="gap-3 pr-5"
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {nearest.map((row) => (
                <HostelCard
                  distanceMeters={row.distanceMeters}
                  hostel={row.hostel}
                  key={row.hostel.id}
                  variant="carousel"
                />
              ))}
            </ScrollView>

            <HostelMap
              hostels={nearest.map((row) => row.hostel)}
              me={nearby.coordinates}
              onSelect={(slug) => router.push(`/hostel/${slug}`)}
            />
          </View>
        )
      ) : (
        <Card className="gap-3">
          <Text variant="muted">
            {nearby.status === "blocked"
              ? "Location is switched off for HostelHub. Turn it on in Settings to sort hostels by distance."
              : nearby.status === "unavailable"
                ? "We couldn't get a position. Check that location is switched on, then try again."
                : "See which hostels are closest to you right now. Your location is used once, on this screen, and is never saved."}
          </Text>

          {nearby.status === "blocked" ? (
            <Button
              label="Open settings"
              onPress={nearby.openSettings}
              variant="outline"
            />
          ) : (
            <Button
              label={
                nearby.isBusy
                  ? "Finding you…"
                  : nearby.status === "unavailable"
                    ? "Try again"
                    : "Near me"
              }
              loading={nearby.isBusy}
              onPress={() => {
                void nearby.enable();
              }}
              variant="outline"
            />
          )}
        </Card>
      )}
    </View>
  );
}

function Hero({
  hostel,
  onQueryChange,
  onSearch,
  query,
}: {
  /** A real listing behind the hero image, or null before the list loads. */
  hostel: PublicHostel | null;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  query: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="gap-4 overflow-hidden rounded-3xl bg-primary px-5 py-7">
      <View className="gap-2">
        <Text className="text-2xl font-semibold leading-8 text-primary-foreground">
          Find a hostel you can actually trust
        </Text>
        <Text className="text-primary-foreground/80">
          Verified listings, real photos and honest pricing — and once you move in,
          your rent, meals and notices live here too.
        </Text>
      </View>

      {hostel ? <HeroHostel hostel={hostel} /> : null}

      <View className="flex-row items-center gap-2 rounded-xl bg-card px-3">
        <Ionicons color={colors.mutedForeground} name="search" size={18} />
        <SearchInput onChange={onQueryChange} onSubmit={onSearch} value={query} />
        <Pressable
          accessibilityLabel="Search"
          accessibilityRole="button"
          className="my-2 rounded-lg bg-primary px-4 py-2 active:opacity-80"
          onPress={onSearch}
        >
          <Text className="font-semibold text-primary-foreground">Search</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {HERO_CHIPS.map((chip) => (
          <View
            className="flex-row items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5"
            key={chip.label}
          >
            <Ionicons color="#ffffff" name={chip.icon} size={13} />
            <Text className="text-xs font-medium text-primary-foreground">
              {chip.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The hero's photo, with a real listing floating over its corner.
 *
 * Follows the mockup, which draws an image with a small hostel card overlapping
 * it — except the mockup's is a drawing and this is the actual best-rated
 * verified listing, so the card is tappable and goes where it says. An image
 * with an invented hostel on it would be the one thing on the screen a user
 * could not act on.
 */
function HeroHostel({ hostel }: { hostel: PublicHostel }) {
  const { colors } = useAppTheme();

  const cover = coverPhoto(hostel.photos);
  const uri = absoluteMediaUrl(cover?.url, API_BASE_URL);
  const rating = ratingDisplay(hostel.ratingSummary);

  if (!uri) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel={`${hostel.name}, ${hostel.location.area}`}
      accessibilityRole="button"
      className="active:opacity-90"
      onPress={() => router.push(`/hostel/${hostel.slug}`)}
    >
      <View className="overflow-hidden rounded-2xl">
        <Image
          accessibilityLabel={cover?.alt || hostel.name}
          contentFit="cover"
          source={{ uri }}
          style={{ backgroundColor: colors.muted, height: 150, width: "100%" }}
          transition={150}
        />
      </View>

      {/* Overlapping the image's lower edge, as drawn. Pulled up rather than
          absolutely positioned, so the card cannot cover a shorter image on a
          small screen. */}
      <View className="-mt-7 ml-auto mr-2 w-56 rounded-xl bg-card p-3 shadow-lg">
        <Text className="font-semibold" numberOfLines={1}>
          {hostel.name}
        </Text>
        <Text numberOfLines={1} variant="caption">
          {[hostel.location.area, hostel.location.city].filter(Boolean).join(", ")}
        </Text>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="text-primary" variant="label">
            {priceRange(hostel.pricing)}
          </Text>
          {/* "New" rather than 0 stars for an unreviewed hostel — see
              ratingDisplay. */}
          {rating.kind === "rated" ? (
            <View className="flex-row items-center gap-1">
              <Ionicons color={colors.warning} name="star" size={11} />
              <Text variant="caption">{rating.value}</Text>
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
 * A bare `TextInput`, not the design system's `Input`.
 *
 * `Input` carries a label, its own border and its own height — all of which
 * fight a field that has to sit *inside* the search pill next to a button.
 */
function SearchInput({
  onChange,
  onSubmit,
  value,
}: {
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  const { colors } = useAppTheme();

  return (
    <TextInput
      className="h-12 flex-1 text-base text-foreground"
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      placeholder="Search by area, hostel or landmark"
      placeholderTextColor={colors.mutedForeground}
      returnKeyType="search"
      value={value}
    />
  );
}

function HostelRow({
  emptyLabel,
  hostels,
  onSeeAll,
  subtitle,
  title,
}: {
  emptyLabel: string;
  hostels: PublicHostel[];
  onSeeAll: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <View>
      <SectionHeader
        action={
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onSeeAll}>
            <Text className="text-primary" variant="label">
              View all
            </Text>
          </Pressable>
        }
        subtitle={subtitle}
        title={title}
      />

      {hostels.length === 0 ? (
        emptyLabel ? (
          <Card>
            <Text variant="muted">{emptyLabel}</Text>
          </Card>
        ) : null
      ) : (
        <ScrollView
          contentContainerClassName="gap-3 pr-5"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {hostels.map((hostel) => (
            <HostelCard hostel={hostel} key={hostel.id} variant="carousel" />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * "Premium Hostels" — the top-rated verified listings, filtered by type.
 *
 * The pills filter **on the client**, over rows the server already returned.
 * That is honest here for the same reason `Sort: nearest` is on the browse
 * screen and unlike the filter sheet's absent Sort: nothing is being claimed
 * about a query. Tapping a pill genuinely narrows what is on screen.
 *
 * "Premium" is defined here as verified and well-reviewed, because the server
 * has no premium flag, no tier and no paid placement. If one is ever added this
 * should read it rather than keep guessing.
 */
const PREMIUM_MIN_RATING = 4;

function PremiumHostels({
  browseHref,
  hostels,
}: {
  browseHref: string;
  hostels: PublicHostel[];
}) {
  const [type, setType] = useState<HostelType | null>(null);

  const premium = useMemo(() => {
    const eligible = hostels.filter(
      (hostel) =>
        hostel.verificationStatus === "VERIFIED" &&
        hostel.ratingSummary.total > 0 &&
        hostel.ratingSummary.averageRating >= PREMIUM_MIN_RATING,
    );

    // Nothing rated that highly yet — fall back to every verified hostel rather
    // than showing an empty section on a catalogue that is simply young.
    const pool =
      eligible.length > 0
        ? eligible
        : hostels.filter((hostel) => hostel.verificationStatus === "VERIFIED");

    return pool
      .filter((hostel) => (type ? hostel.hostelType === type : true))
      .sort((a, b) => b.ratingSummary.averageRating - a.ratingSummary.averageRating)
      .slice(0, 6);
  }, [hostels, type]);

  if (hostels.length === 0) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        action={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push(browseHref)}
          >
            <Text className="text-primary" variant="label">
              View all
            </Text>
          </Pressable>
        }
        subtitle="Verified, and rated highly by students"
        title="Premium hostels"
      />

      <ScrollView
        contentContainerClassName="gap-2 pr-5"
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <TypePill label="All" onPress={() => setType(null)} selected={type === null} />
        {HOSTEL_TYPES.map((option) => (
          <TypePill
            key={option}
            label={HOSTEL_TYPE_LABELS[option]}
            onPress={() => setType(option)}
            selected={type === option}
          />
        ))}
      </ScrollView>

      {premium.length === 0 ? (
        <Card className="mt-3">
          <Text variant="muted">No hostels of that type are listed yet.</Text>
        </Card>
      ) : (
        <ScrollView
          className="mt-3"
          contentContainerClassName="gap-3 pr-5"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {premium.map((hostel) => (
            <HostelCard hostel={hostel} key={hostel.id} variant="carousel" />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function TypePill({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-full border px-4 py-2 active:opacity-70 ${
        selected ? "border-primary bg-primary" : "border-border bg-card"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-xs font-semibold ${selected ? "text-primary-foreground" : ""}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Why students trust us" — the mockup's four tiles.
 *
 * Wording with no database home, exactly as `public-home-content.ts` holds it
 * for the web, so the two surfaces make the same promises. Kept to claims the
 * product actually keeps: every one of these is a feature that exists —
 * verification, a price with no hidden fees, and reviews you can read.
 */
const TRUST_POINTS = [
  {
    description: "Every listing is checked before it goes live.",
    icon: "shield-checkmark-outline",
    title: "Verified with care",
  },
  {
    description: "The monthly rent you see is the rent you pay.",
    icon: "pricetag-outline",
    title: "Transparent prices",
  },
  {
    description: "Ratings and reviews written by people living there.",
    icon: "chatbubble-ellipses-outline",
    title: "Honest reviews",
  },
  {
    description: "Rent, meals and notices in one place once you move in.",
    icon: "home-outline",
    title: "More than a search",
  },
] as const;

function TrustPoints() {
  const { colors } = useAppTheme();

  return (
    <View>
      <SectionHeader
        subtitle="Hostel hunting, without the guesswork"
        title={`Why students use ${APP_NAME}`}
      />

      <View className="flex-row flex-wrap gap-3">
        {TRUST_POINTS.map((point) => (
          <View
            className="w-[47%] gap-2 rounded-2xl border border-border bg-card p-4"
            key={point.title}
          >
            <Ionicons color={colors.primary} name={point.icon} size={20} />
            <Text variant="label">{point.title}</Text>
            <Text variant="caption">{point.description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The stats band.
 *
 * **Real figures, not the mockup's copy.** The mockup and the web both hard-code
 * "500+ Verified Hostels / 10,000+ Happy Students / 50+ Cities / 4.6 ★"; none of
 * it is derived and none of it is true yet. Agreed with the product owner
 * 2026-08-17 to compute these from the same payload the cards above render —
 * see `lib/home-stats.ts`, which also explains why the fourth tile counts vacant
 * beds rather than students.
 *
 * Renders nothing at all when there is nothing to count, rather than a row of
 * zeros on an empty catalogue.
 */
function StatsBand({ stats }: { stats: ReturnType<typeof homeStats> }) {
  if (stats.length === 0) {
    return null;
  }

  return (
    <View className="flex-row flex-wrap justify-around gap-y-5 rounded-3xl bg-primary px-4 py-6">
      {stats.map((stat) => (
        <View className="min-w-[40%] items-center gap-1" key={stat.label}>
          <Text className="text-2xl font-bold text-primary-foreground">{stat.value}</Text>
          <Text className="text-xs font-medium text-primary-foreground/80">
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BrowseByType({ browseHref }: { browseHref: string }) {
  const { colors } = useAppTheme();

  const icons: Record<HostelType, keyof typeof Ionicons.glyphMap> = {
    BOYS: "man-outline",
    CO_LIVING: "people-outline",
    GIRLS: "woman-outline",
  };

  return (
    <View>
      <SectionHeader subtitle="Find a space that suits how you live" title="Browse by type" />

      <View className="flex-row gap-3">
        {HOSTEL_TYPES.map((type) => (
          <Pressable
            accessibilityRole="button"
            className="flex-1 items-center gap-2 rounded-2xl border border-border bg-card py-5 active:opacity-70"
            key={type}
            onPress={() => router.push(`${browseHref}?type=${type}`)}
          >
            <Ionicons color={colors.primary} name={icons[type]} size={24} />
            <Text variant="label">{HOSTEL_TYPE_LABELS[type]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function BrowseByFacility({ browseHref }: { browseHref: string }) {
  const { colors } = useAppTheme();

  return (
    <View>
      <SectionHeader
        subtitle="Find hostels with what you need"
        title="Browse by facility"
      />

      <View className="flex-row flex-wrap gap-3">
        {BROWSE_FACILITIES.map((facility) => (
          <Pressable
            accessibilityRole="button"
            className="w-[47%] flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 active:opacity-70"
            key={facility}
            onPress={() =>
              router.push(`${browseHref}?facility=${encodeURIComponent(facility)}`)
            }
          >
            <Ionicons
              color={colors.mutedForeground}
              name={facilityIcon(facility)}
              size={20}
            />
            <Text variant="label">{facility}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ResidentsCallout() {
  return (
    <View>
      <SectionHeader
        subtitle="Already living in one of our hostels?"
        title="Residents"
      />
      <Card className="gap-3">
        <Text variant="muted">
          Sign in to see your rent, this week&apos;s meals, notices from your warden,
          and to raise a complaint.
        </Text>
        <Pressable
          accessibilityRole="button"
          className="h-12 items-center justify-center rounded-xl border border-border active:opacity-70"
          onPress={() => router.push("/(auth)/register")}
        >
          <Text className="font-semibold">Create an account</Text>
        </Pressable>
      </Card>
    </View>
  );
}
