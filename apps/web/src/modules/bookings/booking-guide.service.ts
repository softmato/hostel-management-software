import "server-only";

import { getBookingConfig } from "@/modules/bookings/booking-config";
import { bookingGuideIntro, bookingGuideSections } from "@/modules/bookings/booking-guide";
import type { PolicySection } from "@/modules/bookings/booking-policy";

export type BookingGuide = {
  /** False while bookings are switched off platform-wide: the page says so rather than pretending. */
  enabled: boolean;
  intro: string[];
  sections: PolicySection[];
};

export async function getBookingGuide(): Promise<BookingGuide> {
  const config = await getBookingConfig();

  return {
    enabled: config.enabled,
    intro: bookingGuideIntro(),
    sections: bookingGuideSections(config),
  };
}
