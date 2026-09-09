import { Suspense } from "react";

import { CheckoutReturnPage } from "@/app/_components/checkout-return-page";

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
