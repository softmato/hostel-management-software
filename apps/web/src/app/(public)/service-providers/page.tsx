import type { Metadata } from "next";

import { ServiceProviderRegistrationPage } from "@/app/_components/service-provider-registration-page";
import { listPublicServiceProviders } from "@/modules/service-providers/service-provider.service";

export const metadata: Metadata = {
  title: "Join the Service Provider Network",
  description:
    "Register as a plumber, electrician, cleaner or other tradesperson and get matched with hostel maintenance jobs across Kathmandu.",
  alternates: { canonical: "/service-providers" },
};

/**
 * The public provider surface is the registration funnel, not a browsable
 * directory (PHASES.md §6.1 — the marketplace lives in the app, and hostel
 * admins reach providers from their own portal rather than a public listing).
 *
 * The approved-provider total is read on the server so the hero renders its real
 * number in the first paint and the page stays crawlable.
 */
export default async function ServiceProvidersPage() {
  let providerCount: number | undefined;

  try {
    providerCount = (await listPublicServiceProviders({})).total;
  } catch {
    // Falls back to the component's own client fetch, then to a dash.
    providerCount = undefined;
  }

  return <ServiceProviderRegistrationPage initialProviderCount={providerCount} />;
}
