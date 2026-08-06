import { PortalShell } from "@/components/portal-shell";
import { RESIDENT_NAV, RESIDENT_SEARCH_ENTRIES } from "@/lib/portal-nav";

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
