/**
 * The platform owner's website configuration, as far as the phone needs it.
 *
 * `GET /public/site-config` returns the whole read-only projection —
 * announcement, hero, pricing, legal and the rest — but this app is not the
 * marketing site and has no use for most of it. Only the pieces a screen
 * actually renders are typed here, and the rest is left to arrive and be
 * ignored: a client type that claims to describe a payload it does not use is
 * a maintenance cost with no reader.
 *
 * `publicApi`, not `api`. The route takes no principal and the phone reads it
 * before anyone has signed in, so a 401 interceptor has no business on it.
 */

import { publicApi } from "@/lib/api";
import { type ApiEnvelope, unwrap } from "@/lib/api-contract";

/**
 * One row of the superadmin's **Locations** page (Website Config → Locations).
 * The endpoint has already dropped the disabled ones — see `getPublicSiteConfig`
 * — so anything that arrives here is meant to be shown.
 */
export type SiteLocation = {
  areas: string[];
  city: string;
};

export type MobileSiteConfig = {
  locations: SiteLocation[];
};

export async function getSiteConfig() {
  const response = await publicApi.get<ApiEnvelope<{ config: MobileSiteConfig }>>(
    "/public/site-config",
  );

  return unwrap(response).config;
}
