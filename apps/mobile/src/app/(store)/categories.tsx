import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { useAddToCart, useStoreCart } from "@/components/store/store-cart";
import {
  ProductCard,
  ProductGridSkeleton,
  StoreHeader,
} from "@/components/store/store-ui";
import { SectionHeader, SectionLink } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import { getStoreShelves, type StoreShelf } from "@/lib/store-api";

/**
 * Departments, as a shelf each.
 *
 * ## What this replaced, and why
 *
 * It used to be a grid of category tiles that collapsed into chips once one was
 * picked, with a flat product list under it — which made it a near-copy of the
 * shop: same painted header, same search field, same column of `ProductRow`s.
 * Two tabs that look the same are one tab and a wasted slot in the bar.
 *
 * A department store is not browsed by choosing a department and then looking;
 * it is browsed by **walking past the shelves**. So every live department gets a
 * heading and a horizontal rail of what is on it, and the whole catalogue is one
 * vertical scroll. Nothing has to be selected before anything can be seen, which
 * is the real difference from the shop — the shop shows what the platform is
 * pushing, this shows what the platform *has*.
 *
 * The heading sits outside the rail and carries "See all", per `NOTES.md` §5.
 * That link drills into `store/category/[slug]`, the same screen the shop's
 * shortcut tiles push, so there is one department screen and not two.
 *
 * ## Search narrows the shelves, it does not flatten them
 *
 * Typing filters the products and drops whatever shelf comes back empty, so a
 * search for "bucket" answers *which departments stock one*. The shop's search
 * answers "which product is it", and the two are deliberately different
 * questions — flattening this one into a result list would recreate exactly the
 * duplication described above.
 *
 * ## One request
 *
 * `GET /store/shelves` returns every department with its first twelve products.
 * A call per category would be sixteen round trips on a screen that has to open
 * at once — the reasoning `getStoreHome` already spells out.
 */
export default function StoreDepartmentsScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const [search, setSearch] = useState("");
  const cart = useStoreCart();
  const { add, addingProductId, setQuantity } = useAddToCart();

  const query = search.trim();
  const shelves = useResource(
    useCallback(() => getStoreShelves(query || undefined), [query]),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  /*
   * A `?slug=` still arrives from anything that deep-links here — a saved link,
   * an older build. It names a *department*, and a department has its own screen
   * now, so this hands over rather than pre-selecting a shelf that no longer has
   * a selected state to be in.
   */
  const handoff = params.slug;

  useEffect(() => {
    if (handoff) {
      // In an effect, not in the render body: navigating while rendering fires
      // twice under StrictMode and warns about updating another component.
      router.replace(`/store/category/${handoff}`);
    }
  }, [handoff]);

  const header = (
    <StoreHeader
      cartCount={cart.itemCount}
      onBack={() => router.back()}
      onCart={() => router.push("/(store)/cart")}
      onChangeSearch={setSearch}
      search={search}
      subtitle="Everything the platform stocks"
      title="Departments"
    />
  );

  if (shelves.error && !shelves.data) {
    return (
      <Screen bleedTop header={header} insideTabs>
        <ErrorState message={shelves.error} onRetry={shelves.reload} />
      </Screen>
    );
  }

  const rows = shelves.data ?? [];

  return (
    <Screen
      bleedTop
      header={header}
      insideTabs
      onRefresh={shelves.refresh}
      padded={false}
      refreshing={shelves.refreshing}
      scroll
    >
      {shelves.loading ? (
        <View className="gap-6 px-5 pt-6">
          <ProductGridSkeleton count={2} />
          <ProductGridSkeleton count={2} />
        </View>
      ) : null}

      {!shelves.loading && rows.length === 0 ? (
        <View className="px-5 pt-6">
          <EmptyCard
            description={
              query
                ? "No department has anything matching that. Try a shorter word."
                : "The platform has not set up any departments yet."
            }
            title={query ? "Nothing found" : "Nothing to browse"}
          />
        </View>
      ) : null}

      {rows.map((shelf) => (
        <Shelf
          addingProductId={addingProductId}
          key={shelf.category.id}
          lineQuantities={cart.lineQuantities}
          onAdd={(productId) => void add({ id: productId })}
          onSetQuantity={(productId, next) => void setQuantity({ id: productId }, next)}
          shelf={shelf}
        />
      ))}
    </Screen>
  );
}

/**
 * One department: a heading with the count, then a rail.
 *
 * `ProductCard` rather than `ProductRow` because a rail is horizontal and a row
 * is not — and the card already handles a photograph, a price, a discount badge
 * and the add control inside a fixed width.
 */
function Shelf({
  addingProductId,
  lineQuantities,
  onAdd,
  onSetQuantity,
  shelf,
}: {
  addingProductId: string | null;
  lineQuantities: Readonly<Record<string, number>>;
  onAdd: (productId: string) => void;
  onSetQuantity: (productId: string, next: number) => void;
  shelf: StoreShelf;
}) {
  const open = () => router.push(`/store/category/${shelf.category.slug}`);

  return (
    <View className="pt-7">
      <View className="px-5">
        <SectionHeader
          action={
            shelf.total > shelf.products.length ? <SectionLink onPress={open} /> : null
          }
          subtitle={`${shelf.total} ${shelf.total === 1 ? "product" : "products"}`}
          title={shelf.category.name}
        />
      </View>

      {shelf.products.length === 0 ? (
        <View className="px-5">
          <EmptyCard
            description="This department is still being stocked."
            title="Empty shelf"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-3 px-5"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {shelf.products.map((product) => (
            <View key={product.id} style={{ width: 158 }}>
              <ProductCard
                busy={addingProductId === product.id}
                inCart={lineQuantities[product.id]}
                onAdd={() => onAdd(product.id)}
                onPress={() => router.push(`/store/product/${product.id}`)}
                onSetQuantity={(next) => onSetQuantity(product.id, next)}
                product={product}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
