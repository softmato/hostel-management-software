import { SiteAnnouncementBanner } from "@/components/site-announcement-banner";
import { SiteConfigProvider } from "@/components/site-config-provider";
import { loadSiteConfig } from "@/lib/site-config-server";

/**
 * The owner's website configuration already comes from the root layout; this
 * group re-provides it only so the public tree stays correct if it is ever
 * rendered on its own, and adds the site-wide announcement banner.
 * Revalidated rather than static, so a save in the admin portal shows up
 * without a redeploy.
 */
export const revalidate = 60;

export default async function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = await loadSiteConfig();

  return (
    <SiteConfigProvider config={config}>
      <SiteAnnouncementBanner />
      {children}
    </SiteConfigProvider>
  );
}
