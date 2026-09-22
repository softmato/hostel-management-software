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
 * The `return_url` of every Softmato checkout this platform opens — plans and
 * bookings alike (`checkoutReturnUrl`).
 *
 * Softmato only sends a payer back to a host registered against the credential
 * at `admin.softmato.com` in advance, so nothing we send can point this
 * anywhere else.
 */
export default function CheckoutReturnRoute() {
  return (
    <Suspense fallback={null}>
      <CheckoutReturnPage />
    </Suspense>
  );
}
