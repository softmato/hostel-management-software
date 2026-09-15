import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicInquiryPage } from "@/app/_components/public-inquiry-page";
import { InquiryPageSkeleton } from "@/components/public-page-skeletons";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  // An inquiry form driven by query parameters; the hostel page is what ranks.
  robots: NOINDEX,
  title: "Send an inquiry",
};

export default function InquiryPage() {
  return (
    <Suspense fallback={<InquiryPageSkeleton />}>
      <PublicInquiryPage />
    </Suspense>
  );
}
