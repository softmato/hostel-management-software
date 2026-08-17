import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";

import { HostelCard } from "@/components/hostel-card";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useNearby } from "@/hooks/use-nearby";
import { useResource } from "@/hooks/use-resource";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { sortByDistance } from "@/lib/geo";
import {
  FACILITIES,
  HOSTEL_TYPE_LABELS,
  HOSTEL_TYPES,
  type HostelFilters,
  type HostelType,
  listPublicHostels,
  type PublicHostel,
  ROOM_TYPES,
} from "@/lib/public-api";
import { COMPARE_MAX, COMPARE_MIN } from "@/lib/public-api";
import { toastInfo } from "@/lib/toast";

/**
 * Browse and filter (docs/mockups/mobile/README.md §5).
 *
 * Rendered by both `(public)/hostels` (the signed-out stack, with a back
 * button) and the `(browse)` Search tab — see `components/public-home.tsx` for
 * why there are two groups.
 *
 * ## The filter sheet only offers what the server accepts
 *
 * `publicHostelListQuerySchema` takes **one** `facility` and **one**
 * `roomType`, has no `sort` and no pagination, and returns the first 60 sorted
 * cheapest-first. The mockup draws facilities as a checkbox group and a Sort
 * dropdown — both would be controls that silently do nothing, which is worse
 * than not offering them, because the user believes the result set is filtered.
 * So facilities are single-select here and Sort is absent until the server
 * grows one.
 *
 * **`Sort: nearest` is the one exception, and it is honest** — it re-orders the
 * rows the server already returned, on the client, with the coordinates already
 * in the payload (`lib/geo.ts`). It changes what the user sees, so it is a
 * control that does something; it does not pretend to have narrowed the query.
 *
 * Budget is sent as `minPrice`/`maxPrice`, which the server compares against
 * the hostel's *range* (`monthlyRentMax >= minPrice`, `monthlyRentMin <=
 * maxPrice`) — so a hostel whose range overlaps the band matches, rather than
 * only one priced entirely inside it.
 */

const BUDGET_BANDS = [
  { label: "Any budget", maxPrice: undefined, minPrice: undefined },
  { label: "Under NPR 8,000", maxPrice: 8000, minPrice: undefined },
  { label: "NPR 8,000 – 10,000", maxPrice: 10000, minPrice: 8000 },
  { label: "Above NPR 10,000", maxPrice: undefined, minPrice: 10000 },
] as const;

export type HostelBrowserProps = {
  /** Where the compare bar goes, with `?ids=` appended. */
  compareHref: string;
  insideTabs?: boolean;
  /** Off inside a tab: a tab is a destination, not something you came from. */
  showBack?: boolean;
};

