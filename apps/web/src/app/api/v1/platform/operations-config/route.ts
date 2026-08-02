import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import { AuditLogModel } from "@hostel/db/models/AuditLog";
import {
  getOperationsConfig,
  saveOperationsConfig,
} from "@/modules/platform-config/operations-config";

export const runtime = "nodejs";

/**
 * The operational knobs behind activation, payments, complaints and attendance
 * — separate from the public site config so a website edit can never change how
 * the machinery behaves. Superadmin only (PHASES.md §5.1).
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);
    const config = await getOperationsConfig();

    return successResponse({ config }, "Operations configuration loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const result = await saveOperationsConfig(await request.json(), principal.userId);

    await AuditLogModel.create({
      action: "PLATFORM_OPERATIONS_CONFIG_UPDATED",
      actorId: principal.userId,
      entityId: "operations",
      entityType: "PlatformSetting",
      metadata: { config: result.config },
    });

    return successResponse(result, "Operations configuration saved");
  } catch (error) {
    return handleRouteError(error);
  }
}
