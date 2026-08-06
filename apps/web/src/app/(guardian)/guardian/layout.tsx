import { PortalShell } from "@/components/portal-shell";
import { GUARDIAN_NAV, GUARDIAN_SEARCH_ENTRIES } from "@/lib/portal-nav";

export default function GuardianLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PortalShell
      navGroups={GUARDIAN_NAV}
      searchEntries={GUARDIAN_SEARCH_ENTRIES}
      searchPlaceholder="Search notices, payments..."
      subtitle="Guardian Portal"
      tone="guardian"
      workspaceName="Guardian"
    >
      {children}
    </PortalShell>
  );
}
