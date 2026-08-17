import { Ionicons } from "@expo/vector-icons";
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
import { sortByDistance } from "@/lib/geo";
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

  const all = hostels.data ?? [];
  // The server sorts cheapest-first and caps at 60, so "popular" and "newly
  // listed" are slices of one request rather than three round trips for three
  // rows nobody has ranked differently yet.
  const featured = all.filter((hostel) => hostel.ratingSummary.total > 0).slice(0, 6);
  const popular = (featured.length > 0 ? featured : all).slice(0, 6);
  const newest = [...all].reverse().slice(0, 6);

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
        <Hero onQueryChange={setQuery} onSearch={search} query={query} />

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

        <BrowseByType browseHref={browseHref} />

        <HostelRow
          emptyLabel={hostels.loading ? "" : "Nothing new this week."}
          hostels={newest}
          onSeeAll={() => router.push(browseHref)}
          subtitle="The most recent additions"
          title="Newly listed"
        />

        <BrowseByFacility browseHref={browseHref} />

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
  onQueryChange,
  onSearch,
  query,
}: {
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
