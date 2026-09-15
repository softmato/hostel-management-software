import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import {
  PLATFORM_MODERATOR_NAV,
  PLATFORM_MODERATOR_SEARCH_ENTRIES,
  PLATFORM_NAV,
  PLATFORM_SEARCH_ENTRIES,
} from "@/lib/portal-nav";
import { Role } from "@/lib/roles";
import { PORTAL_ROBOTS } from "@/lib/seo";
import { sessionRole } from "@/lib/server-session";

/** Signed-in workspace: kept out of search, links included (robots.txt disallows it too). */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

export default async function PlatformLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // An acting superadmin gets the same portal minus the tabs they would be
  // redirected away from anyway (config, fee plans, settings) — PHASES.md §5.1.
  const isModerator = (await sessionRole()) === Role.PLATFORM_MODERATOR;

  return (
    <PortalShell
      navGroups={isModerator ? PLATFORM_MODERATOR_NAV : PLATFORM_NAV}
      searchEntries={
        isModerator ? PLATFORM_MODERATOR_SEARCH_ENTRIES : PLATFORM_SEARCH_ENTRIES
      }
      searchPlaceholder="Search hostels, users, payments, settings..."
      subtitle={isModerator ? "Platform Moderator Portal" : "Platform Owner Portal"}
      tone="platform"
      workspaceName={isModerator ? "Platform Moderator" : "Platform Owner"}
    >
      {children}
    </PortalShell>
  );
}
