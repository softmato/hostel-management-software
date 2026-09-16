import type { Metadata } from "next";

import { MyBookingDetailPage } from "@/app/_components/my-bookings-page";
import { NOINDEX } from "@/lib/seo";

type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = { robots: NOINDEX, title: "Booking" };

export default async function BookingPage({ params }: PageProps) {
  const { id } = await params;

  return <MyBookingDetailPage bookingId={id} />;
}
