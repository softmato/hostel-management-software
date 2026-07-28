"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { Panel } from "@/app/_components/shared-ui";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { combineResources, usePortalResource } from "@/lib/portal-query";
import { Message, PageHeader, ReportGrid, type ReportRecord } from "./portal-shared";

type Report = { report: ReportRecord };

export const HostelAdminReportsPageContent = React.memo(
  function HostelAdminReportsPageContent() {
    const errorMessage = "Could not load reports.";
    // The dashboard report is the same cache entry the Dashboard screen reads,
    // so arriving here from it costs three requests, not four.
    const dashboardResource = usePortalResource<Report>(
      hostelAdminEndpoints.dashboardReport,
      { errorMessage },
    );
    const paymentsResource = usePortalResource<Report>(
      hostelAdminEndpoints.paymentsReport,
      { errorMessage },
    );
    const complaintsResource = usePortalResource<Report>(
      hostelAdminEndpoints.complaintsReport,
      { errorMessage },
    );
    const maintenanceResource = usePortalResource<Report>(
      hostelAdminEndpoints.maintenanceReport,
      { errorMessage },
    );

    const dashboard = dashboardResource.data?.report ?? null;
    const payments = paymentsResource.data?.report ?? null;
    const complaints = complaintsResource.data?.report ?? null;
    const maintenance = maintenanceResource.data?.report ?? null;
    const { message } = combineResources(
      dashboardResource,
      paymentsResource,
      complaintsResource,
      maintenanceResource,
    );

    return (
      <div className="mx-auto max-w-[1448px] space-y-6">
        <PageHeader
          description="Hostel-scoped operational reports and pilot metrics."
          icon={BarChart3}
          title="Reports"
        />
        <Message value={message} />
        <Panel title="Dashboard">
          <ReportGrid report={dashboard} />
        </Panel>
        <div className="grid gap-5 xl:grid-cols-3">
          <Panel title="Payments">
            <ReportGrid report={payments} />
          </Panel>
          <Panel title="Complaints">
            <ReportGrid report={complaints} />
          </Panel>
          <Panel title="Maintenance">
            <ReportGrid report={maintenance} />
          </Panel>
        </div>
      </div>
    );
  },
);
