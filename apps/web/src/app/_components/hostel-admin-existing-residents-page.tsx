"use client";

import { ExistingResidentsPanel } from "@/app/_components/existing-residents-panel";
import { useWorkspaceHref } from "@/hooks/use-workspace-href";

import { PortalPageHeader } from "./portal-dashboard-ui";

/** Residents → Add existing residents (docs/EXISTING_RESIDENTS.md). */
export function HostelAdminExistingResidentsPage() {
  const workspaceHref = useWorkspaceHref();

  return (
    <div className="space-y-4">
      <PortalPageHeader
        breadcrumb={[
          { href: workspaceHref("/hostel-admin"), label: "Home" },
          { href: workspaceHref("/hostel-admin/residents"), label: "Residents" },
          "Existing residents",
        ]}
        description="People already living here before you joined. Add them with what they have paid or owe — no admission fee."
        title="Add existing residents"
      />
      <ExistingResidentsPanel apiBase="/api/v1/hostel-admin/residents/existing" tone="admin" />
    </div>
  );
}
