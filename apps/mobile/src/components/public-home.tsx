import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { DiscoveryHeader } from "@/components/discovery-header";
import { facilityIcon, HostelCard } from "@/components/hostel-card";
import { HostelMap } from "@/components/hostel-map";
import { HostelShowcase } from "@/components/hostel-showcase";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Screen } from "@/components/ui/screen";
import { ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useNearby } from "@/hooks/use-nearby";
import { useResource } from "@/hooks/use-resource";
import { useSavedHostels } from "@/hooks/use-saved";
import { API_BASE_URL } from "@/lib/api";
import { sortByDistance } from "@/lib/geo";
import { type CitySummary, cityCounts, showcaseHostels } from "@/lib/home-sections";
import { absoluteMediaUrl } from "@/lib/media";
import {
  FACILITIES,
  HOSTEL_TYPE_LABELS,
  HOSTEL_TYPES,
  type HostelType,
  listPublicHostels,
  type PublicHostel,
} from "@/lib/public-api";
import type { SavedHostel } from "@/lib/saved-hostels";

/**
 * The public home — the app's landing page, signed in or out.
 *
 * ## Why this is a component and not just a screen
 *
 * Two route groups render it: `(public)`, the signed-out stack, and `(browse)`,
 * the tabs a signed-in `PUBLIC_USER` gets. expo-router cannot switch one group
 * between a stack and a tab navigator at runtime, so there have to be two
 * groups — but there must not be two home screens. Copy the screen and the
 * wording, the chips and the section order drift apart within a release.
 *
 * The two groups differ only in where the browse and compare links point, and
 * whether a tab bar is reserved at the bottom. Everything else is shared.
 *
 * ## What this screen is
 *
 * A listings screen. Every block on it is hostels, or a way to reach hostels:
 * the search field and the bell in the header, then photographs, then rows the
 * catalogue fills. Reworked 2026-08-17 from a marketing-shaped page — a green
 * hero with a headline and three trust chips, "why students trust us" tiles, a
 * platform stats band and a sign-up callout — which put four screenfuls of copy
 * between the fold and the first hostel. What was removed and why:
 *
 * - **The green hero.** It occupied the whole first screenful to hold one photo.
 *   Its search field moved up into the header, where it is reachable without
 *   scrolling, and the space became `HostelShowcase` — real listings at a size
 *   worth looking at, sliding on their own.
 * - **Trust chips and "why students use HostelHub" tiles.** Hard-coded copy with
 *   no data behind it. `Verified` is already a chip on every card that earns it,
 *   which is the claim made where it can be checked.
 * - **The stats band.** These were real figures, not the mockup's invented ones
 *   (the old `lib/home-stats.ts` derived them from this payload) — but a row of
 *   platform statistics is furniture on a screen for finding a room.
 * - **The residents callout.** A second "create an account" prompt on a screen
 *   that already floats a Log in pill over the bottom edge for exactly the
 *   audience it addressed.
 *
 * Follows the discovery mockup (docs/mockups/mobile/README.md §1) for the parts
 * that have a server behind them; the departures recorded there still hold —
 * no tab bar when signed out, no Bookings or Messages, NPR rather than ₹.
 *
 * **Saved is the one that changed.** The mockup's heart was cut with the Saved
 * tab because there is no favourites collection on the server, and there still
 * isn't. The hearts here write to the device instead — see `lib/saved-hostels.ts`
 * — and the section says so rather than implying an account-wide list.
 */

/** The facilities worth a shortcut. The full list lives in the filter sheet. */
const BROWSE_FACILITIES = FACILITIES.slice(0, 6);

