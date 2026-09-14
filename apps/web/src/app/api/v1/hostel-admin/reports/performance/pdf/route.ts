import type { NextRequest } from "next/server";

import { requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import {
  performancePdfFilename,
  renderPerformanceReportPdf,
} from "@/modules/reports/performance-report-pdf";
import { getHostelPerformanceReport } from "@/modules/reports/performance-report.service";
import { performanceReportQuerySchema } from "@/modules/reports/report.validation";

export const runtime = "nodejs";

/** The same payload as `reports/performance`, as a two-page A4 PDF. */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const query = performanceReportQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const report = await getHostelPerformanceReport(query, principal);
    const bytes = await renderPerformanceReportPdf(report);

    return new Response(bytes as BodyInit, {
      headers: {
        // Live figures scoped to one hostel: never cached, never in a shared proxy.
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${performancePdfFilename(report.period.month)}"`,
        "content-type": "application/pdf",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
