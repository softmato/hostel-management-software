import { router } from "expo-router";
import { useEffect, useMemo } from "react";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { StoreCartProvider, useStoreCart } from "@/components/store/store-cart";
import { closeConfirm, openConfirm } from "@/lib/confirm";

/**
 * The supply store's own tab bar.
 *
 * ## A group, not four pushed screens
 *
 * The store is a place you go *into* and move around in — shop, browse the
 * departments, check the basket, look at what you already ordered — and every
 * shop the references show does that with a bar of its own. Pushing four
 * screens onto the admin stack would have meant a back gesture from the cart
 * landing on the shop, from the shop on Home, and no way to reach Orders
 * without going through the shop first.
 *
 * So `(store)` is a `<Tabs>` navigator on the root stack, entered from the
 * shortcut on admin Home and left with the back arrow on its own app bar. It
 * reuses `RoleTabs` with the `ADMIN` accent, because the only people who can
 * open it are hostel admins and the group should not look like a different app.
 *
 * ## Four tabs
 *
 * Shop, Categories, Cart, Orders. The reference bar has five — its fifth is
 * "Mine", an account screen — and there is nothing to put there: the account
 * already has a Profile tab one level up, and a second copy of it inside the
 * store would be the same door drawn twice, which is the rule the admin bar was
 * built on.
 *
 * ## Only the cart carries a badge
 *
 * And the layout owns the fetch behind it, because `RoleTabs` requires whoever
 * passes `badge` to. Orders deliberately has none: an order in flight is not
 * something *waiting for you*, it is something being done for you, and a
 * permanent "2" on a tab that needs no action is how badges stop meaning
 * anything.
 *
 * ## Not open yet
 *
 * The store is still being built, so opening it puts up the app's own alert
 * over the frosted shop: it is coming, and they will be told when it opens.
 * One button, "Go back", because there is nothing to do here yet. The alert
 * lives in the layout rather than on the Shop tab so it is said once per visit,
 * not again on every tab.
 */
const HIDDEN = [] as const;

function StoreTabs() {
  const { itemCount } = useStoreCart();

  const tabs = useMemo<readonly TabDef[]>(
    () => [
      { icon: "storefront", label: "Shop", name: "index" },
      { icon: "grid", label: "Categories", name: "categories" },
      { badge: itemCount, icon: "cart", label: "Cart", name: "cart" },
      { icon: "receipt", label: "Orders", name: "orders" },
    ],
    [itemCount],
  );

  return <RoleTabs accent="ADMIN" hidden={HIDDEN} tabs={tabs} />;
}

function leaveStore() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

export default function StoreLayout() {
  useEffect(() => {
    const id = openConfirm({
      cancelLabel: null,
      confirmLabel: "Go back",
      message:
        "We are working on the store. It will be available very soon, and we will notify you when it opens.",
      onConfirm: leaveStore,
      title: "Store coming soon",
    });

    // Leaving by any other route must not strand the alert over the next screen.
    return () => closeConfirm(id);
  }, []);

  return (
    <StoreCartProvider>
      <StoreTabs />
    </StoreCartProvider>
  );
}
