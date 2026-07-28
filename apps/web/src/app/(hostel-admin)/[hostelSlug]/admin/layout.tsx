import { notFound } from "next/navigation";

import { HostelPhotoReminder } from "@/app/_components/hostel-photo-reminder";
import { PortalShell } from "@/components/portal-shell";
import { canAccessWorkspace, workspaceHostelName } from "@/lib/hostel-workspace";
import { hostelAdminNavForSlug, searchEntriesFromNav } from "@/lib/portal-nav";

type HostelAdminWorkspaceLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ hostelSlug: string }>;
}>;

export default async function HostelAdminWorkspaceLayout({
  children,
  params,
}: HostelAdminWorkspaceLayoutProps) {
  const { hostelSlug } = await params;

  // A slug outside the signed-in staff member's hostels is a 404, not a 403 —
  // we never confirm that another hostel's workspace exists (API.md §5).
  if (!(await canAccessWorkspace(hostelSlug))) {
    notFound();
  }

  const navGroups = hostelAdminNavForSlug(hostelSlug);

  return (
    <PortalShell
      navGroups={navGroups}
      portalName="HostelHub"
      searchEntries={searchEntriesFromNav(navGroups)}
      searchPlaceholder="Search residents, rooms, payments..."
      subtitle="Hostel Admin Portal"
      tone="admin"
      workspaceName={(await workspaceHostelName(hostelSlug)) ?? "Hostel Workspace"}
    >
      <HostelPhotoReminder profileHref={`/${hostelSlug}/admin/profile`} />
      {children}
    </PortalShell>
  );
}
