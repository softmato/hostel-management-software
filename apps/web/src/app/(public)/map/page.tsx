import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicMapPage } from "@/app/_components/public-map-page";

/**
 * The whole catalogue on one map, with directions.
 *
 * Thin on purpose, like every other route in this group: the body lives in
 * `_components/public-map-page.tsx`. The `Suspense` boundary is not optional —
 * the page reads `?slug=` and `?route=` through `useSearchParams`, and Next
 * refuses to build a route that does so without one.
 */
export const metadata: Metadata = {
  title: "Hostel Map",
  description:
    "Every hostel on the platform, on one map. Search by name or area, see what is near you, and get walking or driving directions to the door.",
  alternates: { canonical: "/map" },
};

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <PublicMapPage />
    </Suspense>
  );
}
