import type { Metadata } from "next";

import { PublicBookingGuidePage } from "@/app/_components/public-booking-guide-page";
import { staticPageMetadata } from "@/lib/seo-config";
import { getBookingGuide } from "@/modules/bookings/booking-guide.service";

// Every hour and percentage on it is a superadmin setting, the same as the
// refund policy's: a changed one has to reach this page quickly.
export const revalidate = 60;

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("howBookingWorks");
}

export default async function HowBookingWorksPage() {
  return <PublicBookingGuidePage guide={await getBookingGuide()} />;
}
