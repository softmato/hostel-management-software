import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { PROVIDER_NAV, PROVIDER_SEARCH_ENTRIES } from "@/lib/portal-nav";
import { PORTAL_ROBOTS } from "@/lib/seo";

/** Signed-in workspace: kept out of search. */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

export default function ProviderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <PortalShell
      navGroups={PROVIDER_NAV}
      searchEntries={PROVIDER_SEARCH_ENTRIES}
      searchPlaceholder="Search..."
      subtitle="Service Provider"
      tone="provider"
      workspaceName="Service Provider"
    >
      {children}
    </PortalShell>
  );
}
