import { router } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useAddToCart, useStoreCart } from "@/components/store/store-cart";
import {
  CategoryChips,
  FeaturedRail,
  ProductCard,
  ProductGridSkeleton,
  ProductRow,
  StoreHeader,
} from "@/components/store/store-ui";
import { Card, SectionHeader, SectionLink } from "@/components/ui/card";
import { Grid } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { getStoreHome, listStoreProducts } from "@/lib/store-api";

/**
 * The shop.
 *
 * ## What it is shaped like
 *
 * The reference board is a three-part shop: a search field, a painted banner, a
 * row of category pills, and then a **two-up grid of product cards** filtered by
 * whichever pill is lit. That last part is the whole screen — everything above
 * it is one line tall and exists to narrow it.
 *
 * This is that, with the two substitutions the project's own rules force:
 *
 * - The banner carries a **real featured product** rather than invented offer
 *   copy — see `FeaturedBanner`. Marketing rows are what the public home
 *   already cut.
 * - The header stays the painted block with the search field inside it, because
 *   an accent header with rounded bottom corners is this app family's house
 *   style (`NOTES.md` §1) and the reference's plain white bar is a colour
 *   decision, which is the one thing these references do not license.
 *
 * ## What it replaced, and why
 *
 * The previous cut opened on a 4-up grid of department tiles, then a horizontal
 * "Featured" rail, then a vertical list of "New in" rows — three sections, three
 * different product presentations, and the products themselves starting below
 * the fold under a menu. Tapping a department pushed a whole other screen.
 *
 * Now the departments are **pills that filter the grid in place**, so the shop
 * is products from the first row down, and picking a department changes what is
 * on screen instead of leaving it.
 *
 * ## Two requests, not one
 *
 * `getStoreHome` still supplies the departments and the store config — they do
 * not change when a pill is tapped, and refetching sixteen categories to change
 * a filter is wasted. The grid is its own `listStoreProducts` keyed on the
 * selected slug, which is what makes the pills live: `useResource` refetches
 * when its loader identity changes.
 *
 * ## Search still takes over the screen
 *
 * Typing swaps the whole body for results, and those stay `ProductRow` rather
 * than becoming grid cards. That is deliberate and the component's own doc
 * argues it: a row is read faster when the question is "is this the one I
 * meant", and it has room for the summary line a tile has to drop.
 *
 * ## Adding never leaves the screen
 *
 * The `+` on a card posts and toasts. Pushing the product screen on every add
 * would double the taps for the case this shop is actually for, which is
 * restocking things somebody already knows they want.
 */