export function HostelBrowser({
  compareHref,
  insideTabs = false,
  showBack = false,
}: HostelBrowserProps) {
  const params = useLocalSearchParams<{
    facility?: string;
    q?: string;
    type?: string;
  }>();
  const { colors } = useAppTheme();

  // Seeded from the deep link the home screen's shortcuts push, so tapping
  // "Wi-Fi" or "Girls" lands on a list that is already filtered.
  const [filters, setFilters] = useState<HostelFilters>(() => ({
    facility: params.facility,
    q: params.q,
    type: HOSTEL_TYPES.includes(params.type as HostelType)
      ? (params.type as HostelType)
      : undefined,
  }));
  const [search, setSearch] = useState(params.q ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const nearby = useNearby();

  const hostels = useResource<PublicHostel[]>(
    useCallback(() => listPublicHostels(filters), [filters]),
  );

  const activeCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([key, value]) => key !== "q" && value !== undefined && value !== "",
      ).length,
    [filters],
  );

  // Memoised only so the sort below is not redone on every keystroke in the
  // search field: `?? []` is a fresh array each render.
  const rows = useMemo(() => hostels.data ?? [], [hostels.data]);

  /*
   * With no position this is the server's order with every distance null, so
   * the list renders through one path whether or not "nearest" is on — a second
   * branch for the unsorted case is how the two drift apart.
   */
  const ordered = useMemo(
    () => sortByDistance(rows, nearby.coordinates),
    [nearby.coordinates, rows],
  );

  const toggleCompare = useCallback(
    (hostel: PublicHostel) => {
      setCompare((current) => {
        if (current.includes(hostel.id)) {
          return current.filter((id) => id !== hostel.id);
        }

        if (current.length >= COMPARE_MAX) {
          // The server rejects a fourth id outright, so this is a real limit
          // rather than a UI preference.
          toastInfo(
            `Compare up to ${COMPARE_MAX}`,
            "Remove one before adding another.",
          );
          return current;
        }

        return [...current, hostel.id];
      });
    },
    [],
  );

  return (
    <Screen
      footer={
        compare.length > 0 ? (
          <View className="flex-row items-center gap-3">
            <Text className="flex-1" variant="muted">
              {`${compare.length} selected`}
            </Text>
            <Button
              label="Clear"
              onPress={() => setCompare([])}
              size="sm"
              variant="ghost"
            />
            <Button
              disabled={compare.length < COMPARE_MIN}
              label={
                compare.length < COMPARE_MIN
                  ? `Pick ${COMPARE_MIN - compare.length} more`
                  : "Compare"
              }
              onPress={() => router.push(`${compareHref}?ids=${compare.join(",")}`)}
              size="sm"
            />
          </View>
        ) : undefined
      }
      header={
        <AppBar showBack={showBack} subtitle="Verified hostels in Nepal" title="Browse" />
      }
      insideTabs={insideTabs}
      onRefresh={hostels.refresh}
      padded={false}
      refreshing={hostels.refreshing}
      scroll
    >
      <View className="gap-4 px-5">
        <View className="flex-row items-center gap-2">
          <View className="h-12 flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3">
            <Ionicons color={colors.mutedForeground} name="search" size={17} />
            <TextInput
              className="h-full flex-1 text-base text-foreground"
              onChangeText={setSearch}
              onSubmitEditing={() =>
                setFilters((current) => ({ ...current, q: search.trim() || undefined }))
              }
              placeholder="Hostel name or area"
              placeholderTextColor={colors.mutedForeground}
              returnKeyType="search"
              value={search}
            />
            {search ? (
              <Pressable
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  setSearch("");
                  setFilters((current) => ({ ...current, q: undefined }));
                }}
              >
                <Ionicons color={colors.mutedForeground} name="close-circle" size={17} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityLabel="Filters"
            accessibilityRole="button"
            className="h-12 flex-row items-center gap-1.5 rounded-xl border border-border px-3 active:opacity-70"
            onPress={() => setSheetOpen(true)}
          >
            <Ionicons color={colors.foreground} name="options-outline" size={18} />
            {activeCount > 0 ? (
              <View className="h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1">
                <Text className="text-[11px] font-bold text-primary-foreground">
                  {activeCount}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <NearestToggle nearby={nearby} />

        {activeCount > 0 ? <ActiveFilterChips filters={filters} onChange={setFilters} /> : null}

        {hostels.loading ? (
          <LoadingState label="Finding hostels" />
        ) : hostels.error ? (
          <ErrorState message={hostels.error} onRetry={hostels.reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            action={
              activeCount > 0 ? (
                <Button
                  label="Clear filters"
                  onPress={() => {
                    setFilters({ q: filters.q });
                    setSheetOpen(false);
                  }}
                  variant="outline"
                />
              ) : undefined
            }
            description={
              activeCount > 0
                ? "Nothing matches all of those filters. Try widening one."
                : "No hostels are published yet."
            }
            title="No results"
          />
        ) : (
          <View className="gap-3">
            <Text variant="caption">
              {`${rows.length} verified ${rows.length === 1 ? "hostel" : "hostels"}`}
              {nearby.isActive ? " · nearest first" : ""}
            </Text>

            {ordered.map((row) => (
              <HostelCard
                distanceMeters={row.distanceMeters}
                hostel={row.hostel}
                key={row.hostel.id}
                onToggleCompare={toggleCompare}
                selectedForCompare={compare.includes(row.hostel.id)}
                showCampusDistance
              />
            ))}

            <Text className="py-4 text-center" variant="caption">
              {rows.length >= 60
                ? "Showing the first 60 — narrow your filters to see more."
                : "You've reached the end"}
            </Text>
          </View>
        )}
      </View>

      <FilterSheet
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
        open={sheetOpen}
      />
    </Screen>
  );
}

/**
 * The `Sort: nearest` control — a toggle chip, not a dropdown.
 *
 * There is exactly one alternative to the server's cheapest-first order, so a
 * dropdown would be a menu of two. It sits above the results rather than inside
 * the filter sheet because it needs a permission dialogue: burying a prompt
 * behind Apply means the dialogue arrives after the sheet has closed, attached
 * to nothing the user can see they asked for.
 *
 * `blocked` keeps the chip visible and turns it into the settings link. Hiding
 * it would leave a user who once tapped "Don't allow" with no way back and no
 * explanation of where the option went.
 */
function NearestToggle({ nearby }: { nearby: ReturnType<typeof useNearby> }) {
  const { colors } = useAppTheme();

  const label = nearby.isBusy
    ? "Finding you…"
    : nearby.isActive
      ? "Nearest first"
      : nearby.status === "blocked"
        ? "Location is blocked — open settings"
        : nearby.status === "unavailable"
          ? "Couldn't find you — try again"
          : "Sort: nearest";

  return (
    <View className="flex-row">
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: nearby.isActive }}
        className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 active:opacity-70 ${
          nearby.isActive ? "border-primary bg-primary/10" : "border-border"
        }`}
        disabled={nearby.isBusy}
        onPress={() => {
          if (nearby.status === "blocked") {
            nearby.openSettings();
            return;
          }

          if (nearby.isActive) {
            nearby.disable();
            return;
          }

          void nearby.enable();
        }}
      >
        <Ionicons
          color={nearby.isActive ? colors.primary : colors.mutedForeground}
          name={nearby.isActive ? "navigate" : "navigate-outline"}
          size={14}
        />
        <Text
          className={`text-xs font-medium ${nearby.isActive ? "text-primary" : ""}`}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function ActiveFilterChips({
  filters,
  onChange,
}: {
  filters: HostelFilters;
  onChange: (next: HostelFilters) => void;
}) {
  const chips: { key: keyof HostelFilters; label: string }[] = [];

  if (filters.type) chips.push({ key: "type", label: HOSTEL_TYPE_LABELS[filters.type] });
  if (filters.roomType) chips.push({ key: "roomType", label: filters.roomType });
  if (filters.facility) chips.push({ key: "facility", label: filters.facility });
  if (filters.food) chips.push({ key: "food", label: filters.food === "veg" ? "Veg" : "Non-veg" });
  if (filters.area) chips.push({ key: "area", label: filters.area });
  if (filters.minPrice || filters.maxPrice) {
    const band = BUDGET_BANDS.find(
      (option) =>
        option.minPrice === filters.minPrice && option.maxPrice === filters.maxPrice,
    );

    chips.push({ key: "minPrice", label: band?.label ?? "Budget" });
  }

  return (
    <ScrollView contentContainerClassName="gap-2" horizontal showsHorizontalScrollIndicator={false}>
      {chips.map((chip) => (
        <Pressable
          accessibilityLabel={`Remove ${chip.label} filter`}
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 active:opacity-70"
          key={chip.key}
          onPress={() => {
            const next = { ...filters };

            delete next[chip.key];
            // Budget is one chip over two fields, so clearing it clears both.
            if (chip.key === "minPrice") delete next.maxPrice;

            onChange(next);
          }}
        >
          <Text className="text-xs font-semibold text-primary-foreground">
            {chip.label}
          </Text>
          <Ionicons color="#ffffff" name="close" size={12} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

/**
 * The filter sheet.
 *
 * Edits a **draft** and only lifts it on Apply. Filtering live on every tap
 * would refetch four times while somebody sets four filters, and the list
 * behind the sheet would shuffle under a control they are still using.
 */
function FilterSheet({
  filters,
  onApply,
  onClose,
  open,
}: {
  filters: HostelFilters;
  onApply: (next: HostelFilters) => void;
  onClose: () => void;
  open: boolean;
}) {
  const insets = useSystemInsets();
  const [draft, setDraft] = useState(filters);

  const patch = useCallback((next: Partial<HostelFilters>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setDraft(filters)}
      presentationStyle="pageSheet"
      visible={open}
    >
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3 pt-2">
          <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={24} />
          </Pressable>
          <Text className="flex-1" variant="subtitle">
            Filters
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setDraft({ q: draft.q })}
          >
            <Text className="text-primary" variant="label">
              Clear all
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-6 px-5 py-5" contentContainerStyle={{ paddingBottom: 32 }}>
          <FilterGroup title="Hostel type">
            <Choice
              label="Any"
              onPress={() => patch({ type: undefined })}
              selected={!draft.type}
            />
            {HOSTEL_TYPES.map((type) => (
              <Choice
                key={type}
                label={HOSTEL_TYPE_LABELS[type]}
                onPress={() => patch({ type })}
                selected={draft.type === type}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Budget (monthly)">
            {BUDGET_BANDS.map((band) => (
              <Choice
                key={band.label}
                label={band.label}
                onPress={() => patch({ maxPrice: band.maxPrice, minPrice: band.minPrice })}
                selected={
                  draft.minPrice === band.minPrice && draft.maxPrice === band.maxPrice
                }
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Room type">
            <Choice
              label="Any"
              onPress={() => patch({ roomType: undefined })}
              selected={!draft.roomType}
            />
            {ROOM_TYPES.map((roomType) => (
              <Choice
                key={roomType}
                label={roomType}
                onPress={() => patch({ roomType })}
                selected={draft.roomType === roomType}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Food">
            <Choice label="Any" onPress={() => patch({ food: undefined })} selected={!draft.food} />
            <Choice
              label="Veg"
              onPress={() => patch({ food: "veg" })}
              selected={draft.food === "veg"}
            />
            <Choice
              label="Non-veg"
              onPress={() => patch({ food: "non-veg" })}
              selected={draft.food === "non-veg"}
            />
          </FilterGroup>

          {/*
            One at a time, not a checkbox group: the server takes a single
            `facility`. A multi-select here would quietly drop everything after
            the first and show a result set the user believes is narrower.
          */}
          <FilterGroup subtitle="One at a time" title="Facility">
            <Choice
              label="Any"
              onPress={() => patch({ facility: undefined })}
              selected={!draft.facility}
            />
            {FACILITIES.map((facility) => (
              <Choice
                key={facility}
                label={facility}
                onPress={() => patch({ facility })}
                selected={draft.facility === facility}
              />
            ))}
          </FilterGroup>
        </ScrollView>

        <View
          className="border-t border-border px-5 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Button label="Show hostels" onPress={() => onApply(draft)} />
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Text variant="label">{title}</Text>
        {subtitle ? <Badge label={subtitle} /> : null}
      </View>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

function Choice({
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
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
        selected ? "border-primary bg-primary" : "border-border"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-sm font-medium ${
          selected ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
