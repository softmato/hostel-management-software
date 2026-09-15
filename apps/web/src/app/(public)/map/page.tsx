import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicMapPage } from "@/app/_components/public-map-page";
import { staticPageMetadata } from "@/lib/seo-config";

/**
 * The whole catalogue on one map, with directions.
 *
 * Thin on purpose, like every other route in this group: the body lives in
 * `_components/public-map-page.tsx`. The `Suspense` boundary is not optional —
 * the page reads `?slug=` and `?route=` through `useSearchParams`, and Next
 * refuses to build a route that does so without one.
 */
export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("map");
}

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <PublicMapPage />
    </Suspense>
  );
}
