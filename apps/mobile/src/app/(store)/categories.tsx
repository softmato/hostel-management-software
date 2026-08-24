import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { useStoreCart } from "@/components/store/store-cart";
import {
  CategoryTile,
  ProductGridSkeleton,
  ProductRow,
  StoreHeader,
} from "@/components/store/store-ui";
import { Chip } from "@/components/ui/layout";
import { SectionHeader } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  addToCart,
  getStoreCategories,
  listStoreProducts,
  type StoreProduct,
  type StoreProductQuery,
} from "@/lib/store-api";
import { toastError } from "@/lib/toast";

/**
 * Departments, and what is in the one you picked.
 *
 * ## One screen, not two
 *
 * The obvious build is a grid that pushes a "category" screen. This keeps both
 * on one surface — the tiles stay at the top and the products appear under them
 * — because the job here is *comparing shelves*: an owner buying bedding almost
 * always looks at cleaning next, and a push-and-back between every department
 * turns four glances into eight taps.
 *
 * The grid collapses to a single scrolling row of chips once something is
 * selected, so the products get the screen without the departments leaving it.
 *
 * ## `?slug=` is how the shop hands over
 *
 * Tapping a tile on the shop screen lands here with the department already
 * chosen. It is read once into state rather than driven from the param on every
 * render, so tapping a second chip does not have to rewrite the URL to work.
 */
const SORTS: { label: string; value: NonNullable<StoreProductQuery["sort"]> }[] = [
  { label: "Recommended", value: "recommended" },
  { label: "Price ↑", value: "price-asc" },
  { label: "Price ↓", value: "price-desc" },
  { label: "Newest", value: "newest" },
];

export default function StoreCategoriesScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const [selected, setSelected] = useState<string | null>(params.slug ?? null);
  const [sort, setSort] = useState<NonNullable<StoreProductQuery["sort"]>>("recommended");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const cart = useStoreCart();

  const categories = useResource(useCallback(() => getStoreCategories(), []), {
    topics: [REALTIME_TOPIC.STORE],
  });

  const query = search.trim();
  const products = useResource(
    useCallback(
      () =>
        listStoreProducts({
          ...(selected ? { category: selected } : {}),
          pageSize: 40,
          ...(query ? { search: query } : {}),
          sort,
        }),
      [query, selected, sort],
    ),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  const current = useMemo(
    () => (categories.data ?? []).find((category) => category.slug === selected) ?? null,
    [categories.data, selected],
  );

  const add = useCallback(
    async (product: StoreProduct) => {
      setAdding(product.id);

      try {
        const result = await addToCart({ productId: product.id, quantity: 1 });
        cart.setCart(result);
      } catch (error) {
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
      subtitle={current ? current.name : "Everything the platform stocks"}
      title="Departments"
    />
  );

  if (categories.error && !categories.data) {
    return (
      <Screen bleedTop header={header}>
        <ErrorState message={categories.error} onRetry={categories.reload} />
      </Screen>
    );
  }

  const rows = categories.data ?? [];

  return (
    <Screen
      bleedTop
      header={header}
      insideTabs
      onRefresh={() => {
        categories.refresh();
        products.refresh();
      }}
      padded={false}
      refreshing={categories.refreshing}
      scroll
    >
      {selected === null ? (
        <View className="px-5 pt-5">
          <SectionHeader title="All departments" />

          {categories.loading ? (
            <ProductGridSkeleton count={4} />
          ) : rows.length === 0 ? (
            <EmptyCard
              description="The platform has not set up any departments yet."
              title="Nothing to browse"
            />
          ) : (
            <View className="flex-row flex-wrap" style={{ gap: 12 }}>
              {rows.map((category) => (
                <View key={category.id} style={{ width: "31%" }}>
                  <CategoryTile
                    category={category}
                    onPress={() => setSelected(category.slug)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        /*
          The collapsed form: one horizontal row of chips with the current
          department filled. `Chip`'s `brand` tone is the selected state the
          filter sheet in `esewa-03` uses, and reusing it here keeps one visual
          answer to "which of these is on".
        */
        <ScrollView
          contentContainerClassName="gap-2 px-5 pt-4"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <Chip label="All" onPress={() => setSelected(null)} tone="neutral" />
          {rows.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              onPress={() => setSelected(category.slug)}
              tone={category.slug === selected ? "brand" : "neutral"}
            />
          ))}
        </ScrollView>
      )}

      <View className="px-5 pb-2 pt-6">
        <SectionHeader
          subtitle={
            products.data ? `${products.data.pagination.total} products` : undefined
          }
          title={current ? current.name : "Everything"}
        />

        <ScrollView
          className="mb-4"
          contentContainerClassName="gap-2"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {SORTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              onPress={() => setSort(option.value)}
              tone={sort === option.value ? "brand" : "neutral"}
            />
          ))}
        </ScrollView>

        {products.loading || products.refreshing ? <ProductGridSkeleton /> : null}

        {!products.loading && products.data?.products.length === 0 ? (
          <EmptyCard
            description={
              query
                ? "Nothing in this department matched that search."
                : "This department has nothing in it yet."
            }
            title="Empty shelf"
          />
        ) : null}

        <View className="gap-3">
          {(products.data?.products ?? []).map((product) => (
            <ProductRow
              busy={adding === product.id}
              inCart={cart.lineQuantities[product.id]}
              key={product.id}
              onAdd={() => void add(product)}
              onPress={() => router.push(`/store/product/${product.id}`)}
              product={product}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}
