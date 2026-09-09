import { PortalShell } from "@/components/portal-shell";
import { TEAM_NAV, TEAM_SEARCH_ENTRIES } from "@/lib/portal-nav";

/**
 * The field team's portal.
 *
 * Wears the platform tone rather than a fifth colour of its own. An agent works
 * for the platform, and inventing a tone for a two-page desk would mean a new
 * accent in the palette carrying no information — the sidebar already says
 * whose desk this is.
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
      tone="platform"
      workspaceName="Team Desk"
    >
      {children}
    </PortalShell>
  );
}
