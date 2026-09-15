import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicHostelListingPage } from "@/app/_components/public-hostel-listing-page";
import { HostelListingPageSkeleton } from "@/components/public-page-skeletons";
import { staticPageMetadata } from "@/lib/seo-config";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("hostels");
}

export default function HostelListingPage() {
  return (
    <Suspense fallback={<HostelListingPageSkeleton />}>
      <PublicHostelListingPage />
    </Suspense>
  );
}
