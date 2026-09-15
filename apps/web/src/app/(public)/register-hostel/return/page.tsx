import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckoutReturnPage } from "@/app/_components/checkout-return-page";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  // Where a checkout returns to — one person's payment, never a search result.
  robots: NOINDEX,
  title: "Payment status",
};

/**
 * The registered `return_url` for a Softmato checkout.
 *
 * The hostname it sits on is on the credential's allowlist, set by a Softmato
 * admin in advance — the list is never taken from a request, so this address
 * cannot be pointed anywhere else by anything we send.
 */
export default function CheckoutReturnRoute() {
  return (
    <Suspense fallback={null}>
      <CheckoutReturnPage />
    </Suspense>
  );
}
