import { Settings } from "lucide-react";
import type { ReactNode } from "react";

import { HostelAdminComplaintsPage } from "@/app/_components/hostel-admin-complaints-page";
import { HostelAdminDashboardPageContent } from "@/app/_components/hostel-admin-dashboard-page";
import { HostelAdminFeePlansPageContent } from "@/app/_components/hostel-admin-fee-plans-page";
import { HostelAdminFoodPage } from "@/app/_components/hostel-admin-food-page";
import { HostelAdminInquiriesPageContent } from "@/app/_components/hostel-admin-inquiries-page";
import { HostelAdminMaintenancePageContent } from "@/app/_components/hostel-admin-maintenance-page";
import { HostelAdminMoveChecklistPage } from "@/app/_components/hostel-admin-move-checklist-page";
import { HostelAdminNightStatusPage } from "@/app/_components/hostel-admin-night-status-page";
import { HostelAdminNoticesPage } from "@/app/_components/hostel-admin-notices-page";
import { HostelAdminPaymentsPage } from "@/app/_components/hostel-admin-payments-page";
import { HostelAdminProfilePageContent } from "@/app/_components/hostel-admin-profile-page";
import { HostelAdminReferralsPageContent } from "@/app/_components/hostel-admin-referrals-page";
import { HostelAdminReportsPageContent } from "@/app/_components/hostel-admin-reports-page";
import { HostelAdminResidentsPage } from "@/app/_components/hostel-admin-residents-page";
import { HostelAdminRoomsPageContent } from "@/app/_components/hostel-admin-rooms-page";
import { HostelAdminSOSAlertsPage } from "@/app/_components/hostel-admin-sos-alerts-page";
import { HostelAdminTransactionsPageContent } from "@/app/_components/hostel-admin-transactions-page";
import { HostelAdminWardensPage } from "@/app/_components/hostel-admin-wardens-page";
import { PortalPlaceholderPage } from "@/components/portal-placeholder-page";

/**
 * Every screen of the hostel-owner portal, keyed by the URL segment after
 * `/{hostelSlug}/admin/`. Keeping them in one registry means the tenant-scoped
 * catch-all route stays a single file instead of one wrapper per tab.
 */
export const HOSTEL_ADMIN_SCREENS: Record<string, (slug: string) => ReactNode> = {
  complaints: () => <HostelAdminComplaintsPage />,
  dashboard: () => <HostelAdminDashboardPageContent />,
  "fee-plans": () => <HostelAdminFeePlansPageContent />,
  food: () => <HostelAdminFoodPage />,
  inquiries: () => <HostelAdminInquiriesPageContent />,
  maintenance: () => <HostelAdminMaintenancePageContent />,
  "move-in-out": () => <HostelAdminMoveChecklistPage />,
  "night-status": () => <HostelAdminNightStatusPage />,
  notices: () => <HostelAdminNoticesPage />,
  payments: () => <HostelAdminPaymentsPage />,
  profile: () => <HostelAdminProfilePageContent />,
  referrals: () => <HostelAdminReferralsPageContent />,
  reports: () => <HostelAdminReportsPageContent />,
  residents: () => <HostelAdminResidentsPage />,
  rooms: () => <HostelAdminRoomsPageContent />,
  // Merged into Maintenance — kept so bookmarked provider links still resolve.
  "service-providers": () => <HostelAdminMaintenancePageContent />,
  settings: (slug: string) => (
    <PortalPlaceholderPage
      actions={[
        { href: `/${slug}/admin/profile`, label: "Open Hostel Profile" },
        { href: `/${slug}/admin/residents`, label: "Manage Residents" },
      ]}
      description="Hostel workspace controls for profile, resident access, and daily operations."
      icon={Settings}
      items={[
        "Hostel profile",
        "Resident activation",
        "Notice defaults",
        "Staff access",
      ]}
      title="Settings"
    />
  ),
  "sos-alerts": () => <HostelAdminSOSAlertsPage />,
  transactions: () => <HostelAdminTransactionsPageContent />,
  wardens: () => <HostelAdminWardensPage />,
};

export const HOSTEL_ADMIN_SCREEN_NAMES = Object.keys(HOSTEL_ADMIN_SCREENS);
