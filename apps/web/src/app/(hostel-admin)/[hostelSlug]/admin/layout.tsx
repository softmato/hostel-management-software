import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HostelBookingRequestsReminder } from "@/app/_components/hostel-booking-requests-reminder";
import { HostelPaymentCredentialsReminder } from "@/app/_components/hostel-payment-credentials-reminder";
import { HostelPhotoReminder } from "@/app/_components/hostel-photo-reminder";
import { PortalShell } from "@/components/portal-shell";
import { canAccessWorkspace, workspaceHostelName } from "@/lib/hostel-workspace";
import { hostelAdminNavForSlug, searchEntriesFromNav } from "@/lib/portal-nav";
import { PORTAL_ROBOTS } from "@/lib/seo";

type HostelAdminWorkspaceLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ hostelSlug: string }>;
}>;

/** Signed-in workspace: kept out of search, links included (robots.txt disallows it too). */
export const metadata: Metadata = { robots: PORTAL_ROBOTS };

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
      searchEntries={searchEntriesFromNav(navGroups)}
      searchPlaceholder="Search residents, rooms, payments..."
      subtitle="Hostel Admin Portal"
      tone="admin"
      workspaceName={(await workspaceHostelName(hostelSlug)) ?? "Hostel Workspace"}
    >
      <HostelPaymentCredentialsReminder
        paymentProfileHref={`/${hostelSlug}/admin/payment-setup`}
      />
      <HostelPhotoReminder profileHref={`/${hostelSlug}/admin/profile`} />
      <HostelBookingRequestsReminder bookingsHref={`/${hostelSlug}/admin/bookings`} />
      {children}
    </PortalShell>
  );
}
