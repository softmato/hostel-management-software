import type { NextRequest } from "next/server";

import { requireSuperadminPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  invitePlatformAdmin,
  listPlatformAdminInvites,
} from "@/modules/users/platform-admin-invite.service";
import { platformAdminInviteSchema } from "@/modules/users/platform-admin.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireSuperadminPrincipal(request);

    return successResponse(await listPlatformAdminInvites(), "Invitations loaded");
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireSuperadminPrincipal(request);
    const input = platformAdminInviteSchema.parse(await request.json());

    return successResponse(
      await invitePlatformAdmin(input, principal),
      "Invitation sent",
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
