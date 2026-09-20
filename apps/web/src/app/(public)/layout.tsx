import { JsonLd } from "@/components/json-ld";
import { SiteAnnouncementBanner } from "@/components/site-announcement-banner";
import { SiteConfigProvider } from "@/components/site-config-provider";
import { organizationJsonLd, websiteJsonLd } from "@/lib/json-ld";
import { loadSiteConfig } from "@/lib/site-config-server";
import { DEFAULT_SITE_CONFIG } from "@/modules/platform-config/site-config.defaults";

/**
 * The owner's website configuration already comes from the root layout; this
 * group re-provides it only so the public tree stays correct if it is ever
 * rendered on its own, and adds the site-wide announcement banner.
 * Revalidated rather than static, so a save in the admin portal shows up
 * without a redeploy. 600s, not 60s: every access past the window regenerates
 * the page and bills an ISR write, and the site config changes far less often
 * than once a minute.
 */
export const revalidate = 600;

export default async function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = await loadSiteConfig();
  const alternateNames = config.seo.alternateNames;
  const { identity } = config;

  return (
    <SiteConfigProvider config={config}>
      {/*
       * Who runs the site, once per public page: the brand, its other spellings,
       * its parent company and where to reach it. The shipped support number is
       * left out until it is replaced with a real one — structured data is read
       * as a statement of fact.
       */}
      <JsonLd
        data={[
          organizationJsonLd({
            address: identity.address,
            alternateNames,
            email: identity.supportEmail,
            phone:
              identity.supportPhone === DEFAULT_SITE_CONFIG.identity.supportPhone
                ? ""
                : identity.supportPhone,
            sameAs: Object.values(config.social).filter(Boolean),
            vendorLegalName: DEFAULT_SITE_CONFIG.issuer.legalName,
          }),
          websiteJsonLd(alternateNames),
        ]}
      />
      <SiteAnnouncementBanner />
      {children}
    </SiteConfigProvider>
  );
}
