import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { useAddToCart, useStoreCart } from "@/components/store/store-cart";
import {
  ProductGridSkeleton,
  ProductRow,
  StoreHeader,
} from "@/components/store/store-ui";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { listStoreProducts, type StoreProductQuery } from "@/lib/store-api";

/**
 * One department, on its own screen.
 *
 * ## Why this exists next to the Departments tab
 *
 * Tapping "Bedding" on the shop used to jump to the Departments **tab** with
 * that shelf pre-selected. That is a tab switch in response to what reads as a
 * drill-down: the bar underneath changes which item is lit, the back gesture
 * goes somewhere unexpected, and the screen that arrives is a chooser rather
 * than the thing that was chosen.
 *
 * So the shop pushes here instead — a normal detail screen on the root stack,
 * like `store/product/[id]`, from which back returns to the shop.
 *
 * The Departments tab keeps its own inline behaviour, and that is not a
 * contradiction: its job is *comparing* shelves, where a push-and-back between
 * every department would turn four glances into eight taps. Arriving with one
 * shelf in mind and drilling into it is a different job, and this is it.
 *
 * ## One request, not two
 *
 * `listStoreProducts({ category })` already returns the category it resolved
 * the slug to, so the title comes back with the products rather than from a
 * second lookup that would leave the header blank for a beat.
 */
const SORTS: { label: string; value: NonNullable<StoreProductQuery["sort"]> }[] = [
  { label: "Recommended", value: "recommended" },
  { label: "Price ↑", value: "price-asc" },
  { label: "Price ↓", value: "price-desc" },
  { label: "Newest", value: "newest" },
];

export default function StoreCategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [sort, setSort] = useState<NonNullable<StoreProductQuery["sort"]>>("recommended");
  const [search, setSearch] = useState("");
  const cart = useStoreCart();
  const { add, addingProductId, setQuantity } = useAddToCart();

  const query = search.trim();
  const products = useResource(
    useCallback(
      () =>
        listStoreProducts({
          category: String(slug),
          pageSize: 40,
          ...(query ? { search: query } : {}),
          sort,
        }),
      [query, slug, sort],
    ),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  const category = products.data?.category ?? null;

  const header = (
    <StoreHeader
      cartCount={cart.itemCount}
      onBack={() => router.back()}
      onCart={() => router.push("/(store)/cart")}
      onChangeSearch={setSearch}
      search={search}
      subtitle={
        products.data
          ? `${products.data.pagination.total} ${
              products.data.pagination.total === 1 ? "product" : "products"
            }`
          : "Loading…"
      }
      title={category?.name ?? "Department"}
    />
  );

  if (products.error && !products.data) {
    return (
      <Screen bleedTop header={header}>
        <ErrorState message={products.error} onRetry={products.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      bleedTop
      header={header}
      onRefresh={products.refresh}
      padded={false}
      refreshing={products.refreshing}
      scroll
    >
      <View className="px-5 pb-2 pt-5">
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

        {products.loading ? <ProductGridSkeleton /> : null}

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

        {/*
          A way out that is not the back gesture. Somebody who came here for
          bedding and found nothing wants the next shelf, not the shop again.
        */}
        <View className="items-center pt-6">
          <Chip
            label="Browse all departments"
            onPress={() => router.replace("/(store)/categories")}
            tone="neutral"
          />
        </View>
      </View>
    </Screen>
  );
}
