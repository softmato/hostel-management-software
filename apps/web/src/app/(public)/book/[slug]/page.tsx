import type { Metadata } from "next";

import { BookingCheckoutPage } from "@/app/_components/booking-checkout-page";
import { NOINDEX } from "@/lib/seo";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ booking?: string; room?: string }>;
};

export const metadata: Metadata = { robots: NOINDEX, title: "Book a room" };

/** The checkout. Everything on it is per person and per minute, so it is drawn in the browser. */
export default async function BookRoomPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  return (
    <BookingCheckoutPage
      bookingId={query.booking?.trim() || null}
      roomType={query.room?.trim() || null}
      slug={slug}
    />
  );
}