export default function StoreShopScreen() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const cart = useStoreCart();
  const { add, addingProductId, setQuantity } = useAddToCart();

  const home = useResource(useCallback(() => getStoreHome(), []), {
    topics: [REALTIME_TOPIC.STORE],
  });

  /*
   * The grid. Keyed on the selected slug so tapping a pill is a new question and
   * `useResource` asks it — see the hook's note about loaders that close over a
   * filter. `recommended` is the server's own default ordering, which is what an
   * unfiltered shop front should show.
   */
  const shelf = useResource(
    useCallback(
      () =>
        listStoreProducts({
          ...(category ? { category } : {}),
          pageSize: 24,
          sort: "recommended",
        }),
      [category],
    ),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  /*
   * A second resource rather than a filter over the first. `useResource` refetches
   * when its loader changes, so the memo has to close over the query — and the
   * empty-search case returns nothing rather than fetching the whole catalogue
   * every time somebody clears the box.
   */
  const query = search.trim();
  const results = useResource(
    useCallback(
      async () =>
        query.length === 0 ? null : listStoreProducts({ pageSize: 30, search: query }),
      [query],
    ),
  );

  const header = (
    <StoreHeader
      cartCount={cart.itemCount}
      onBack={() => router.back()}
      onCart={() => router.push("/(store)/cart")}
      onChangeSearch={setSearch}
      search={search}
      subtitle="Supplies for your hostel"
      title="Store"
    />
  );

  if (home.error && !home.data) {
    return (
      <Screen bleedTop header={header}>
        <ErrorState message={home.error} onRetry={home.reload} />
      </Screen>
    );
  }

  const config = home.data?.config;
  const categories = home.data?.categories ?? [];
  const searching = query.length > 0;
  const shelfTotal = shelf.data?.pagination.total ?? 0;
  const selected = categories.find((entry) => entry.slug === category) ?? null;

  return (
    <Screen
      bleedTop
      header={header}
      insideTabs
      onRefresh={() => {
        home.refresh();
        shelf.refresh();
      }}
      padded={false}
      refreshing={home.refreshing || shelf.refreshing}
      scroll
    >
      {config && !config.isOpen ? (
        <View className="px-5 pt-4">
          <Card className="gap-1" padding="p-4">
            <Text variant="subtitle">The store is closed</Text>
            <Text variant="caption">{config.closedMessage}</Text>
          </Card>
        </View>
      ) : null}

      {searching ? (
        <View className="gap-3 px-5 pt-5">
          <SectionHeader
            subtitle={
              results.data ? `${results.data.pagination.total} found` : "Searching…"
            }
            title={`Results for "${query}"`}
          />

          {results.loading || results.refreshing ? <ProductGridSkeleton /> : null}

          {!results.loading && results.data?.products.length === 0 ? (
            <EmptyCard
              description="Nothing matched that. Try a shorter word, or browse the departments."
              title="No results"
            />
          ) : null}

          <View className="gap-3">
            {(results.data?.products ?? []).map((product) => (
              <ProductRow
                busy={addingProductId === product.id}
                inCart={cart.lineQuantities[product.id]}
                key={product.id}
                onAdd={() => void add(product)}
                onPress={() => router.push(`/store/product/${product.id}`)}
                onSetQuantity={(next) => void setQuantity(product, next)}
                product={product}
              />
            ))}
          </View>
        </View>
      ) : (
        <>
          {/*
            Delivery terms, directly under the header. A hostel deciding whether
            to order today reads this before anything else, and it is a sentence
            rather than the cart's progress bar because there is no basket yet to
            measure progress against.

            Stacked, not joined by a middot. Both halves are full sentences the
            platform owner writes, and on one row the second was cut off mid-word
            on every phone — an ellipsis in the middle of "for delivery
            tomorrow" tells a reader strictly less than nothing.
          */}
          {config && config.freeDeliveryThreshold > 0 ? (
            <View className="gap-0.5 px-5 pt-3">
              <Text className="text-[11.5px] font-semibold text-primary">
                {`Free delivery over NPR ${(
                  config.freeDeliveryThreshold / 100
                ).toLocaleString("en-NP")}`}
              </Text>
              <Text className="text-[8.5px] text-muted-foreground">
                {config.deliveryPromise.cutoffText}
              </Text>
            </View>
          ) : null}

          {/* The banner slot. Absent entirely when nothing is featured — an
              empty painted block is worse than no block. */}
          {(home.data?.featured.length ?? 0) > 0 ? (
            <View className="pt-4">
              <FeaturedRail
                onPressProduct={(product) =>
                  router.push(`/store/product/${product.id}`)
                }
                products={home.data?.featured ?? []}
              />
            </View>
          ) : null}

          <View className="pt-6">
            <View className="px-5">
              <SectionHeader
                action={
                  <SectionLink onPress={() => router.push("/(store)/categories")} />
                }
                title="Categories"
              />
            </View>

            {/*
              Outside the gutter on purpose: the rail scrolls edge to edge and
              pads itself, so the last pill runs off the screen rather than
              stopping short of it with a 20dp margin nobody asked for.
            */}
            <CategoryChips
              categories={categories}
              onChange={setCategory}
              value={category}
            />
          </View>

          <View className="px-5 pb-2 pt-6">
            <SectionHeader
              action={
                selected ? (
                  <SectionLink
                    label="Sort & filter"
                    onPress={() => router.push(`/store/category/${selected.slug}`)}
                  />
                ) : undefined
              }
              subtitle={
                shelf.loading
                  ? "Loading…"
                  : `${shelfTotal} ${shelfTotal === 1 ? "product" : "products"}`
              }
              title={selected?.name ?? "All products"}
            />

            {shelf.loading ? (
              <ProductGridSkeleton count={6} />
            ) : shelf.error && !shelf.data ? (
              <ErrorState message={shelf.error} onRetry={shelf.reload} />
            ) : (shelf.data?.products.length ?? 0) === 0 ? (
              <EmptyCard
                description={
                  selected
                    ? "This department has nothing in it yet. Try another one."
                    : "The catalogue is still being stocked. Check back shortly."
                }
                title={selected ? "Empty shelf" : "The shelves are empty"}
              />
            ) : (
              <Grid gap={12} maxColumns={2} minCellWidth={148}>
                {(shelf.data?.products ?? []).map((product) => (
                  <ProductCard
                    busy={addingProductId === product.id}
                    inCart={cart.lineQuantities[product.id]}
                    key={product.id}
                    onAdd={() => void add(product)}
                    onPress={() => router.push(`/store/product/${product.id}`)}
                    onSetQuantity={(next) => void setQuantity(product, next)}
                    product={product}
                  />
                ))}
              </Grid>
            )}

            {/*
              The grid is capped at 24. Past that the department screen is the
              right place — it has the sort chips and the whole page — so the way on
              is a link rather than an infinite scroll that would make the tab
              bar's other three screens unreachable by scroll position.
            */}
            {shelf.data?.pagination.hasMore ? (
              <View className="items-center pt-5">
                <SectionLink
                  label={`See all ${shelfTotal} products`}
                  onPress={() =>
                    router.push(
                      selected
                        ? `/store/category/${selected.slug}`
                        : "/(store)/categories",
                    )
                  }
                />
              </View>
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}
