import { useMemo } from "react";

import { RoleTabs, type TabDef } from "@/components/role-tabs";
import { StoreCartProvider, useStoreCart } from "@/components/store/store-cart";

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

export default function StoreLayout() {
  return (
    <StoreCartProvider>
      <StoreTabs />
    </StoreCartProvider>
  );
}
