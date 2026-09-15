import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { TEAM_NAV, TEAM_SEARCH_ENTRIES } from "@/lib/portal-nav";
import { PORTAL_ROBOTS } from "@/lib/seo";

/** Signed-in workspace: kept out of search, links included (robots.txt disallows it too). */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

/**
 * The field team's portal.
 *
 * Wears the product's green rather than the platform teal it used to borrow.
 * The argument for the teal was that an agent works for the platform, which is
 * true and is not what the colour has to answer for: this is the one portal an
 * owner is shown in person, on the agent's phone, minutes before they meet the
 * green brand everywhere else. The rest of the tone is defined in
 * `portal-shell.tsx`.
 */
export default function TeamLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PortalShell
      navGroups={TEAM_NAV}
      searchEntries={TEAM_SEARCH_ENTRIES}
      searchPlaceholder="Search your registrations..."
      subtitle="Field Team"
      tone="team"
      workspaceName="Team Desk"
    >
      {children}
    </PortalShell>
  );
}
