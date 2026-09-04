import type { Metadata } from "next";

import { ServiceProviderRegistrationPage } from "@/app/_components/service-provider-registration-page";
import { getPublicServiceProviderStats } from "@/modules/service-providers/service-provider.service";

export const metadata: Metadata = {
  title: "Join the Service Provider Network",
  description:
    "Register as a plumber, electrician, cleaner or other tradesperson and get matched with hostel maintenance jobs across Nepal.",
  alternates: { canonical: "/service-providers" },
};

/**
 * The public provider surface is the registration funnel, not a browsable
 * directory (PHASES.md §6.1 — the marketplace lives in the app, and hostel
 * admins reach providers from their own portal rather than a public listing).
 *
 * The hero's three numbers are read on the server so they are in the first
 * paint and the page stays crawlable. A failure here is not worth a 500 on a
 * marketing page: the hero drops whichever stat it has no number for.
 */
export default async function ServiceProvidersPage() {
  let stats: Awaited<ReturnType<typeof getPublicServiceProviderStats>> | undefined;

  try {
    stats = await getPublicServiceProviderStats();
  } catch {
    stats = undefined;
  }

  return <ServiceProviderRegistrationPage stats={stats} />;
}
