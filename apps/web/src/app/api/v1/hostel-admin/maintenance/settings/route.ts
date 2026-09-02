import type { NextRequest } from "next/server";

import { requireHostelAdminPrincipal, requireHostelStaffPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  getMaintenanceSettings,
  updateMaintenanceSettings,
} from "@/modules/maintenance/maintenance.service";
import { maintenanceSettingsSchema } from "@/modules/maintenance/maintenance.validation";

export const runtime = "nodejs";

/**
 * Readable by staff, writable by the owner.
 *
 * The asymmetry is the point. A warden raising a request has to be told what the
 * call-out will cost before they commit the hostel to it — that is the whole
 * reason the figure exists — but agreeing a rate with a plumber is the owner's
 * decision, and a warden who could edit the number could approve any job by
 * first lowering it.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireHostelStaffPrincipal(request);
    const result = await getMaintenanceSettings(
      principal,
      request.nextUrl.searchParams.get("hostelId") ?? undefined,
    );

    return successResponse(result, "Maintenance settings loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const principal = await requireHostelAdminPrincipal(request);
    const input = maintenanceSettingsSchema.parse(await request.json());
    const result = await updateMaintenanceSettings(input, principal);

    return successResponse(result, "Maintenance settings updated");
  } catch (error) {
    return handleRouteError(error);
  }
}
