import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { COOK_NAV, COOK_SEARCH_ENTRIES } from "@/lib/portal-nav";
import { PORTAL_ROBOTS } from "@/lib/seo";

/** Signed-in workspace: kept out of search. */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

export default function CookLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <PortalShell
      navGroups={COOK_NAV}
      searchEntries={COOK_SEARCH_ENTRIES}
      searchPlaceholder="Search..."
      subtitle="Cook Portal"
      tone="cook"
      workspaceName="Kitchen"
    >
      {children}
    </PortalShell>
  );
}