/** Enough to be worth a row; more than this and the chips stop being scannable. */
const MAX_CITIES = 8;

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
  const account = useAppSelector((state) => state.auth.account);
  const [query, setQuery] = useState("");
  const nearby = useNearby();
  const saved = useSavedHostels();

  const hostels = useResource<PublicHostel[]>(
    useCallback(() => listPublicHostels(), []),
  );

  // Memoised so the slices below are not recomputed on every keystroke in the
  // search field: `?? []` is a fresh array each render.
  const all = useMemo(() => hostels.data ?? [], [hostels.data]);

  /*
   * Keep the saved snapshots current from the payload the screen already has.
   * `sync` dispatches nothing when nothing differs, so this is a no-op on an
   * unchanged catalogue rather than a write to disk per refresh.
   */
  const { sync } = saved;

  useEffect(() => {
    sync(all);
  }, [all, sync]);

  // The server sorts cheapest-first and caps at 60, so "popular" and "newly
  // listed" are slices of one request rather than three round trips for three
  // rows nobody has ranked differently yet.
  const showcase = useMemo(() => showcaseHostels(all), [all]);
  const cities = useMemo(() => cityCounts(all).slice(0, MAX_CITIES), [all]);
  const rated = all.filter((hostel) => hostel.ratingSummary.total > 0).slice(0, 6);
  const popular = (rated.length > 0 ? rated : all).slice(0, 6);
  const newest = [...all].reverse().slice(0, 6);

  const search = useCallback(() => {
    router.push(
      query.trim() ? `${browseHref}?q=${encodeURIComponent(query)}` : browseHref,
    );
  }, [browseHref, query]);

  const seeAll = useCallback(() => router.push(browseHref), [browseHref]);

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
        <DiscoveryHeader
          browseHref={browseHref}
          compareHref={compareHref}
          onQueryChange={setQuery}
          onSearch={search}
          query={query}
        />
      }
      insideTabs={insideTabs}
      onRefresh={hostels.refresh}
      refreshing={hostels.refreshing}
      scroll
    >
      <View className="gap-7 pt-1">
        <QuickTypes browseHref={browseHref} />

        <HostelShowcase
          hostels={showcase}
          loading={hostels.loading}
          onToggleSave={saved.toggle}
          savedIds={saved.ids}
        />

        {/* Above the error branch on purpose: favourites are snapshots on the
            device, so this row is the one thing that still works on a cold
            offline start. */}
        <SavedRow items={saved.items} onRemove={saved.remove} />

        {hostels.error && all.length === 0 ? (
          <ErrorState message={hostels.error} onRetry={hostels.reload} />
        ) : (
          <>
            <NearbySection hostels={all} nearby={nearby} saved={saved} />

            <HostelRow
              emptyLabel={
                hostels.loading ? "Loading hostels…" : "No hostels listed yet."
              }
              hostels={popular}
              onSeeAll={seeAll}
              saved={saved}
              subtitle="Verified and rated by students"
              title="Popular right now"
            />

            <CitiesRow browseHref={browseHref} cities={cities} />

            <PremiumHostels hostels={all} onSeeAll={seeAll} saved={saved} />

            <HostelRow
              emptyLabel={hostels.loading ? "" : "Nothing new this week."}
              hostels={newest}
              onSeeAll={seeAll}
              saved={saved}
              subtitle="The most recent additions"
              title="Newly listed"
            />

            <BrowseByFacility browseHref={browseHref} />
          </>
        )}
      </View>
    </Screen>
  );
}

/** Everything a card row needs from `useSavedHostels`, and nothing more. */
type SavedControls = Pick<ReturnType<typeof useSavedHostels>, "ids" | "toggle">;

/**
 * The mockup's category row, and what used to be a "Browse by type" section
 * further down the page.
 *
 * One row, at the top, rather than both: the same four destinations twice on one
 * screen is how a user learns that tapping things here is a guess. These are
 * deep links into the browse list (`?type=`), not client-side filters — the
 * results, the count and every other filter live there.
 */
const TYPE_ICONS: Record<HostelType, keyof typeof Ionicons.glyphMap> = {
  BOYS: "man-outline",
  CO_LIVING: "people-outline",
  GIRLS: "woman-outline",
};

function QuickTypes({ browseHref }: { browseHref: string }) {
  return (
    <View className="flex-row gap-3">
      <TypeTile icon="grid-outline" label="All" onPress={() => router.push(browseHref)} />
      {HOSTEL_TYPES.map((type) => (
        <TypeTile
          icon={TYPE_ICONS[type]}
          key={type}
          label={HOSTEL_TYPE_LABELS[type]}
          onPress={() => router.push(`${browseHref}?type=${type}`)}
        />
      ))}
    </View>
  );
}

function TypeTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      className="flex-1 items-center gap-1.5 rounded-2xl border border-border bg-card py-3 active:opacity-70"
      onPress={onPress}
    >
      <Ionicons color={colors.primary} name={icon} size={22} />
      <Text className="text-xs font-medium" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Saved" — the favourites row.
 *
 * Renders from the stored snapshot rather than from the listing payload, which
 * is what lets it survive a hostel dropping out of the server's first-60 window
 * and an offline launch (`lib/saved-hostels.ts`). The trade is that a price here
 * is as fresh as the last time that hostel appeared in a payload, which is why
 * the card carries no rating or vacancy: those move often enough that a stale one
 * would be a lie, while a name and a price are worth showing at their last known
 * value.
 *
 * Absent entirely when nothing is saved. An empty "Saved" heading on every home
 * screen is the section people learn to scroll past.
 */
