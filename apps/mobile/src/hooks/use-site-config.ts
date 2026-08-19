import { useCallback } from "react";

import { useResource } from "@/hooks/use-resource";
import {
  FALLBACK_SITE_CONFIG,
  getSiteConfig,
  type MobileSiteConfig,
} from "@/lib/site-config-api";

/**
 * The owner's website configuration, with the shipped defaults standing in
 * until it arrives.
 *
 * The web reads this from a React context filled on the server, so its pages
 * never render a half-configured header. The phone has no server render, so the
 * equivalent is a fallback rather than a loading state: every screen that reads
 * this — Profile, About, Contact, Pricing, the legal pages — is a menu or a
 * document, and showing a spinner in place of a menu that is about to say the
 * same thing either way is worse than showing the defaults for one frame.
 *
 * `config` is therefore never null. `loading` and `error` are still returned
 * for the one screen that needs them: Pricing has no sensible default, because
 * plans are entirely owner-authored and inventing tiers would be fiction.
 */
export function useSiteConfig() {
  const resource = useResource<MobileSiteConfig>(useCallback(() => getSiteConfig(), []));

  return {
    config: resource.data ?? FALLBACK_SITE_CONFIG,
    error: resource.error,
    loading: resource.loading,
    refresh: resource.refresh,
    refreshing: resource.refreshing,
    reload: resource.reload,
  };
}
