import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { csvFilename, csvResponse, toCsv } from "@/lib/csv";
import { buildHostelAdminReportExport } from "@/modules/reports/report-export.service";
import { hostelAdminReportExportSchema } from "@/modules/reports/report.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const input = hostelAdminReportExportSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    // Scoped to the caller's own hostels inside the builder — a hostelId the
    // principal does not hold throws before any read.
    const report = await buildHostelAdminReportExport(input, principal);

    return csvResponse(
      toCsv(report.columns, report.rows),
      csvFilename(report.filenamePrefix),
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
