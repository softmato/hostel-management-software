import type { Metadata } from "next";

import { MyBookingsPage } from "@/app/_components/my-bookings-page";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { robots: NOINDEX, title: "My bookings" };

export default function BookingsPage() {
  return <MyBookingsPage />;
}