function SavedRow({
  items,
  onRemove,
}: {
  items: SavedHostel[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View>
      <SectionHeader
        subtitle="Kept on this device — signing in elsewhere won't carry them over"
        title="Saved"
      />

      <ScrollView
        contentContainerClassName="gap-3 pr-5"
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {items.map((item) => (
          <SavedCard item={item} key={item.id} onRemove={onRemove} />
        ))}
      </ScrollView>
    </View>
  );
}

function SavedCard({
  item,
  onRemove,
}: {
  item: SavedHostel;
  onRemove: (id: string) => void;
}) {
  const { colors } = useAppTheme();

  const uri = absoluteMediaUrl(item.coverUrl, API_BASE_URL);

  return (
    <Pressable
      accessibilityLabel={`${item.name}, ${item.place}`}
      accessibilityRole="button"
      className="w-52 overflow-hidden rounded-2xl border border-border bg-card active:opacity-80"
      onPress={() => router.push(`/hostel/${item.slug}`)}
    >
      <View>
        {uri ? (
          <Image
            accessibilityLabel={item.name}
            contentFit="cover"
            source={{ uri }}
            style={{ backgroundColor: colors.muted, height: 100, width: "100%" }}
            transition={150}
          />
        ) : (
          <View
            className="items-center justify-center"
            style={{ backgroundColor: colors.muted, height: 100 }}
          >
            <Ionicons color={colors.mutedForeground} name="image-outline" size={24} />
          </View>
        )}

        {/*
          A filled heart, and it removes. Not `SaveButton`: that takes a
          `PublicHostel` and this row holds snapshots, which carry an id and a
          few strings and none of the fields a listing has.
        */}
        <Pressable
          accessibilityLabel={`Remove ${item.name} from saved`}
          accessibilityRole="button"
          className="absolute right-2 top-2 h-9 w-9 items-center justify-center rounded-full bg-card/95 active:opacity-70"
          hitSlop={6}
          onPress={() => onRemove(item.id)}
        >
          <Ionicons color={colors.primary} name="heart" size={18} />
        </Pressable>
      </View>

      <View className="gap-0.5 p-3">
        <Text className="font-semibold" numberOfLines={1} variant="label">
          {item.name}
        </Text>
        <Text numberOfLines={1} variant="caption">
          {item.place || "Location not published"}
        </Text>
        <Text className="font-semibold text-primary" variant="label">
          {item.price}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * "Browse by city" — the busiest cities in the payload, with their counts.
 *
 * Deep-links to `?city=`, which the browse screen narrows **on the client**. The
 * server has no city filter: its `area` matches `location.area` only, so a
 * hostel in "Ghattekulo, Kathmandu" does not match `?area=Kathmandu`. Both the
 * count here and the results there are derived from the same 60-row payload, so
 * they agree — see `inCity` in `lib/home-sections.ts`.
 *
 * Hidden below two cities: a "Browse by city" row with one chip in it is a
 * heading that describes nothing.
 */
function CitiesRow({
  browseHref,
  cities,
}: {
  browseHref: string;
  cities: CitySummary[];
}) {
  const { colors } = useAppTheme();

  if (cities.length < 2) {
    return null;
  }

  return (
    <View>
      <SectionHeader subtitle="Where the listings are" title="Browse by city" />

      <ScrollView
        contentContainerClassName="gap-2 pr-5"
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {cities.map((row) => (
          <Pressable
            accessibilityLabel={`${row.city}, ${row.count} ${row.count === 1 ? "hostel" : "hostels"}`}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 active:opacity-70"
            key={row.city}
            onPress={() =>
              router.push(`${browseHref}?city=${encodeURIComponent(row.city)}`)
            }
          >
            <Ionicons color={colors.primary} name="location-outline" size={15} />
            <Text variant="label">{row.city}</Text>
            <View className="rounded-full bg-muted px-2 py-0.5">
              <Text variant="caption">{row.count}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
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
  saved,
}: {
  hostels: PublicHostel[];
  nearby: ReturnType<typeof useNearby>;
  saved: SavedControls;
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
                  onToggleSave={saved.toggle}
                  saved={saved.ids.has(row.hostel.id)}
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

function HostelRow({
  emptyLabel,
  hostels,
  onSeeAll,
  saved,
  subtitle,
  title,
}: {
  emptyLabel: string;
  hostels: PublicHostel[];
  onSeeAll: () => void;
  saved: SavedControls;
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
            <HostelCard
              hostel={hostel}
              key={hostel.id}
              onToggleSave={saved.toggle}
              saved={saved.ids.has(hostel.id)}
              variant="carousel"
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * "Premium hostels" — the top-rated verified listings.
 *
 * "Premium" is defined here as verified and well-reviewed, because the server
 * has no premium flag, no tier and no paid placement. If one is ever added this
 * should read it rather than keep guessing.
 *
 * The type pills this section used to carry are gone: the same four choices now
 * sit at the top of the screen as `QuickTypes`, and two type filters on one page
 * — one that navigates, one that narrows in place — is a coin toss about what a
 * tap will do.
 */
const PREMIUM_MIN_RATING = 4;

function PremiumHostels({
  hostels,
  onSeeAll,
  saved,
}: {
  hostels: PublicHostel[];
  onSeeAll: () => void;
  saved: SavedControls;
}) {
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

    return [...pool]
      .sort((a, b) => b.ratingSummary.averageRating - a.ratingSummary.averageRating)
      .slice(0, 6);
  }, [hostels]);

  if (premium.length === 0) {
    return null;
  }

  return (
    <HostelRow
      emptyLabel=""
      hostels={premium}
      onSeeAll={onSeeAll}
      saved={saved}
      subtitle="Verified, and rated highly by students"
      title="Premium hostels"
    />
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
