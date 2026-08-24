import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { useStoreCart } from "@/components/store/store-cart";
import {
  CategoryTile,
  FreeDeliveryBar,
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
import { readApiError } from "@/lib/api-contract";
import {
  addToCart,
  getStoreHome,
  listStoreProducts,
  type StoreProduct,
} from "@/lib/store-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * The shop.
 *
 * ## What it is shaped like, and what was left out
 *
 * The first reference board is a grocery app: a painted header with a search
 * field in it, a grid of category tiles, a promotional banner, and then a list
 * of products with a price and an action on each row. This screen is the first
 * three of those without the fourth-and-a-half — no promo banner, no "exchange
 * your points" strip, no countdown timer. Those are the marketing rows the
 * project already decided against on the public home, and a hostel owner
 * ordering forty mattresses is doing a job, not browsing an offer.
 *
 * What is left is the useful half of that layout: search, departments, what the
 * platform is pushing, and what is new.
 *
 * ## Search takes over the screen rather than filtering in place
 *
 * Typing swaps the whole body for results. The alternative — filtering the
 * "New in" rail while leaving the category grid and the featured strip above it
 * — puts three unrelated lists on screen during the one moment the user is
 * looking for exactly one thing.
 *
 * ## Adding never leaves the screen
 *
 * The `+` on a card posts and toasts. Pushing the product screen on every add
 * would double the taps for the case this shop is actually for, which is
 * restocking things somebody already knows they want.
 */
export default function StoreShopScreen() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const cart = useStoreCart();

  const home = useResource(useCallback(() => getStoreHome(), []), {
    topics: [REALTIME_TOPIC.STORE],
  });

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

  const add = useCallback(
    async (product: StoreProduct) => {
      setAdding(product.id);
      cart.bump(1);

      try {
        const result = await addToCart({ productId: product.id, quantity: 1 });

        toastSuccess("Added to cart", product.name);

        if (result.clamped) {
          // The server capped it. Saying so here is the difference between a
          // cart that quietly holds less than was asked for and one that
          // explains itself before checkout does.
          toastError(
            "We could not add them all",
            result.clamped === "stock"
              ? "There is not that much in stock."
              : "That is over the per-order limit.",
          );
        }
      } catch (error) {
        cart.bump(-1);
        toastError("Could not add to cart", readApiError(error));
      } finally {
        setAdding(null);
        cart.refresh();
      }
    },
    [cart],
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
  const searching = query.length > 0;

  return (
    <Screen
      bleedTop
      header={header}
      insideTabs
      onRefresh={home.refresh}
      padded={false}
      refreshing={home.refreshing}
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
                busy={adding === product.id}
                key={product.id}
                onAdd={() => void add(product)}
                onPress={() => router.push(`/store/product/${product.id}`)}
                product={product}
              />
            ))}
          </View>
        </View>
      ) : (
        <>
          {/*
            Delivery terms, at the top and once. A hostel deciding whether to
            order today reads this before anything else, and repeating it on
            every card is how the cart screen's version stops being noticed.
          */}
          {config && config.freeDeliveryThreshold > 0 ? (
            <View className="px-5 pt-4">
              <FreeDeliveryBar
                note={`Free delivery over NPR ${(
                  config.freeDeliveryThreshold / 100
                ).toLocaleString("en-NP")}`}
                progress={1}
              />
            </View>
          ) : null}

          <View className="px-5 pt-6">
            <SectionHeader
              action={
                <SectionLink onPress={() => router.push("/(store)/categories")} />
              }
              title="Shop by department"
            />

            {home.loading ? (
              <ProductGridSkeleton count={4} />
            ) : (home.data?.categories.length ?? 0) === 0 ? (
              <EmptyCard
                description="The catalogue is still being stocked. Check back shortly."
                title="Nothing here yet"
              />
            ) : (
              <Grid maxColumns={4} minCellWidth={76}>
                {(home.data?.categories ?? []).slice(0, 8).map((category) => (
                  <CategoryTile
                    category={category}
                    key={category.id}
                    onPress={() =>
                      router.push(`/(store)/categories?slug=${category.slug}`)
                    }
                  />
                ))}
              </Grid>
            )}
          </View>

          {(home.data?.featured.length ?? 0) > 0 ? (
            <View className="pt-7">
              <View className="px-5">
                <SectionHeader
                  subtitle="What the platform is stocking this month"
                  title="Featured"
                />
              </View>

              {/*
                A horizontal rail, not a second grid. Two stacked grids on one
                screen read as one long grid with a heading dropped into the
                middle of it, and the whole point of a featured strip is that it
                is a different *kind* of list.
              */}
              <ScrollView
                contentContainerClassName="gap-3 px-5"
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {(home.data?.featured ?? []).map((product) => (
                  <View key={product.id} style={{ width: 158 }}>
                    <ProductCard
                      busy={adding === product.id}
                      onAdd={() => void add(product)}
                      onPress={() => router.push(`/store/product/${product.id}`)}
                      product={product}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View className="px-5 pb-2 pt-7">
            <SectionHeader title="New in" />

            {home.loading ? (
              <ProductGridSkeleton />
            ) : (home.data?.latest.length ?? 0) === 0 ? (
              <EmptyCard
                description="No products are on sale yet."
                title="The shelves are empty"
              />
            ) : (
              <View className="gap-3">
                {(home.data?.latest ?? []).map((product) => (
                  <ProductRow
                    busy={adding === product.id}
                    key={product.id}
                    onAdd={() => void add(product)}
                    onPress={() => router.push(`/store/product/${product.id}`)}
                    product={product}
                  />
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}
