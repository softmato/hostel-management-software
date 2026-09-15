import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { RESIDENT_NAV, RESIDENT_SEARCH_ENTRIES } from "@/lib/portal-nav";
import { PORTAL_ROBOTS } from "@/lib/seo";

/** Signed-in workspace: kept out of search, links included (robots.txt disallows it too). */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

export default function ResidentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PortalShell
      navGroups={RESIDENT_NAV}
      searchEntries={RESIDENT_SEARCH_ENTRIES}
      searchPlaceholder="Search menu, notices, payments..."
      subtitle="Resident Portal"
      tone="resident"
      workspaceName="Resident"
    >
      {children}
    </PortalShell>
  );
}
