import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { buildPlatformReportExport } from "@/modules/reports/report-export.service";
import { reportExportResponse } from "@/modules/reports/report-response";
import { platformReportExportSchema } from "@/modules/reports/report.validation";

export const runtime = "nodejs";

/**
 * Superadmin only. A PLATFORM_MODERATOR may read reports in the portal but not
 * export them (PHASES.md §5.1).
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    const input = platformReportExportSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const report = await buildPlatformReportExport(input);

    return await reportExportResponse(report, { format: input.format });
  } catch (error) {
    return handleRouteError(error);
  }
}
