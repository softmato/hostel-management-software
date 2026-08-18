import type { NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError, successResponse } from "@/lib/api-response";
import {
  revokeDeviceToken,
  saveDeviceToken,
} from "@/modules/notifications/notification.service";
import {
  deviceTokenRevokeSchema,
  deviceTokenSaveSchema,
} from "@/modules/notifications/notification.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const input = deviceTokenSaveSchema.parse(await request.json());
    const result = await saveDeviceToken(input, principal);

    return successResponse(result, "Device token saved", { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Sign-out. Without this, signing out only forgot the token on the phone — the
 * row stayed ACTIVE against the previous account and kept receiving that
 * person's notifications on a handset they had signed out of.
 *
 * A body on DELETE is unusual but correct here: the token identifies *which*
 * device, it is long and it is a credential-adjacent value, so it does not
 * belong in a URL where it would land in access logs. `revokeDeviceToken`
 * scopes the update to the caller, so quoting someone else's token does nothing.
 */
export async function DELETE(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const input = deviceTokenRevokeSchema.parse(await request.json());
    const result = await revokeDeviceToken(input, principal);

    return successResponse(result, "Device token revoked");
  } catch (error) {
    return handleRouteError(error);
  }
}
