import { Suspense } from "react";

import { PlatformBookingsPageContent } from "@/app/_components/platform-bookings-page";

// The tab lives in `?tab=` (bells deep-link to a queue), which needs a boundary to read.
export default function PlatformBookingsPage() {
  return (
    <Suspense>
      <PlatformBookingsPageContent />
    </Suspense>
  );
}
