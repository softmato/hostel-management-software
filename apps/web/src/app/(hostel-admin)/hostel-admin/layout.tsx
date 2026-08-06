import { PortalShell } from "@/components/portal-shell";
import { HOSTEL_ADMIN_NAV, HOSTEL_ADMIN_SEARCH_ENTRIES } from "@/lib/portal-nav";

export default function HostelAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PortalShell
      navGroups={HOSTEL_ADMIN_NAV}
      searchEntries={HOSTEL_ADMIN_SEARCH_ENTRIES}
      searchPlaceholder="Search residents, rooms, payments..."
      subtitle="Hostel Admin Portal"
      tone="admin"
      workspaceName="Hostel Workspace"
    >
      {children}
    </PortalShell>
  );
}
