import { Slot } from "expo-router";

import { StoreCartProvider } from "@/components/store/store-cart";

export default function StoreDetailLayout() {
  return (
    <StoreCartProvider>
      <Slot />
    </StoreCartProvider>
  );
}
